const generator = require('../generatorCore');
const lookaheadMixin = require('../mixins/lookaheadMixin.js');

const llProto = generator.beget(
  lookaheadMixin,
  {
    type: 'LL(1)',
    afterconstructor: function () {
      this.computeLookaheads();
      this.table = this.parseTable(this.productions);
    },

    parseTable: function (productions) {
      const table = {};
      productions.forEach((prod, i) => {
        const row = table[prod.symbol] || {};
        let tokens = prod.first.slice();
        if (this.nullable(prod.handle)) {
          tokens = tokens.concat(this.nonterminals[prod.symbol].follows);
        }
        tokens.forEach(tok => {
          if (row[tok]) {
            row[tok].push(i);
            this.conflicts++;
          } else {
            row[tok] = [i];
          }
        });
        table[prod.symbol] = row;
      });
      return table;
    }
  }
);

module.exports = llProto.construct();
