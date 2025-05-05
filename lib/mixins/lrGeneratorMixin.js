// lib/mixins/lrGeneratorMixin.js
// Mixin for common LR parser behavior

const typal               = require('../util/typal.js').typal;
const Set                 = require('../util/set.js').Set;
const version             = require('../../package.json').version;
const {
  resolveConflict,
  findDefaults,
  commonjsMain,
  printAction,
  each,
  removeErrorRecovery
} = require('../util/utils.js');

// ——— fallback parser error that just traces the message ———
function traceParseError(err, hash) {
  this.trace(err);
}

const lrGeneratorMixin = {};

// — buildTable —
lrGeneratorMixin.buildTable = function buildTable() {
  if (this.DEBUG) this.mix(lrGeneratorDebug);
  this.states         = this.canonicalCollection();
  this.table          = this.parseTable(this.states);
  this.defaultActions = findDefaults(this.table);
};

// — Item class —
lrGeneratorMixin.Item = typal.construct({
  constructor: function Item(production, dot, f, predecessor) {
    this.production   = production;
    this.dotPosition  = dot || 0;
    this.follows      = f || [];
    this.predecessor  = predecessor;
    this.id           = parseInt(production.id + 'a' + this.dotPosition, 36);
    this.markedSymbol = this.production.handle[this.dotPosition];
  },
  remainingHandle: function() {
    return this.production.handle.slice(this.dotPosition + 1);
  },
  eq: function(e) {
    return e.id === this.id;
  },
  handleToString: function() {
    const handle = this.production.handle.slice(0);
    handle[this.dotPosition] = '.' + (handle[this.dotPosition] || '');
    return handle.join(' ');
  },
  toString: function() {
    const temp = this.production.handle.slice(0);
    temp[this.dotPosition] = '.' + (temp[this.dotPosition] || '');
    return this.production.symbol + ' -> ' + temp.join(' ') +
      (this.follows.length === 0 ? '' : ' #lookaheads= ' + this.follows.join(' '));
  }
});

// — ItemSet class —
lrGeneratorMixin.ItemSet = Set.prototype.construct({
  afterconstructor: function() {
    this.reductions = [];
    this.goes       = {};
    this.edges      = {};
    this.shifts     = false;
    this.inadequate = false;
    this.hash_      = {};
    for (let i = this._items.length - 1; i >= 0; i--) {
      this.hash_[this._items[i].id] = true;
    }
  },
  concat: function(other) {
    const a = other._items || other;
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
  valueOf: function toValue() {
    const v = this._items.map(a => a.id).sort().join('|');
    this.valueOf = () => v;
    return v;
  }
});

// — closureOperation —
lrGeneratorMixin.closureOperation = function closureOperation(itemSet) {
  const closureSet = new this.ItemSet();
  const self       = this;
  let set          = itemSet;
  let itemQueue;
  const syms       = {};

  do {
    itemQueue = new Set();
    closureSet.concat(set);
    set.forEach(item => {
      const symbol = item.markedSymbol;
      if (symbol && self.nonterminals[symbol]) {
        if (!syms[symbol]) {
          self.nonterminals[symbol].productions.forEach(production => {
            const newItem = new self.Item(production, 0);
            if (!closureSet.contains(newItem)) itemQueue.push(newItem);
          });
          syms[symbol] = true;
        }
      }
      else if (!symbol) {
        closureSet.reductions.push(item);
        closureSet.inadequate = closureSet.reductions.length > 1 || closureSet.shifts;
      }
      else {
        closureSet.shifts     = true;
        closureSet.inadequate = closureSet.reductions.length > 0;
      }
    });
    set = itemQueue;
  } while (!itemQueue.isEmpty());

  return closureSet;
};

// — gotoOperation —
lrGeneratorMixin.gotoOperation = function gotoOperation(itemSet, symbol) {
  const gotoSet = new this.ItemSet();
  const self    = this;

  itemSet.forEach((item, idx) => {
    if (item.markedSymbol === symbol) {
      gotoSet.push(new self.Item(item.production, item.dotPosition + 1, item.follows, idx));
    }
  });

  return gotoSet.isEmpty() ? gotoSet : this.closureOperation(gotoSet);
};

// — canonicalCollection —
lrGeneratorMixin.canonicalCollection = function canonicalCollection() {
  const item1      = new this.Item(this.productions[0], 0, [this.EOF]);
  const firstState = this.closureOperation(new this.ItemSet(item1));
  const states     = new Set(firstState);
  let marked       = 0;
  const self       = this;

  states.has = {};
  states.has[firstState] = 0;

  while (marked !== states.size()) {
    const itemSet = states.item(marked++);
    itemSet.forEach(item => {
      if (item.markedSymbol && item.markedSymbol !== self.EOF) {
        self.canonicalCollectionInsert(item.markedSymbol, itemSet, states, marked - 1);
      }
    });
  }

  return states;
};

// — canonicalCollectionInsert —
lrGeneratorMixin.canonicalCollectionInsert = function canonicalCollectionInsert(symbol, itemSet, states, stateNum) {
  const g = this.gotoOperation(itemSet, symbol);
  if (!g.predecessors) g.predecessors = {};
  if (!g.isEmpty()) {
    const gv = g.valueOf();
    const i  = states.has[gv];
    if (i === -1 || typeof i === 'undefined') {
      states.has[gv]       = states.size();
      itemSet.edges[symbol] = states.size();
      states.push(g);
      g.predecessors[symbol] = [stateNum];
    }
    else {
      itemSet.edges[symbol] = i;
      states.item(i).predecessors[symbol].push(stateNum);
    }
  }
};

const NONASSOC = 0;

// — parseTable —
lrGeneratorMixin.parseTable = function parseTable(itemSets) {
  const states          = [];
  const nonterminals    = this.nonterminals;
  const operators       = this.operators;
  const conflictedStates= {};
  const self            = this;
  const s               = 1;  // shift
  const r               = 2;  // reduce
  const a               = 3;  // accept

  itemSets.forEach((itemSet, k) => {
    const state = states[k] = {};
    let action;

    // shift/goto
    for (const sym in itemSet.edges) {
      itemSet.forEach(item => {
        if (item.markedSymbol === sym) {
          const gotoState = itemSet.edges[sym];
          if (nonterminals[sym]) {
            state[this.symbols_[sym]] = gotoState;
          } else {
            state[this.symbols_[sym]] = [s, gotoState];
          }
        }
      });
    }

    // accept
    itemSet.forEach(item => {
      if (item.markedSymbol === self.EOF) {
        state[self.symbols_[self.EOF]] = [a];
      }
    });

    const allterms = this.lookAheads ? false : this.terminals;

    // reductions & conflict resolution
    itemSet.reductions.forEach(item => {
      const terms = allterms || this.lookAheads(itemSet, item);
      terms.forEach(tok => {
        action = state[this.symbols_[tok]];
        const op = operators[tok];
        if (action || (action && action.length)) {
          const sol = resolveConflict(item.production, op, [r, item.production.id], action[0] instanceof Array ? action[0] : action);
          this.resolutions.push([k, tok, sol]);
          if (sol.bydefault) {
            this.conflicts++;
            if (!this.DEBUG) {
              this.warn(
                'Conflict: state', k, 'token', tok,
                '\n -', printAction(sol.r, this),
                '\n -', printAction(sol.s, this)
              );
              conflictedStates[k] = true;
            }
            if (this.options.noDefaultResolve) {
              if (!(action[0] instanceof Array)) action = [action];
              action.push(sol.r);
            }
          }
          else {
            action = sol.action;
          }
        } else {
          action = [r, item.production.id];
        }
        if (action && action.length) {
          state[this.symbols_[tok]] = action;
        } else if (action === NONASSOC) {
          state[this.symbols_[tok]] = undefined;
        }
      });
    });
  });

  if (!this.DEBUG && this.conflicts > 0) {
    this.warn('\nStates with conflicts:');
    each(conflictedStates, (_, st) => {
      this.warn(' State', st);
      this.warn('  ', itemSets.item(st).join('\n  '));
    });
  }

  return states;
};

// — generate (main entry) —
lrGeneratorMixin.generate = function parserGenerate(opt) {
  opt = typal.mix.call({}, this.options, opt);
  let code = '';
  switch (opt.moduleType) {
    case 'js':
      code = this.generateModule(opt);
      break;
    case 'amd':
      code = this.generateAMDModule(opt);
      break;
    default:
      code = this.generateCommonJSModule(opt);
      break;
  }
  return code;
};

// — generateModule (IIFE + assignment) —
lrGeneratorMixin.generateModule = function generateModule(opt) {
  opt = typal.mix.call({}, this.options, opt);
  const moduleName = opt.moduleName || 'parser';
  const assignment = moduleName.includes('.') ? moduleName : 'var ' + moduleName;
  return assignment + ' = ' + this.generateModuleExpr();
};

// — AMD wrapper —
lrGeneratorMixin.generateAMDModule = function generateAMDModule(opt) {
  opt = typal.mix.call({}, this.options, opt);
  const module = this.generateModule_();
  return '\n\ndefine(function(require){\n' +
    module.commonCode +
    '\nvar parser = ' + module.moduleCode +
    '\n' + this.moduleInclude +
    (this.lexer && this.lexer.generateModule
      ? '\n' + this.lexer.generateModule() + '\nparser.lexer = lexer;'
      : '') +
    '\nreturn parser;' +
    '\n});';
};

lrGeneratorMixin.generateCommonJSModule = function generateCommonJSModule(opt) {
  opt = typal.mix.call({}, this.options, opt);
  const moduleName = opt.moduleName || 'parser';

  // 1) get the raw pieces
  const mod = this.generateModule_();        // { commonCode, moduleCode }

  // 2) header + table init
  let out  = mod.commonCode + "\n";
  out     += "var " + moduleName + " = " + mod.moduleCode + ";\n";

  // 3) insert any parser‐side moduleInclude
  if (this.moduleInclude) {
    out += this.moduleInclude + "\n";
  }

  // 4) insert the lexer code (including lexer's moduleInclude)
  if (this.lexer && this.lexer.generateModule) {
    out += this.lexer.generateModule() + "\n";
    out += moduleName + ".lexer = lexer;\n";
  }

  // 5) exports
  out += "if (typeof require !== 'undefined' && typeof exports !== 'undefined') {\n" +
         "  exports.parser = " + moduleName + ";\n" +
         "  exports.Parser = " + moduleName + ".Parser;\n" +
         "  exports.parse = function() { return " + moduleName + ".parse.apply(" + moduleName + ", arguments); };\n" +
         "  exports.main = " + String(opt.moduleMain || commonjsMain) + ";\n" +
         "  if (typeof module !== 'undefined' && require.main === module) {\n" +
         "    exports.main(process.argv.slice(1));\n" +
         "  }\n" +
       "}\n";

  return out;
};


lrGeneratorMixin.generateModule = function generateModule(opt) {
  // merge in any opts the user passed
  opt = typal.mix.call({}, this.options, opt);
  // pick a name for the global parser variable
  const moduleName = opt.moduleName || 'parser';
  // a little banner
  let out = '/* parser generated by jison ' + version + ' */\n';
  // if it's a dotted name we assume they wanted a namespace,
  // otherwise we write `var parser = …`
  out += (moduleName.match(/\./) ? '' : 'var ' + moduleName) +
         ' = ' + this.generateModuleExpr();
  return out;
};

// — code‐generation core —
lrGeneratorMixin.generateModule_ = function generateModule_() {
  const parser = require('../jison')._parser;
  let parseFn = String(parser.parse);
  if (!this.hasErrorRecovery)      parseFn = removeErrorRecovery(parseFn);
  if (this.options['token-stack']) parseFn = this.addTokenStack(parseFn);

  nextVariableId     = 0;
  const tableCode    = this.generateTableCode(this.table);
  const commonCode   = tableCode.commonCode;
  const moduleBody   = [
    'trace: ' + String(this.trace || parser.trace),
    'yy: {}',
    'symbols_: ' + JSON.stringify(this.symbols_),
    'terminals_: ' + JSON.stringify(this.terminals_).replace(/"([0-9]+)":/g, '$1:'),
    'productions_: ' + JSON.stringify(this.productions_),
    'performAction: ' + String(this.performAction),
    'table: ' + tableCode.moduleCode,
    'defaultActions: ' + JSON.stringify(this.defaultActions).replace(/"([0-9]+)":/g, '$1:'),
    'parseError: ' + String(
      this.parseError ||
      (this.hasErrorRecovery ? traceParseError : parser.parseError)
    ),
    'parse: ' + parseFn
  ].join(',\n');

  return {
    commonCode,
    moduleCode: '{' + moduleBody + '};'
  };
};

// — wrap in IIFE and return instance —
lrGeneratorMixin.generateModuleExpr = function generateModuleExpr() {
  const module = this.generateModule_();
  let out = '(function(){\n' +
    module.commonCode +
    '\nvar parser = ' + module.moduleCode +
    '\n' + this.moduleInclude;
  if (this.lexer && this.lexer.generateModule) {
    out += '\n' + this.lexer.generateModule() + '\nparser.lexer = lexer;';
  }
  out += '\nfunction Parser(){ this.yy = {}; }' +
    'Parser.prototype = parser;' +
    'parser.Parser   = Parser;' +
    '\nreturn new Parser;\n})();';
  return out;
};

// — createParser for runtime use —
lrGeneratorMixin.createParser = function createParser() {
  const p = eval(this.generateModuleExpr());
  p.productions = this.productions;
  const self     = this;
  function bind(method) {
    return function() {
      self.lexer = p.lexer;
      return self[method].apply(self, arguments);
    };
  }
  p.lexer                  = this.lexer;
  p.generate               = bind('generate');
  p.generateModule         = bind('generateModule');
  p.generateAMDModule      = bind('generateAMDModule');
  p.generateCommonJSModule = bind('generateCommonJSModule');
  return p;
};

module.exports = lrGeneratorMixin;
