const generator = require('../generatorCore');
const lookaheadMixin = require('../mixins/lookaheadMixin.js');
const lrGeneratorMixin = require('../mixins/lrGeneratorMixin.js');

const lr0Proto = generator.beget(
  lookaheadMixin,
  lrGeneratorMixin,
  {
    type: 'LR(0)',
    afterconstructor: function () {
      this.buildTable();
    }
  }
);

module.exports = lr0Proto.construct();
