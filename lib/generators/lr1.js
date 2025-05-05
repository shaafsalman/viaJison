const generator = require('../generatorCore');
const lookaheadMixin = require('../mixins/lookaheadMixin.js');
const lrGeneratorMixin = require('../mixins/lrGeneratorMixin.js');
const Set = require('../util/set.js').Set;

// Extend the Item class to key on lookahead sets
const Item = lrGeneratorMixin.Item.prototype.construct({
  afterconstructor: function () {
    this.id = `${this.production.id}a${this.dotPosition}a${this.follows.sort().join(',')}`;
  },
  eq: function (other) {
    return other.id === this.id;
  }
});

const lr1Proto = generator.beget(
  lookaheadMixin,
  lrGeneratorMixin,
  {
    type: 'Canonical LR(1)',
    lookAheads: function (state, item) {
      return item.follows;
    },
    Item,

    // exactly as in the monolithic jison.js
    closureOperation: function (itemSet) {
      const closureSet = new this.ItemSet();
      let set = itemSet;
      let itemQueue;
      do {
        itemQueue = new Set();
        closureSet.concat(set);
        set.forEach(item => {
          const symbol = item.markedSymbol;
          let b, r;
          if (symbol && this.nonterminals[symbol]) {
            r = item.remainingHandle();
            b = this.first(item.remainingHandle());
            if (b.length === 0 || item.production.nullable || this.nullable(r)) {
              b = b.concat(item.follows);
            }
            this.nonterminals[symbol].productions.forEach(production => {
              const newItem = new this.Item(production, 0, b);
              if (!closureSet.contains(newItem) && !itemQueue.contains(newItem)) {
                itemQueue.push(newItem);
              }
            });
          } else if (!symbol) {
            closureSet.reductions.push(item);
          }
        });
        set = itemQueue;
      } while (!itemQueue.isEmpty());
      return closureSet;
    }
  }
);

module.exports = lr1Proto.construct();
