// lib/jison.js

const typal             = require('./util/typal.js').typal;
const generator         = require('./generatorCore');
exports._generator      = generator;               // so generatorCore can pick up parser

const generatorFactory  = require('./generators');
const { parseError }    = require('./util/utils.js');
const lrGeneratorMixin  = require('./mixins/lrGeneratorMixin.js');
const version           = require('../package.json').version;

const Jison             = exports.Jison = exports;
Jison.version           = version;
Jison.Generator         = generatorFactory;

// ——— detect print ———
if (typeof console !== 'undefined' && console.log) {
  Jison.print = console.log;
} else if (typeof puts !== 'undefined') {
  Jison.print = function print() { puts([].join.call(arguments, ' ')); };
} else if (typeof print !== 'undefined') {
  Jison.print = print;
} else {
  Jison.print = function print() {};
}

Jison.Parser = (function () {
  // Create the parser prototype
  var parser = typal.beget();
  Jison._parser = parser;
  parser.trace = generator.trace;
  parser.warn  = generator.warn;
  parser.error = generator.error;

  // Expose it for generatorCore.generateModule_
  exports._parser = parser;

  // Wire up parseError
  parser.parseError = lrGeneratorMixin.parseError = parseError;

  // The actual parse function (with error recovery, shift/reduce, accept)
  parser.parse = function parse(input) {
    const self = this;
    let stack = [0], vstack = [null], lstack = [];
    const table = this.table;
    let yytext = '', yylineno = 0, yyleng = 0, recovering = 0;
    const TERROR = 2, EOF = 1;
    const args = lstack.slice.call(arguments, 1);

    // Setup lexer
    const lexer = Object.create(this.lexer);
    const sharedState = { yy: {} };
    for (const k in this.yy) {
      if (Object.prototype.hasOwnProperty.call(this.yy, k)) {
        sharedState.yy[k] = this.yy[k];
      }
    }
    lexer.setInput(input, sharedState.yy);
    sharedState.yy.lexer = lexer;
    sharedState.yy.parser = this;
    if (typeof lexer.yylloc === 'undefined') lexer.yylloc = {};
    let yyloc = lexer.yylloc;
    lstack.push(yyloc);

    const ranges = lexer.options && lexer.options.ranges;

    if (typeof sharedState.yy.parseError === 'function') {
      this.parseError = sharedState.yy.parseError;
    } else {
      this.parseError = Object.getPrototypeOf(this).parseError;
    }

    function popStack(n) {
      stack.length = stack.length - 2 * n;
      vstack.length = vstack.length - n;
      lstack.length = lstack.length - n;
    }

    const lex = function () {
      let token = lexer.lex() || EOF;
      if (typeof token !== 'number') {
        token = self.symbols_[token] || token;
      }
      return token;
    };

    let symbol, preErrorSymbol, state, action, r;
    const yyval = {};
    let p, len, newState, expected;

    while (true) {
      state = stack[stack.length - 1];

      if (this.defaultActions[state]) {
        action = this.defaultActions[state];
      } else {
        if (symbol === null || typeof symbol === 'undefined') {
          symbol = lex();
        }
        action = table[state] && table[state][symbol];
      }

      if (typeof action === 'undefined' || !action.length || !action[0]) {
        // — error recovery (copy your existing logic) —
        let errorRuleDepth, errStr = '';
        function locateNearestErrorRecoveryRule(state) {
          let stackProbe = stack.length - 1, depth = 0;
          for (;;) {
            if ((TERROR.toString()) in table[state]) return depth;
            if (state === 0 || stackProbe < 2) return false;
            stackProbe -= 2;
            state = stack[stackProbe];
            ++depth;
          }
        }
        if (!recovering) {
          errorRuleDepth = locateNearestErrorRecoveryRule(state);
          expected = [];
          for (p in table[state]) {
            if (this.terminals_[p] && p > TERROR) {
              expected.push("'" + this.terminals_[p] + "'");
            }
          }
          if (lexer.showPosition) {
            errStr = 'Parse error on line ' + (yylineno + 1) + ':\n'
                   + lexer.showPosition()
                   + '\nExpecting ' + expected.join(', ')
                   + ", got '" + (this.terminals_[symbol] || symbol) + "'";
          } else {
            errStr = 'Parse error on line ' + (yylineno + 1) + ': Unexpected '
                   + (symbol === EOF ? 'end of input' : ("'" + (this.terminals_[symbol] || symbol) + "'"));
          }
          this.parseError(errStr, {
            text: lexer.match,
            token: this.terminals_[symbol] || symbol,
            line: lexer.yylineno,
            loc: yyloc,
            expected,
            recoverable: (errorRuleDepth !== false)
          });
        } else if (preErrorSymbol !== EOF) {
          errorRuleDepth = locateNearestErrorRecoveryRule(state);
        }
        if (recovering === 3) {
          if (symbol === EOF || preErrorSymbol === EOF) {
            throw new Error(errStr || 'Parsing halted while starting to recover from another error.');
          }
          yyleng = lexer.yyleng; yytext = lexer.yytext;
          yylineno = lexer.yylineno; yyloc = lexer.yylloc;
          symbol = lex();
        }
        if (errorRuleDepth === false) {
          throw new Error(errStr || 'Parsing halted. No suitable error recovery rule available.');
        }
        popStack(errorRuleDepth);
        preErrorSymbol = (symbol === TERROR ? null : symbol);
        symbol = TERROR;
        state = stack[stack.length - 1];
        action = table[state] && table[state][TERROR];
        recovering = 3;
      }

      if (action[0] instanceof Array && action.length > 1) {
        throw new Error('Parse Error: multiple actions possible at state: '
                      + state + ', token: ' + symbol);
      }

      switch (action[0]) {
        case 1: // SHIFT
          stack.push(symbol);
          vstack.push(lexer.yytext);
          lstack.push(lexer.yylloc);
          stack.push(action[1]);
          symbol = null;
          if (!preErrorSymbol) {
            yyleng = lexer.yyleng; yytext = lexer.yytext;
            yylineno = lexer.yylineno; yyloc = lexer.yylloc;
            if (recovering > 0) recovering--;
          } else {
            symbol = preErrorSymbol; preErrorSymbol = null;
          }
          break;

        case 2: // REDUCE
          len = this.productions_[action[1]][1];
          yyval.$ = vstack[vstack.length - len];
          yyval._$ = {
            first_line:  lstack[lstack.length - (len || 1)].first_line,
            last_line:   lstack[lstack.length - 1].last_line,
            first_column:lstack[lstack.length - (len || 1)].first_column,
            last_column: lstack[lstack.length - 1].last_column
          };
          if (ranges) {
            yyval._$.range = [
              lstack[lstack.length - (len || 1)].range[0],
              lstack[lstack.length - 1].range[1]
            ];
          }
          r = this.performAction.apply(yyval, [
            yytext, yyleng, yylineno, sharedState.yy, action[1], vstack, lstack
          ].concat(args));
          if (typeof r !== 'undefined') return r;
          if (len) {
            stack = stack.slice(0, -1 * len * 2);
            vstack = vstack.slice(0, -1 * len);
            lstack = lstack.slice(0, -1 * len);
          }
          stack.push(this.productions_[action[1]][0]);
          vstack.push(yyval.$);
          lstack.push(yyval._$);
          newState = table[stack[stack.length - 2]][stack[stack.length - 1]];
          stack.push(newState);
          break;

        case 3: // ACCEPT
          return true;
      }
    }
  };

  // Initialize parser from pre-built tables
  parser.init = function parserInitialization(dict) {
    this.table          = dict.table;
    this.defaultActions = dict.defaultActions;
    this.performAction  = dict.performAction;
    this.productions_   = dict.productions_;
    this.symbols_       = dict.symbols_;
    this.terminals_     = dict.terminals_;
  };

  // This returned function is the actual Parser constructor
  return function Parser(g, options) {
    const gen = Jison.Generator(g, options);
    return gen.createParser();
  };
})();
