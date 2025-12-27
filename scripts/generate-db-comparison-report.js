#!/usr/bin/env node

/**
 * Generate a focused database comparison report
 * Highlights critical issues vs style differences
 */

const fs = require('fs');
const path = require('path');

// Read the comprehensive comparison output
const outputFile = path.join(__dirname, 'db-comparison-output.txt');

// Critical issues to flag
const criticalPatterns = [
  /constraint.*only in Railway/i,
  /constraint.*only in local/i,
  /Column.*differs.*NOT NULL/i,
  /UNIQUE.*only in Railway/i,
  /UNIQUE.*only in local/i,
  /FOREIGN KEY.*only in Railway/i,
  /FOREIGN KEY.*only in local/i,
];

// Style differences (less critical)
const stylePatterns = [
  /Index.*idx_/i,
  /Index.*_idx/i,
  /created_at.*differs/i,
  /updated_at.*differs/i,
  /timestamp.*differs/i,
];

console.log('Generating focused report...');
console.log('Critical issues will be highlighted separately from style differences.');

