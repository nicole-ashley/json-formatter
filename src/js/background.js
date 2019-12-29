import browser from './lib/browser';
import {listen} from './lib/messaging';
import {removeComments, firstJSONCharIndex} from './lib/utilities';
import {jsonStringToHTML, renderArrayAsTable} from './lib/dom-builder';

// Record current version (in case a future update wants to know)
browser.storage.local.set({appVersion: browser.runtime.getManifest().version});

function extractJSON(text) {
  let obj;
  let validJsonText;
  let jsonpFunctionName = null;

  // Strip any leading garbage, such as a 'while(1);'
  const strippedText = text.substring(firstJSONCharIndex(text));

  try {
    obj = JSON.parse(strippedText);
    validJsonText = strippedText;
  } catch (e) {
    // Not JSON; could be JSONP though.
    // Try stripping 'padding' (if any), and try parsing it again
    text = text.trim();
    // Find where the first paren is (and exit if none)
    const indexOfParen = text.indexOf('(');
    if (!indexOfParen) {
      throw Error('no opening parenthesis');
    }

    // Get the substring up to the first "(", with any comments/whitespace stripped out
    const firstBit = removeComments(text.substring(0, indexOfParen)).trim();
    if (!firstBit.match(/^[a-zA-Z_$][.[\]'"0-9a-zA-Z_$]*$/)) {
      // The 'firstBit' is NOT a valid function identifier.
      throw Error('first bit not a valid function name');
    }

    // Find last parenthesis (exit if none)
    const indexOfLastParen = text.lastIndexOf(')');
    if (!indexOfLastParen) {
      throw Error('no closing paren');
    }

    // Check that what's after the last parenthesis is just whitespace, comments, and possibly a semicolon (exit if anything else)
    const lastBit = removeComments(text.substring(indexOfLastParen + 1)).trim();
    if (lastBit !== '' && lastBit !== ';') {
      throw Error('last closing paren followed by invalid characters');
    }

    // So, it looks like a valid JS function call, but we don't know whether it's JSON inside the parentheses...
    // Check if the 'argument' is actually JSON (and record the parsed result)
    text = text.substring(indexOfParen + 1, indexOfLastParen);
    try {
      obj = JSON.parse(text);
      validJsonText = text;
    } catch (e2) {
      // Just some other text that happens to be in a function call.
      // Respond as not JSON, and exit
      throw Error('looks like a function call, but the parameter is not valid JSON');
    }

    jsonpFunctionName = firstBit;
  }

  // Ensure it's not a number or string (technically valid JSON, but no point prettifying it)
  if (typeof obj !== 'object') {
    throw Error('NOT JSON', 'technically JSON but not an object or array');
  }

  // If there's an empty object or array, return JSON as is
  if (Object.entries(obj).length === 0 || obj.length === 0) {
    throw Error('NOT JSON', 'empty object or array');
  }

  return {obj, validJsonText, jsonpFunctionName};
}

// Listen for requests from content pages wanting to set up a port
listen((port, msg) => {
  if (msg.type === 'RENDER FORMATTED') {
    // Try to parse as JSON
    let extracted;
    try {
      extracted = extractJSON(msg.text);
    } catch (err) {
      port.postMessage(['NOT JSON', err.message]);
      port.disconnect();
      return;
    }

    const {obj, validJsonText, jsonpFunctionName} = extracted;

    // If still running, we now have JSON object to format
    browser.tabs.insertCSS(port.sender.tab.id, {code: require('../sass/content.scss')});

    // And send it the message to confirm that we're now formatting (so it can show a spinner)
    port.postMessage(['FORMATTING', Array.isArray(obj)]);

    // Do formatting
    jsonStringToHTML(validJsonText, jsonpFunctionName)
      .then(html => port.postMessage(['FORMATTED', html, validJsonText]));
  } else if (msg.type === 'RENDER TABLE') {
    // Try to parse as JSON
    let extracted;
    try {
      extracted = extractJSON(msg.text);
    } catch (err) {
      port.postMessage(['NOT JSON', err.message]);
      port.disconnect();
      return;
    }

    const {obj} = extracted;
    port.postMessage(['FORMATTING TABLE']);

    // Do formatting
    const html = renderArrayAsTable(obj);
    port.postMessage(['FORMATTED TABLE', html]);
  } else if (msg.type === 'GET STORED THEME') {
    browser.storage.sync.get('theme', data => {
      port.postMessage({type: 'STORED THEME', themeName: data && data.theme});
    });
  } else if (msg.type === 'UPDATE STORED THEME') {
    browser.storage.sync.set({theme: msg.theme}, () => {
      port.postMessage({type: 'STORED THEME', themeName: msg.theme});
    });
  } else if (msg.type === 'INSERT CSS') {
    browser.tabs.insertCSS(port.sender.tab.id, {code: msg.code});
  }
});
