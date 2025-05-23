const Jison = require('../setup').Jison
const Lexer = require('../setup').Lexer
const assert = require('assert')

exports['test xx nullable grammar'] = function () {
  const lexData = {
    rules: [
      ['x', "return 'x';"],
      ['y', "return 'y';"]
    ]
  }
  const grammar = {
    tokens: ['x'],
    startSymbol: 'A',
    bnf: {
      A: ['A x',
        '']
    }
  }

  const parser = new Jison.Parser(grammar, { type: 'lr' })
  parser.lexer = new Lexer(lexData)

  assert.ok(parser.parse('xxx'), 'parse')
  assert.ok(parser.parse('x'), 'parse single x')
  assert.throws(function () { parser.parse('+') }, 'throws parse error on invalid')
}

exports['test LR parse'] = function () {
  const lexData2 = {
    rules: [
      ['0', "return 'ZERO';"],
      ['\\+', "return 'PLUS';"]
    ]
  }
  const grammar = {
    tokens: ['ZERO', 'PLUS'],
    startSymbol: 'E',
    bnf: {
      E: ['E PLUS T',
        'T'],
      T: ['ZERO']
    }
  }
  const parser = new Jison.Parser(grammar, { type: 'lr' })
  parser.lexer = new Lexer(lexData2)

  assert.ok(parser.parse('0+0+0'), 'parse')
}

exports['test basic JSON grammar'] = function () {
  const grammar = {
    lex: {
      macros: {
        digit: '[0-9]'
      },
      rules: [
        ['\\s+', '/* skip whitespace */'],
        ['{digit}+(\\.{digit}+)?', "return 'NUMBER';"],
        ['"[^"]*', function () {
          if (yytext.charAt(yyleng - 1) == '\\') {
            // remove escape
            yytext = yytext.substr(0, yyleng - 2)
            this.more()
          } else {
            yytext = yytext.substr(1) // swallow start quote
            this.input() // swallow end quote
            return 'STRING'
          }
        }],
        ['\\{', "return '{'"],
        ['\\}', "return '}'"],
        ['\\[', "return '['"],
        ['\\]', "return ']'"],
        [',', "return ','"],
        [':', "return ':'"],
        ['true\\b', "return 'TRUE'"],
        ['false\\b', "return 'FALSE'"],
        ['null\\b', "return 'NULL'"]
      ]
    },

    tokens: 'STRING NUMBER { } [ ] , : TRUE FALSE NULL',
    bnf: {
      JsonThing: ['JsonObject',
        'JsonArray'],

      JsonObject: ['{ JsonPropertyList }'],

      JsonPropertyList: ['JsonProperty',
        'JsonPropertyList , JsonProperty'],

      JsonProperty: ['StringLiteral : JsonValue'],

      JsonArray: ['[ JsonValueList ]'],

      JsonValueList: ['JsonValue',
        'JsonValueList , JsonValue'],

      JsonValue: ['StringLiteral',
        'NumericalLiteral',
        'JsonObject',
        'JsonArray',
        'TRUE',
        'FALSE',
        'NULL'],

      StringLiteral: ['STRING'],

      NumericalLiteral: ['NUMBER']
    }
  }

  const source = '{"foo": "Bar", "hi": 42, "array": [1,2,3.004,4], "false": false, "true":true, "null": null, "obj": {"ha":"ho"}, "string": "string\\"sgfg" }'

  const parser = new Jison.Parser(grammar, { type: 'lr' })
  assert.ok(parser.parse(source))
}

exports['test compilers test grammar'] = function () {
  const lexData = {
    rules: [
      ['x', "return 'x';"]
    ]
  }
  const grammar = {
    tokens: ['x'],
    startSymbol: 'S',
    bnf: {
      S: ['A'],
      A: ['B A', ''],
      B: ['', 'x']
    }
  }

  const parser = new Jison.Parser(grammar, { type: 'lr' })
  parser.lexer = new Lexer(lexData)

  assert.ok(parser.parse('xxx'), 'parse')
}

exports['test compilers test grammar 2'] = function () {
  const grammar = '%% n : a b ; a : | a x ; b : | b x y ;'

  const parser = new Jison.Generator(grammar, { type: 'lr' })

  assert.equal(parser.conflicts, 1, 'only one conflict')
}

exports['test nullables'] = function () {
  const lexData = {
    rules: [
      ['x', "return 'x';"],
      ['y', "return 'y';"],
      ['z', "return 'z';"],
      [';', "return ';';"]
    ]
  }
  const grammar = {
    tokens: [';', 'x', 'y', 'z'],
    startSymbol: 'S',
    bnf: {
      S: ['A ;'],
      A: ['B C'],
      B: ['x'],
      C: ['y', 'D'],
      D: ['F'],
      F: ['', 'F z']
    }
  }

  const parser = new Jison.Parser(grammar, { type: 'lr' })
  parser.lexer = new Lexer(lexData)

  // assert.ok(parser.parse('x;'), 'parse')
}
