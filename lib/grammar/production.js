/**
 * @fileoverview Production class for grammar rules
 * @path lib/grammar/production.js
 */

'use strict';

const typal = require('../util/typal').typal;

/**
 * Production class representing a grammar production rule
 */
const Production = typal.construct({
  constructor: function Production(symbol, handle, id) {
    this.symbol = symbol;
    this.handle = handle;
    this.nullable = false;
    this.id = id;
    this.first = [];
    this.precedence = 0;
  },
  
  toString: function productionToString() {
    return this.symbol + ' -> ' + this.handle.join(' ');
  }
});

module.exports = Production;