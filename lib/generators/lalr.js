// lib/generators/lalr.js

const typal            = require('../util/typal.js').typal;
const generator        = require('../generatorCore');
const lookaheadMixin   = require('../mixins/lookaheadMixin.js');
const lrGeneratorMixin = require('../mixins/lrGeneratorMixin.js');
const { findDefaults } = require('../util/utils.js');
const { Nonterminal, Production } = require('../grammar');
const Set               = require('../util/set.js').Set;

const lalrDebug = {
  beforebuildNewGrammar() { this.trace(this.states.size() + ' states.'); },
  beforeunionLookaheads()  { this.trace('Computing lookaheads.'); }
};

const lalrProto = generator.beget(
  lookaheadMixin,
  lrGeneratorMixin,
  {
    type: 'LALR(1)',

    // Bring in go and goPath exactly as in the original Jison
    go(p, w) {
      let q = parseInt(p, 10);
      for (let i = 0; i < w.length; i++) {
        q = this.states.item(q).edges[w[i]] || q;
      }
      return q;
    },

    goPath(p, w) {
      let q = parseInt(p, 10);
      const path = [];
      let t;
      for (let i = 0; i < w.length; i++) {
        t = w[i] ? q + ':' + w[i] : '';
        if (t) this.newg.nterms_[t] = q;
        path.push(t);
        q = this.states.item(q).edges[w[i]] || q;
        this.terms_[t] = w[i];
      }
      return { path, endState: q };
    },

    afterconstructor(grammar, options) {
      if (this.DEBUG) this.mix(lalrDebug);
      options = options || {};

      // 1. Build the canonical collection
      this.states = this.canonicalCollection();
      this.terms_ = {};
      this.onDemandLookahead = options.onDemandLookahead || false;

      // 2. Helper grammar for lookahead
      this.newg = typal.beget(
        lookaheadMixin,    // <-- must include the mixin for goPath on newg
        {
          oldg: this,
          trace: this.trace,
          nterms_: {},
          DEBUG: false,
          go_(r, B) {
            r = r.split(':')[0];
            B = B.map(x => x.slice(x.indexOf(':') + 1));
            return this.oldg.go(r, B);
          }
        }
      );
      this.newg.nonterminals = {};
      this.newg.productions  = [];
      this.inadequateStates  = [];

      // 3. Build and merge lookaheads
      this.buildNewGrammar();
      this.newg.computeLookaheads();
      this.unionLookaheads();

      // 4. Final parse table + defaults
      this.table          = this.parseTable(this.states);
      this.defaultActions = findDefaults(this.table);
    },

    lookAheads(state, item) {
      return (this.onDemandLookahead && !state.inadequate)
        ? this.terminals
        : item.follows;
    },

    buildNewGrammar() {
      const self = this, newg = this.newg;
      this.states.forEach((state, i) => {
        state.forEach(item => {
          if (item.dotPosition === 0) {
            const symbol = i + ':' + item.production.symbol;
            self.terms_[symbol]      = item.production.symbol;
            newg.nterms_[symbol]     = i;
            if (!newg.nonterminals[symbol]) {
              newg.nonterminals[symbol] = new Nonterminal(symbol);
            }
            const pathInfo = self.goPath(i, item.production.handle);
            const p = new Production(symbol, pathInfo.path, newg.productions.length);
            newg.productions.push(p);
            newg.nonterminals[symbol].productions.push(p);

            const handle = item.production.handle.join(' ');
            const goes   = self.states.item(pathInfo.endState).goes;
            goes[handle] = goes[handle] || [];
            goes[handle].push(symbol);
          }
        });
        if (state.inadequate) self.inadequateStates.push(i);
      });
    },

    unionLookaheads() {
      const self = this, newg = this.newg;
      const states = this.onDemandLookahead ? this.inadequateStates : this.states;
      states.forEach(i => {
        const state = (typeof i === 'number') ? self.states.item(i) : i;
        if (state.reductions.length) {
          state.reductions.forEach(item => {
            const seen = {};
            item.follows.forEach(f => { seen[f] = true; });
            state.goes[item.production.handle.join(' ')].forEach(symbol => {
              newg.nonterminals[symbol].follows.forEach(followSym => {
                if (!seen[followSym]) {
                  seen[followSym] = true;
                  item.follows.push(followSym);
                }
              });
            });
          });
        }
      });
    }
  }
);

module.exports = lalrProto.construct();
