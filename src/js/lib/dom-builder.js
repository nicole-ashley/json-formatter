'use strict';

import { createSpan, Templates } from './template';
import JsonTokenizer from 'json-tokenizer';

let lineNumber;

export function jsonStringToHTML(jsonString, jsonpFunctionName) {
  lineNumber = jsonpFunctionName === null ? 1 : 2;
  return tokenize(jsonString)
    .then((rootKeyValueOrValue) => {
      const gutterWidth = 1 + (lineNumber.toString().length * 0.5) + 'rem';
      const gutter = document.createElement('div');
      gutter.id = 'gutter';
      gutter.style.width = gutterWidth;

      // Make div#formattedJson and append the root keyValueOrValue
      const divFormattedJson = document.createElement('div');
      divFormattedJson.id = 'formattedJson';
      divFormattedJson.style.marginLeft = gutterWidth;
      divFormattedJson.appendChild(rootKeyValueOrValue);

      // Top and tail with JSONP padding if necessary
      if (jsonpFunctionName !== null) {
        divFormattedJson.innerHTML =
          `<div id="jsonpOpener" line-number="1">${jsonpFunctionName}(</div>
             ${divFormattedJson.innerHTML}
           <div id="jsonpCloser" line-number="${lineNumber}">)</div>`;
      }

      // Return the HTML
      return gutter.outerHTML + divFormattedJson.outerHTML;
    });
}

function tokenize(jsonString) {
  const templates = Templates;

  let currentNode = templates.keyValueOrValue();
  currentNode.classList.add('rootKeyValueOrValue');

  const tokenizer = new JsonTokenizer();
  tokenizer.on('data', (token) => {
    if (currentNode.tokenType === 'array') {
      const keyValueOrValue = templates.keyValueOrValue();
      keyValueOrValue.classList.add('arrayElement');
      keyValueOrValue.setAttribute('line-number', lineNumber++);
      currentNode.appendChild(keyValueOrValue);
      currentNode = keyValueOrValue;
    }

    switch (token.type) {
      case 'comma':
        currentNode.appendChild(templates.commaText());
        if (currentNode.classList.contains('keyValueOrValue')) {
          currentNode = currentNode.parentNode;
        }
        break;

      case 'end-label':
        currentNode.appendChild(templates.colonAndSpace());
        break;

      case 'begin-object':
        if (!currentNode.classList.contains('objectProperty')) {
          currentNode.setAttribute('line-number', lineNumber++);
        }

        currentNode.appendChild(templates.expander());
        currentNode.appendChild(templates.openingBrace());
        currentNode.appendChild(templates.ellipsis());

        const objectInner = templates.blockInner();
        objectInner.tokenType = 'object';

        currentNode.appendChild(objectInner);
        currentNode = objectInner;
        break;

      case 'end-object':
        if (currentNode.classList.contains('objectProperty')) {
          currentNode = currentNode.parentNode;
        }

        const objectContentNode = currentNode;
        currentNode = currentNode.parentNode;

        const closingBrace = templates.closingBrace();
        currentNode.appendChild(closingBrace);

        if (objectContentNode.childNodes.length) {
          closingBrace.setAttribute('line-number', lineNumber++);
        } else {
          objectContentNode.remove();
          currentNode.parentNode.querySelector('.expander').remove();
          currentNode.parentNode.querySelector('.ellipsis').remove();
        }
        break;

      case 'begin-array':
        if (!currentNode.classList.contains('objectProperty')) {
          currentNode.setAttribute('line-number', lineNumber++);
        }

        currentNode.appendChild(templates.expander());
        currentNode.appendChild(templates.openingBracket());
        currentNode.appendChild(templates.ellipsis());

        const arrayInner = templates.blockInner();
        arrayInner.tokenType = 'array';

        currentNode.appendChild(arrayInner);
        currentNode = arrayInner;
        break;

      case 'end-array':
        if (currentNode.classList.contains('arrayElement')) {
          currentNode = currentNode.parentNode;
        }

        const arrayContentNode = currentNode;
        currentNode = currentNode.parentNode;

        const closingBracket = templates.closingBracket();
        currentNode.appendChild(closingBracket);

        if (arrayContentNode.innerText.length) {
          closingBracket.setAttribute('line-number', lineNumber++);
        } else {
          arrayContentNode.remove();
          currentNode.parentNode.querySelector('.expander').remove();
          currentNode.parentNode.querySelector('.ellipsis').remove();
        }
        break;

      case 'string':
      case 'maybe-string':
        if (currentNode.tokenType === 'object') {
          const keyValueOrValue = templates.keyValueOrValue();
          keyValueOrValue.setAttribute('line-number', lineNumber++);
          keyValueOrValue.classList.add('objectProperty');

          const keySpan = templates.key();
          keySpan.textContent = token.content;
          keyValueOrValue.appendChild(keySpan);

          currentNode.appendChild(keyValueOrValue);
          currentNode = keyValueOrValue;
        } else {
          const innerStringEl = createSpan();
          const content = JSON.parse(token.content);
          let escapedValue = JSON.stringify(content);
          escapedValue = escapedValue.substring(1, escapedValue.length - 1);

          // crude but fast - some false positives, but rare, and UX doesn't suffer terribly from them.
          if (content[0] === 'h' && content.substring(0, 4) === 'http') {
            const innerStringA = document.createElement('A');
            innerStringA.href = escapedValue;
            innerStringA.innerText = escapedValue;
            innerStringEl.appendChild(innerStringA);
          } else {
            innerStringEl.innerText = escapedValue;
          }

          const valueElement = templates.string();
          valueElement.appendChild(templates.doubleQuoteText());
          valueElement.appendChild(innerStringEl);
          valueElement.appendChild(templates.doubleQuoteText());
          currentNode.appendChild(valueElement);
        }
        break;

      case 'null':
        currentNode.appendChild(templates.null());
        break;

      case 'boolean':
        const boolean = templates.boolean();
        boolean.innerText = token.content;
        currentNode.appendChild(boolean);
        break;

      case 'number':
      case 'maybe-decimal-number':
      case 'maybe-negative-number':
      case 'maybe-exponential-number':
      case 'maybe-exponential-number-negative':
        const numberElement = templates.number();
        numberElement.innerText = token.content;
        currentNode.appendChild(numberElement);
        break;

      case 'symbol':
        const symbolElement = templates.createSpan();
        symbolElement.innerText = token.content;
        currentNode.appendChild(symbolElement);
        break;
    }
  });

  tokenizer.end(jsonString);

  return new Promise((resolve) => {
    tokenizer.on('end', () => resolve(currentNode));
  });
}

//
// Table view rendering
//

// HTMLElement helper
function $(tag, classname, content) {
  // Make elementj
  const el = document.createElement(tag);

  // Set classname
  if (tag && classname) el.classList.add(classname);

  // Set content
  if (content != null) {
    if (Array.isArray(content)) {
      for (const o of content) {
        el.appendChild(o.nodeType ? o : document.createTextNode(o));
      }
    } else if (content.nodeType) {
      el.appendChild(content);
    } else {
      el.innerText = content;
    }
  }

  return el;
}

function _renderCell(content, cellTag = 'td') {
  if (content === null) return $(cellTag, 'null', 'null');
  if (content === undefined) {
    const cell = $(cellTag, 'undefined');
    cell.innerHTML = '&mdash;';
    return cell;
  }
  if (Array.isArray(content)) return $(cellTag, 'deep', 'array')
  if (content.constructor === Object) return $(cellTag, 'deep', 'object')

  let type = typeof(content);
  if (type == 'boolean') return $(cellTag, 'bool', content ? 'true' : 'false');
  if (type == 'string') return $(cellTag, 'string', content);
  if (type == 'number') return $(cellTag, 'number', content);

  throw Error(`Unexpected type: ${type} (${content})`);
}

function _renderRow(arr, cellTag) {
  const cells = [];
  for (const v of arr) {
    const cell = _renderCell(v, cellTag);
    // Header cells get 'key' styling
    if (cellTag == 'th') cell.className = 'key';
    cells.push(cell);
  }

  return $('tr', null, cells);
}

export function renderArrayAsTable(arr) {
  if (!Array.isArray(arr)) {
    return `<div>JSON is not an Array</div>`;
  }

  // Gather all object keys
  const keyIndex = new Map();
  let maxIndex = 0;
  let namedColumns = false;
  for (const item of arr) {
    if (!item || item.constructor !== Object) {
      if (Array.isArray(item)) {
        maxIndex = Math.max(maxIndex, item.length);
      }
      continue;
    }
    namedColumns = true;
    for (const key in item) {
      if (!keyIndex.has(key)) keyIndex.set(key, keyIndex.size);
    }
  }

  // Create header cells
  let header;
  if (namedColumns) {
    // Named column headers (object keys)
    header = [...keyIndex.keys()];
  } else {
    // Indexed column headers (array indexes)
    header = Array(maxIndex).fill().map((v, i) => i); // Array of indexes
  }

  header.unshift(''); // Header for row #
  header = _renderRow(header, 'th');

  const rows = arr.map((item, rowIndex) => {
    let cells;

    if (item && item.constructor === Object) {
      // Item is Object: Put values in appropriate column
      cells = [];
      // Put object values in approriate column
      for (const [k, v] of Object.entries(item)) {
        cells[keyIndex.get(k)] = v;
      }
    } else if (Array.isArray(item)) {
      // Item is Array
      if (namedColumns) {
        // Named columns: Can't meaningfully render
        cells = $('td', 'unexpected', 'Unexpected array');
      } else {
        // Indexed columns: put values in each column
        cells = item;
        cells.length = maxIndex;
      }
    } else {
      // Can't meaningfully render other values
      cells = $('td', 'unexpected', 'Unexpected value');
    }

    if (Array.isArray(cells)) {
      // Convert to table cells
      cells = _renderRow(cells);

      // Enable hover text
      for (const c of cells.children) c.title = c.innerText;
    } else { // String? hbhb
      // Single cell? Means this is an error message of some sort, so span
      // all columns and wrap in TR.
      cells.setAttribute('colspan', header.children.length - 1);
      cells = $('tr', null, cells);
    }

    // Prepend cell for row index
    cells.insertBefore($('td', null, rowIndex), cells.firstChild);

    return cells;
  });

  return $('table', null, [
    $('thead', null, header),
    $('tbody', null, rows)
  ]).outerHTML;
}
