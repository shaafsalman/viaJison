// generators/index.js
const LR0  = require('./lr0');
const SLR  = require('./slr');
const LR1  = require('./lr1');
const LL   = require('./ll');
const LALR = require('./lalr');

const map = { lr0: LR0, slr: SLR, lr: LR1, ll: LL };

module.exports = function generatorFactory(grammar, options) {
  const opt = require('../util/typal.js').typal
    .mix.call({}, grammar.options, options);
  const Gen = map[opt.type] || LALR;
  return new Gen(grammar, opt);
};
