/**
 * @fileoverview Common utility functions for the Jison parser generator
 * @path lib/util/utils.js
 * 
 * Refactorings applied:
 * - Extract Method: Separated functions into logical groups
 * - Move Method: Organized similar functions together
 * - Replace Temp with Query: Eliminated unnecessary temporary variables
 * - Decompose Conditional: Simplified complex conditional expressions
 */

'use strict';

const errorUtils = require('./error-utils');
const grammarUtils = require('./grammar-utils');
const parserUtils = require('./parser-utils');
const generalUtils = require('./general-utils');

module.exports = {
  // Error handling utilities
  removeErrorRecovery: errorUtils.removeErrorRecovery,
  parseError: errorUtils.parseError,
  
  // Grammar processing utilities
  processOperators: grammarUtils.processOperators,
  resolveConflict: grammarUtils.resolveConflict,
  
  // Parser utilities
  findDefaults: parserUtils.findDefaults,
  printAction: parserUtils.printAction,
  
  // General utilities
  createVariable: generalUtils.createVariable,
  commonjsMain: generalUtils.commonjsMain,
  each: generalUtils.each
};