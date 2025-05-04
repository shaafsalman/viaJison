/**
 * @fileoverview CLI interface for Jison Parser Generator
 * @path lib/core/cli.js
 * 
 * Refactorings applied:
 * - Extract Method: Created separate functions for CLI options, file processing, and grammar processing
 * - Replace Temp with Query: Eliminated unnecessary temporary variables
 * - Move Method: Organized methods into logical groups
 * - Replace Constructor with Factory Method: Improved parser generation approach
 * - Extract Class: Separated CLI concerns from grammar processing
 * - Simplifying Conditional Expressions: Improved readability of conditional logic
 * 
 * This module provides the command line interface for the Jison parser generator,
 * handling command line arguments, file processing, and parser generation.
 */


'use strict';

/**
 * Command line interface module for Jison parser generator
 * @module cli
 */
const cli = module.exports;

/**
 * Retrieves and processes command line options
 * @returns {Object} Parsed command line options
 */
function getCommandlineOptions() {
  const version = require('../../package.json').version;
  
  return require('nomnom')
    .script('jison')
    .option('file', {
      flag: true,
      position: 0,
      help: 'file containing a grammar'
    })
    .option('lexfile', {
      flag: true,
      position: 1,
      help: 'file containing a lexical grammar'
    })
    .option('json', {
      abbr: 'j',
      flag: true,
      help: 'force jison to expect a grammar in JSON format'
    })
    .option('outfile', {
      abbr: 'o',
      metavar: 'FILE',
      help: 'Filename and base module name of the generated parser'
    })
    .option('debug', {
      abbr: 't',
      flag: true,
      default: false,
      help: 'Debug mode'
    })
    .option('module-type', {
      abbr: 'm',
      default: 'commonjs',
      metavar: 'TYPE',
      help: 'The type of module to generate (commonjs, amd, js)'
    })
    .option('parser-type', {
      abbr: 'p',
      default: 'lalr',
      metavar: 'TYPE',
      help: 'The type of algorithm to use for the parser (lr0, slr, lalr, lr)'
    })
    .option('version', {
      abbr: 'V',
      flag: true,
      help: 'print version and exit',
      callback: function() {
        return version;
      }
    }).parse();
}

/**
 * Reads data from standard input
 * @param {Function} callback - Function to call with data once read
 */
function readFromStdin(callback) {
  const stdin = process.openStdin();
  let data = '';

  stdin.setEncoding('utf8');
  stdin.addListener('data', function(chunk) {
    data += chunk;
  });
  stdin.addListener('end', function() {
    callback(data);
  });
}

/**
 * Processes grammar from input sources
 * @param {string} rawGrammar - Raw grammar content
 * @param {string|null} lexGrammar - Lexical grammar content
 * @param {Object} options - Processing options
 * @returns {string} Generated parser
 */
function processGrammar(rawGrammar, lexGrammar, options) {
  const grammar = cli.processGrammars(rawGrammar, lexGrammar, options.json);
  return cli.generateParserString(options, grammar);
}

/**
 * Processes input from a file
 * @param {Object} options - Command line options
 */
function processInputFile(options) {
  const fs = require('fs');
  const path = require('path');

  const rawGrammar = fs.readFileSync(path.normalize(options.file), 'utf8');
  const lexGrammar = options.lexfile ? fs.readFileSync(path.normalize(options.lexfile), 'utf8') : null;

  options.json = path.extname(options.file) === '.json' || options.json;

  const baseName = path.basename(options.outfile || options.file).replace(/\..*$/g, '');
  options.outfile = options.outfile || (baseName + '.js');
  
  if (!options.moduleName && baseName) {
    // Convert kebab-case to camelCase for module name
    options.moduleName = baseName.replace(/-\w/g, match => match.charAt(1).toUpperCase());
  }

  const parser = processGrammar(rawGrammar, lexGrammar, options);
  fs.writeFileSync(options.outfile, parser);
}

/**
 * Processes input from standard input
 * @param {Object} options - Command line options
 */
function processStdin(options) {
  readFromStdin(rawGrammar => {
    console.log(processGrammar(rawGrammar, null, options));
  });
}

/**
 * Main CLI entry point
 * @param {Object} options - Command line options
 */
cli.main = function main(options) {
  options = options || {};

  if (options.file) {
    processInputFile(options);
  } else {
    processStdin(options);
  }
};

/**
 * Generates parser string from grammar
 * @param {Object} options - Generation options
 * @param {Object} grammar - Parsed grammar
 * @returns {string} Generated parser code
 */
cli.generateParserString = function generateParserString(options, grammar) {
  options = options || {};
  const jison = require('../jison.js');

  const settings = Object.assign({}, grammar.options || {});
  
  if (options['parser-type']) {
    settings.type = options['parser-type'];
  }
  
  if (options.moduleName) {
    settings.moduleName = options.moduleName;
  }
  
  settings.debug = options.debug;
  
  if (!settings.moduleType) {
    settings.moduleType = options['module-type'];
  }

  const generator = new jison.Generator(grammar, settings);
  return generator.generate(settings);
};

/**
 * Process grammar files into a unified grammar object
 * @param {string} grammarFile - Content of the grammar file
 * @param {string|boolean} lexFile - Content of the lexical grammar file or false
 * @param {boolean} jsonMode - Whether to parse as JSON
 * @returns {Object} Processed grammar
 * @throws {Error} If parsing fails
 */
cli.processGrammars = function processGrammars(grammarFile, lexFile, jsonMode) {
  lexFile = lexFile || false;
  jsonMode = jsonMode || false;
  
  const ebnfParser = require('ebnf-parser');
  const cjson = require('cjson');
  let grammar;
  
  try {
    grammar = jsonMode ? cjson.parse(grammarFile) : ebnfParser.parse(grammarFile);
  } catch (e) {
    throw new Error('Could not parse jison grammar');
  }
  
  try {
    if (lexFile) {
      grammar.lex = require('lex-parser').parse(lexFile);
    }
  } catch (e) {
    throw new Error('Could not parse lex grammar');
  }
  
  return grammar;
};

// Execute main function if this is the main module
if (require.main === module) {
  const options = getCommandlineOptions();
  cli.main(options);
}