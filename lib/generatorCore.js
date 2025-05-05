// lib/generatorCore.js

// ——— Dependencies ———
const typal       = require('./util/typal.js').typal;
const Set         = require('./util/set.js').Set;
const Lexer       = require('jison-lex');
const ebnfParser  = require('ebnf-parser');
const JSONSelect  = require('JSONSelect');
const esprima     = require('esprima');
const escodegen   = require('escodegen');
const {
  removeErrorRecovery,
  createVariable,
  parseError,
  findDefaults
} = require('./util/utils.js');
const processGrammar     = require('./generators/generator.js');  // your grammar-processor
const lookaheadMixin     = require('./mixins/lookaheadMixin.js');
const { Nonterminal, Production } = require('./grammar');
const { aliasRegex }     = require('./core/constants.js');
const lrGeneratorMixin   = require('./mixins/lrGeneratorMixin.js');
const { printAction }    = require('./util/utils.js');

function each(obj, func) {
    if (obj.forEach) {
      obj.forEach(func);
    } else {
      for (const p in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, p)) {
          func.call(obj, obj[p], p, obj);
        }
      }
    }
  }

// ——— Base Generator Prototype ———
const generator = typal.beget();

generator.constructor = function jisonGenerator (grammar, opt) {
  if (typeof grammar === 'string') {
    grammar = ebnfParser.parse(grammar)
  }

  const options = typal.mix.call({}, grammar.options, opt)
  this.terms = {}
  this.operators = {}
  this.productions = []
  this.conflicts = 0
  this.resolutions = []
  this.options = options
  this.parseParams = grammar.parseParams
  this.yy = {} // accessed as yy free variable in the parser/lexer actions

  // source included in semantic action execution scope
  if (grammar.actionInclude) {
    if (typeof grammar.actionInclude === 'function') {
      grammar.actionInclude = String(grammar.actionInclude).replace(/^\s*function \(\) \{/, '').replace(/}\s*$/, '')
    }
    this.actionInclude = grammar.actionInclude
  }
  this.moduleInclude = grammar.moduleInclude || ''

  this.DEBUG = options.debug || false
  if (this.DEBUG) this.mix(generatorDebug) // mixin debug methods

  processGrammar.call(this, grammar)
  this.augmentGrammar(grammar)

  if (grammar.lex) {
    this.lexer = new Lexer(grammar.lex, null, this.terminals_)
  }
}

generator.augmentGrammar = function augmentGrammar (grammar) {
  if (this.productions.length === 0) {
    throw new Error('Grammar error: must have at least one rule.')
  }

  // use specified start symbol, or default to first user defined production
  this.startSymbol = grammar.start || grammar.startSymbol || this.productions[0].symbol

  if (!this.nonterminals[this.startSymbol]) {
    throw new Error('Grammar error: startSymbol must be a non-terminal found in your grammar.')
  }

  this.EOF = '$end'

  // augment the grammar
  const acceptProduction = new Production('$accept', [this.startSymbol, '$end'], 0)
  this.productions.unshift(acceptProduction)

  // prepend parser tokens
  this.symbols.unshift('$accept', this.EOF)
  this.symbols_.$accept = 0
  this.symbols_[this.EOF] = 1
  this.terminals.unshift(this.EOF)

  this.nonterminals.$accept = new Nonterminal('$accept') // <-- Added parentheses
  this.nonterminals.$accept.productions.push(acceptProduction)

  // add follow $ to start symbol
  this.nonterminals[this.startSymbol].follows.push(this.EOF)
}

generator.buildProductions = function buildProductions (bnf, productions, nonterminals, symbols, operators) {
  let actions = [
    '/* this == yyval */',
    this.actionInclude || '',
    'var $0 = $$.length - 1;',
    'switch (yystate) {'
  ]
  const actionGroups = {}
  let prods, symbol
  const productions_ = [0]
  let symbolId = 1
  const symbols_ = {}

  let her = false // has error recovery

  function addSymbol (s) {
    if (s && !symbols_[s]) {
      symbols_[s] = ++symbolId
      symbols.push(s)
    }
  }

  // add error symbol; will be third symbol, or "2" ($accept, $end, error)
  addSymbol('error')

  for (symbol in bnf) {
    if (!Object.prototype.hasOwnProperty.call(bnf, symbol)) continue

    addSymbol(symbol)
    nonterminals[symbol] = new Nonterminal(symbol)

    if (typeof bnf[symbol] === 'string') {
      prods = bnf[symbol].split(/\s*\|\s*/g)
    } else {
      prods = bnf[symbol].slice(0)
    }

    prods.forEach(buildProduction)
  }
  for (const action in actionGroups) { actions.push(actionGroups[action].join(' '), action, 'break;') }

  const terms = []; const terms_ = {}
  each(symbols_, function (id, sym) {
    if (!nonterminals[sym]) {
      terms.push(sym)
      terms_[id] = sym
    }
  })

  this.hasErrorRecovery = her

  this.terminals = terms
  this.terminals_ = terms_
  this.symbols_ = symbols_

  this.productions_ = productions_
  actions.push('}')

  actions = actions.join('\n')
    .replace(/YYABORT/g, 'return false')
    .replace(/YYACCEPT/g, 'return true')

  let parameters = 'yytext, yyleng, yylineno, yy, yystate /* action[1] */, $$ /* vstack */, _$ /* lstack */'
  if (this.parseParams) parameters += ', ' + this.parseParams.join(', ')

  this.performAction = 'function anonymous(' + parameters + ') {\n' + actions + '\n}'

  function buildProduction (handle) {
    let r, rhs, i
    if (handle.constructor === Array) {
      let rhs;
      if (typeof handle[0] === 'string') {
        const raw = handle[0].trim();
        rhs = raw
          ? raw.split(/\s+/)
          : [];
      }
      else {
        rhs = handle[0].slice(0);
      }


      for (i = 0; i < rhs.length; i++) {
        if (rhs[i] === 'error') her = true
        if (!symbols_[rhs[i]]) {
          addSymbol(rhs[i])
        }
      }

      if (typeof handle[1] === 'string' || handle.length === 3) {
        // semantic action specified
        const label = 'case ' + (productions.length + 1) + ':'; let action = handle[1]

        // replace named semantic values ($nonterminal)
        if (action.match(/[$@][a-zA-Z][a-zA-Z0-9_]*/)) {
          const count = {}
          const names = {}
          for (i = 0; i < rhs.length; i++) {
            // check for aliased names, e.g., id[alias]
            let rhsI = rhs[i].match(/\[[a-zA-Z][a-zA-Z0-9_-]*]/)
            if (rhsI) {
              rhsI = rhsI[0].substr(1, rhsI[0].length - 2)
              rhs[i] = rhs[i].substr(0, rhs[i].indexOf('['))
            } else {
              rhsI = rhs[i]
            }

            if (names[rhsI]) {
              names[rhsI + (++count[rhsI])] = i + 1
            } else {
              names[rhsI] = i + 1
              names[rhsI + '1'] = i + 1
              count[rhsI] = 1
            }
          }
          action = action.replace(/\$([a-zA-Z][a-zA-Z0-9_]*)/g, function (str, pl) {
            return names[pl] ? '$' + names[pl] : str
          }).replace(/@([a-zA-Z][a-zA-Z0-9_]*)/g, function (str, pl) {
            return names[pl] ? '@' + names[pl] : str
          })
        }
        action = action
          // replace references to $$ with this.$, and @$ with this._$
          .replace(/([^'"])\$\$|^\$\$/g, '$1this.$').replace(/@[0$]/g, 'this._$')

          // replace semantic value references ($n) with stack value (stack[n])
          .replace(/\$(-?\d+)/g, function (_, n) {
            return '$$[$0' + (parseInt(n, 10) - rhs.length || '') + ']'
          })
          // same as above for location references (@n)
          .replace(/@(-?\d+)/g, function (_, n) {
            return '_$[$0' + (n - rhs.length || '') + ']'
          })
        if (action in actionGroups) actionGroups[action].push(label)
        else actionGroups[action] = [label]

        // done with aliases; strip them.
        rhs = rhs.map(function (e, i) { return e.replace(aliasRegex, '') })
        r = new Production(symbol, rhs, productions.length + 1)
        // precedence specified also
        if (handle[2] && operators[handle[2].prec]) {
          r.precedence = operators[handle[2].prec].precedence
        }
      } else {
        // no action -> don't care about aliases; strip them.
        rhs = rhs.map(function (e, i) { return e.replace(aliasRegex, '') })
        // only precedence specified
        r = new Production(symbol, rhs, productions.length + 1)
        if (operators[handle[1].prec]) {
          r.precedence = operators[handle[1].prec].precedence
        }
      }
    } else {
      // no action -> don't care about aliases; strip them.
      handle = handle.replace(aliasRegex, '').trim();
      let rhs = handle
        ? handle.split(/\s+/)
        : [];
      for (i = 0; i < rhs.length; i++) {
        if (rhs[i] === 'error') her = true
        if (!symbols_[rhs[i]]) {
          addSymbol(rhs[i])
        }
      }
      r = new Production(symbol, rhs, productions.length + 1)
    }
    if (r.precedence === 0) {
      // set precedence
      for (i = r.handle.length - 1; i >= 0; i--) {
        if (!(r.handle[i] in nonterminals) && r.handle[i] in operators) {
          r.precedence = operators[r.handle[i]].precedence
        }
      }
    }

    productions.push(r)
    productions_.push([symbols_[r.symbol], r.handle[0] === '' ? 0 : r.handle.length])
    nonterminals[symbol].productions.push(r)
  }
}

generator.createParser = function createParser () {
  throw new Error('Calling abstract method.')
}

// noop. implemented in debug mixin
generator.trace = function trace () { }

generator.warn = function warn () {
  const args = Array.prototype.slice.call(arguments, 0)
  Jison.print.call(null, args.join(''))
}

generator.error = function error (msg) {
  throw new Error(msg)
}

// Generator debug mixin

const generatorDebug = {
  trace: function trace () {
    console.log.apply(console, arguments);
  },
  beforeprocessGrammar: function () {
    this.trace('Processing grammar.')
  },
  afteraugmentGrammar: function () {
    const trace = this.trace
    each(this.symbols, function (sym, i) {
      trace(sym + '(' + i + ')')
    })
  }
}

function addTokenStack (fn) {
  const parseFn = fn
  try {
    const ast = esprima.parse(parseFn)
    const stackAst = esprima.parse(String(tokenStackLex)).body[0]
    stackAst.id.name = 'lex'

    const labeled = JSONSelect.match(':has(:root > .label > .name:val("_token_stack"))', ast)

    labeled[0].body = stackAst

    return escodegen.generate(ast).replace(/_token_stack:\s?/, '').replace(/\\\\n/g, '\\n')
  } catch (e) {
    return parseFn
  }
}

// lex function that supports token stacks
function tokenStackLex () {
  let token = tokenStack.pop() || lexer.lex() || EOF
  // if token isn't its numeric value, convert
  if (typeof token !== 'number') {
    if (token instanceof Array) {
      tokenStack = token
      token = tokenStack.pop()
    }
    token = self.symbols_[token] || token
  }
  return token
}

// Generate code that represents the specified parser table
lrGeneratorMixin.generateTableCode = function (table) {
  let moduleCode = JSON.stringify(table)
  const variables = [createObjectCode]

  // Don't surround numerical property name numbers in quotes
  moduleCode = moduleCode.replace(/"([0-9]+)"(?=:)/g, '$1')

  // Replace objects with several identical values by function calls
  // e.g., { 1: [6, 7]; 3: [6, 7], 4: [6, 7], 5: 8 } = o([1, 3, 4], [6, 7], { 5: 8 })
  moduleCode = moduleCode.replace(/\{\d+:[^}]+,\d+:[^}]+\}/g, function (object) {
    // Find the value that occurs with the highest number of keys
    let value; let frequentValue; let key; const keys = {}; let keyCount; let maxKeyCount = 0
    let keyValue; let keyValues = []; const keyValueMatcher = /(\d+):([^:]+)(?=,\d+:|\})/g

    while ((keyValue = keyValueMatcher.exec(object))) {
      // For each value, store the keys where that value occurs
      key = keyValue[1]
      value = keyValue[2]
      keyCount = 1

      if (!(value in keys)) {
        keys[value] = [key]
      } else {
        keyCount = keys[value].push(key)
      }
      // Remember this value if it is the most frequent one
      if (keyCount > maxKeyCount) {
        maxKeyCount = keyCount
        frequentValue = value
      }
    }
    // Construct the object with a function call if the most frequent value occurs multiple times
    if (maxKeyCount > 1) {
      // Collect all non-frequent values into a remainder object
      for (value in keys) {
        if (value !== frequentValue) {
          for (let k = keys[value], i = 0, l = k.length; i < l; i++) {
            keyValues.push(k[i] + ':' + value)
          }
        }
      }
      keyValues = keyValues.length ? ',{' + keyValues.join(',') + '}' : ''
      // Create the function call `o(keys, value, remainder)`
      object = 'o([' + keys[frequentValue].join(',') + '],' + frequentValue + keyValues + ')'
    }
    return object
  })

  // Count occurrences of number lists
  let list
  const lists = {}
  const listMatcher = /\[[0-9,]+\]/g

  while (list = listMatcher.exec(moduleCode)) {
    lists[list] = (lists[list] || 0) + 1
  }

  // Replace frequently occurring number lists with variables
  moduleCode = moduleCode.replace(listMatcher, function (list) {
    let listId = lists[list]
    // If listId is a number, it represents the list's occurrence frequency
    if (typeof listId === 'number') {
      // If the list does not occur frequently, represent it by the list
      if (listId === 1) {
        lists[list] = listId = list
        // If the list occurs frequently, represent it by a newly assigned variable
      } else {
        lists[list] = listId = createVariable(nextVariableId, variableTokens, variableTokensLength)
        nextVariableId++
        variables.push(listId + '=' + list)
      }
    }
    return listId
  })

  // Return the variable initialization code and the table code
  return {
    commonCode: 'var ' + variables.join(',') + ';',
    moduleCode
  }
}
// Function that extends an object with the given value for all given keys
// e.g., o([1, 3, 4], [6, 7], { x: 1, y: 2 }) = { 1: [6, 7]; 3: [6, 7], 4: [6, 7], x: 1, y: 2 }
var createObjectCode = 'o=function(k,v,o,l){' +
  'for(o=o||{},l=k.length;l--;o[k[l]]=v);' +
  'return o}'

var nextVariableId = 0
var variableTokens = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$'
var variableTokensLength = variableTokens.length

var lrGeneratorDebug = {
  beforeparseTable: function () {
    this.trace('Building parse table.')
  },
  afterparseTable: function () {
    const self = this
    if (this.conflicts > 0) {
      this.resolutions.forEach(function (r, i) {
        if (r[2].bydefault) {
          self.warn('Conflict at state: ', r[0], ', token: ', r[1], '\n  ', printAction(r[2].r, self), '\n  ', printAction(r[2].s, self))
        }
      })
      this.trace('\n' + this.conflicts + ' Conflict(s) found in grammar.')
    }
    this.trace('Done.')
  },
  aftercanonicalCollection: function (states) {
    const trace = this.trace
    trace('\nItem sets\n------')

    states.forEach(function (state, i) {
      trace('\nitem set', i, '\n' + state.join('\n'), '\ntransitions -> ', JSON.stringify(state.edges))
    })
  }
}



module.exports = generator;
