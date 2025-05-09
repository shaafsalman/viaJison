/**
 * @fileoverview Item class for parser state representation
 * @path lib/parser/item.js
 */

'use strict';

const typal = require('../util/typal').typal;


const Item = typal.construct({
  constructor: function Item(production, dot, f, predecessor) {
    this.production = production;
    this.dotPosition = dot || 0;
    this.follows = f || [];
    this.predecessor = predecessor;
    this.id = parseInt(production.id + 'a' + this.dotPosition, 36);
    this.markedSymbol = this.production.handle[this.dotPosition];
  },
  
  remainingHandle: function() {
    return this.production.handle.slice(this.dotPosition + 1);
  },
  
  eq: function(e) {
    return e.id === this.id;
  },
  
  toString: function() {
    const handle = this.production.handle.slice(0);
    handle[this.dotPosition] = '.' + (handle[this.dotPosition] || '');
    return this.production.symbol + ' -> ' + handle.join(' ') +
      (this.follows.length === 0 ? '' : ' #lookaheads= ' + this.follows.join(' '));
  }
});

module.exports = Item;