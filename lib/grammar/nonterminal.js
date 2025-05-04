/**
 * @fileoverview Nonterminal class for grammar representation
 * @path lib/grammar/nonterminal.js
 */

'use strict';

const typal = require('../util/typal').typal;
const Set = require('../util/set').Set;

/**
 * Nonterminal class representing a non-terminal symbol in a grammar
 */
const Nonterminal = typal.construct({
  constructor: function Nonterminal(symbol) {
    this.symbol = symbol;
    this.productions = new Set();
    this.first = [];
    this.follows = [];
    this.nullable = false;
  },
  
  toString: function nonterminalToString() {
    let str = this.symbol + '\n';
    str += (this.nullable ? 'nullable' : 'not nullable');
    str += '\nFirsts: ' + this.first.join(', ');
    str += '\nFollows: ' + this.follows.join(', ');
    str += '\nProductions:\n  ' + this.productions.join('\n  ');

    return str;
  }
});

module.exports = Nonterminal;