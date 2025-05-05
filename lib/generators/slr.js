const generator = require('../generatorCore');
const lookaheadMixin = require('../mixins/lookaheadMixin.js');
const lrGeneratorMixin = require('../mixins/lrGeneratorMixin.js');

const slrProto = generator.beget(
  lookaheadMixin,
  lrGeneratorMixin,
  {
    type: 'SLR(1)',
    lookAheads: function (state, item) {
      return this.nonterminals[item.production.symbol].follows;
    }
  }
);

module.exports = slrProto.construct();
