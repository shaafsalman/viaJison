/**
 * @fileoverview Grammar components for parser generator
 * @path lib/grammar/index.js
 */

'use strict';

const Nonterminal = require('./nonterminal');
const Production = require('./production');

module.exports = {
  Nonterminal,
  Production
};