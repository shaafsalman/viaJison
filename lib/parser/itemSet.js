/**
 * @fileoverview ItemSet class for parser state collections
 * @path lib/parser/itemSet.js
 */

'use strict';

const Set = require('../util/set').Set;

/**
 * ItemSet class extending Set to represent a collection of items
 * Used to represent parser states in LR parser construction
 */
const ItemSet = Set.prototype.construct({
  afterconstructor: function() {
    this.reductions = [];
    this.goes = {};
    this.edges = {};
    this.shifts = false;
    this.inadequate = false;
    this.hash_ = {};
    
    for (let i = this._items.length - 1; i >= 0; i--) {
      this.hash_[this._items[i].id] = true;
    }
  },
  
  concat: function(set) {
    const a = set._items || set;
    for (let i = a.length - 1; i >= 0; i--) {
      this.hash_[a[i].id] = true;
    }
    this._items.push.apply(this._items, a);
    return this;
  },
  
  push: function(item) {
    this.hash_[item.id] = true;
    return this._items.push(item);
  },
  
  contains: function(item) {
    return this.hash_[item.id];
  },
  
  valueOf: function() {
    const v = this._items.map(function(a) { return a.id; }).sort().join('|');
    this.valueOf = function() { return v; };
    return v;
  }
});

module.exports = ItemSet;