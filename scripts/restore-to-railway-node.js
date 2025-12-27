#!/usr/bin/env node

/**
 * Restore Database Backup to Railway (Node.js Version - No psql required)
 * 
 * Restores a SQL backup file to Railway PostgreSQL database using Sequelize
 * Usage: node scripts/restore-to-railway-node.js [backup-file] [railway-db-url]
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Sequelize } = require('sequelize');

// Parse DATABASE_URL
function parseDatabaseUrl(databaseUrl) {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  
  try {
    let normalizedUrl = databaseUrl.trim();
    if (!normalizedUrl.startsWith('postgres://') && !normalizedUrl.startsWith('postgresql://')) {
      throw new Error('DATABASE_URL must start with postgres:// or postgresql://');
    }
    
    normalizedUrl = normalizedUrl.replace(/^postgresql:\/\//, 'postgres://');
    const url = new URL(normalizedUrl);
    
    const databaseName = url.pathname ? url.pathname.slice(1) : '';
    if (!databaseName) {
      throw new Error('Database name not found in DATABASE_URL');
    }
    
    return {
      host: url.hostname,
      port: parseInt(url.port) || 5432,
      database: databaseName,
      username: url.username || 'postgres',
      password: url.password || ''
    };
  } catch (error) {
    throw new Error(`Failed to parse DATABASE_URL: ${error.message}`);
  }
}

// Main async function
async function main() {
  // Get backup file
  const backupFile = process.argv[2];
  if (!backupFile) {
    console.error('❌ Error: Backup file is required');
    console.error('');
    console.error('Usage: node scripts/restore-to-railway-node.js <backup-file> [railway-database-url]');
    console.error('');
    console.error('Example:');
    console.error('  node scripts/restore-to-railway-node.js backups/local-backup-2025-01-25.sql');
    console.error('  node scripts/restore-to-railway-node.js backups/local-backup-2025-01-25.sql "postgresql://user:pass@host:port/db"');
    process.exit(1);
  }

  if (!fs.existsSync(backupFile)) {
    console.error(`❌ Error: Backup file not found: ${backupFile}`);
    process.exit(1);
  }

  // Get Railway database URL
  let railwayDbUrl = process.argv[3] || process.env.RAILWAY_DATABASE_URL || process.env.DATABASE_URL;

  if (!railwayDbUrl) {
    console.log('');
    console.log('⚠️  Railway DATABASE_URL not provided');
    console.log('');
    console.log('You can provide it in one of these ways:');
    console.log('  1. As command argument: node scripts/restore-to-railway-node.js <backup-file> <database-url>');
    console.log('  2. As environment variable: RAILWAY_DATABASE_URL=... node scripts/restore-to-railway-node.js <backup-file>');
    console.log('  3. Get it from Railway dashboard:');
    console.log('     - Go to your Railway project');
    console.log('     - Click on PostgreSQL service');
    console.log('     - Go to "Variables" tab');
    console.log('     - Copy the DATABASE_URL value');
    console.log('');
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    railwayDbUrl = await new Promise((resolve) => {
      rl.question('Enter Railway DATABASE_URL (or press Ctrl+C to cancel): ', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
    
    if (!railwayDbUrl) {
      console.error('❌ DATABASE_URL is required');
      process.exit(1);
    }
  }

  // Parse Railway database config
  let railwayConfig;
  try {
    railwayConfig = parseDatabaseUrl(railwayDbUrl);
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }

  console.log('');
  console.log('🔄 RESTORING DATABASE TO RAILWAY');
  console.log('='.repeat(80));
  console.log(`Backup File: ${backupFile}`);
  console.log(`Railway Host: ${railwayConfig.host}:${railwayConfig.port}`);
  console.log(`Railway Database: ${railwayConfig.database}`);
  console.log(`Railway User: ${railwayConfig.username}`);
  console.log('');

  // Confirm before proceeding
  const rl2 = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const answer = await new Promise((resolve) => {
    rl2.question('⚠️  WARNING: This will overwrite data in Railway database. Continue? (yes/no): ', (ans) => {
      rl2.close();
      resolve(ans.trim().toLowerCase());
    });
  });

  if (answer !== 'yes' && answer !== 'y') {
    console.log('❌ Restore cancelled');
    process.exit(0);
  }

  // Create Sequelize connection to Railway
  const railwaySequelize = new Sequelize(railwayConfig.database, railwayConfig.username, railwayConfig.password, {
    host: railwayConfig.host,
    port: railwayConfig.port,
    dialect: 'postgres',
    logging: false,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false // Railway uses self-signed certificates
      }
    }
  });

    try {
      // Test connection
      console.log('');
      console.log('🔄 Connecting to Railway database...');
      await railwaySequelize.authenticate();
      console.log('✅ Connected successfully');
      console.log('');

      // Read backup file
      console.log('📖 Reading backup file...');
      const backupContent = fs.readFileSync(backupFile, 'utf8');
      console.log(`   File size: ${(backupContent.length / (1024 * 1024)).toFixed(2)} MB`);
      console.log('');

      // Ask if user wants to clear existing data
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const clearData = await new Promise((resolve) => {
        rl.question('⚠️  Clear existing data before restore? (yes/no, default: no): ', (answer) => {
          rl.close();
          resolve(answer.toLowerCase().trim() === 'yes');
        });
      });
      
      if (clearData) {
        console.log('\n🗑️  Clearing existing data...');
        // Get all table names
        const [tables] = await railwaySequelize.query(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != 'SequelizeMeta' ORDER BY tablename`,
          { type: railwaySequelize.QueryTypes.SELECT }
        );
        
        // Disable foreign key constraints
        await railwaySequelize.query('SET session_replication_role = replica;', { type: railwaySequelize.QueryTypes.RAW });
        
        // Truncate all tables
        for (const table of tables) {
          try {
            await railwaySequelize.query(`TRUNCATE TABLE "${table.tablename}" CASCADE;`, { type: railwaySequelize.QueryTypes.RAW });
            console.log(`   ✅ Cleared ${table.tablename}`);
          } catch (error) {
            console.log(`   ⚠️  Could not clear ${table.tablename}: ${error.message.substring(0, 100)}`);
          }
        }
        
        // Re-enable foreign key constraints
        await railwaySequelize.query('SET session_replication_role = DEFAULT;', { type: railwaySequelize.QueryTypes.RAW });
        console.log('✅ Data cleared\n');
      }
      
      // Disable foreign key constraints temporarily for restore
      console.log('🔓 Disabling foreign key constraints...');
      await railwaySequelize.query('SET session_replication_role = replica;', { type: railwaySequelize.QueryTypes.RAW });
      console.log('✅ Foreign key constraints disabled');
      console.log('');

      // Split SQL statements (basic splitting by semicolon + newline)
      // This is a simplified parser - for production, use a proper SQL parser
      console.log('🔄 Executing SQL statements...');
      console.log('   (This may take several minutes for large databases)');
      console.log('');

      // Remove comment lines but keep the SQL structure
      let cleanedContent = backupContent
        .split('\n')
        .filter(line => {
          const trimmed = line.trim();
          // Keep lines that are not standalone comments
          return !(trimmed.startsWith('--') && trimmed.length > 2 && !trimmed.includes('INSERT') && !trimmed.includes('CREATE') && !trimmed.includes('DROP'));
        })
        .join('\n');
      
      // Remove BEGIN and COMMIT
      cleanedContent = cleanedContent.replace(/^\s*BEGIN\s*;?\s*$/gmi, '');
      cleanedContent = cleanedContent.replace(/^\s*COMMIT\s*;?\s*$/gmi, '');
      
      // Better SQL statement parsing that handles multi-line INSERT statements
      // Strategy: Find semicolons that are not inside string literals
      const statements = [];
      let currentStatement = '';
      let inString = false;
      let stringChar = null;
      let parenDepth = 0;
      
      for (let i = 0; i < cleanedContent.length; i++) {
        const char = cleanedContent[i];
        const nextChar = cleanedContent[i + 1];
        
        // Track string literals (both single and double quotes)
        if ((char === "'" || char === '"') && !inString) {
          inString = true;
          stringChar = char;
          currentStatement += char;
        } else if (char === stringChar && inString) {
          // Check for escaped quotes
          if (nextChar === stringChar) {
            currentStatement += char + nextChar;
            i++; // Skip next char
          } else {
            inString = false;
            stringChar = null;
            currentStatement += char;
          }
        } else {
          currentStatement += char;
          
          // Track parentheses for better statement detection
          if (!inString) {
            if (char === '(') parenDepth++;
            if (char === ')') parenDepth--;
            
            // Statement ends at semicolon when not in string and parentheses are balanced
            if (char === ';' && parenDepth === 0 && !inString) {
              const trimmed = currentStatement.trim();
              if (trimmed.length > 0) {
                // Filter out comment-only statements
                const nonCommentLines = trimmed.split('\n').filter(line => {
                  const lineTrimmed = line.trim();
                  return lineTrimmed.length > 0 && !lineTrimmed.startsWith('--');
                });
                if (nonCommentLines.length > 0) {
                  statements.push(trimmed);
                }
              }
              currentStatement = '';
            }
          }
        }
      }
      
      // Add any remaining statement (shouldn't happen in well-formed SQL, but handle it)
      if (currentStatement.trim().length > 0) {
        const trimmed = currentStatement.trim();
        const nonCommentLines = trimmed.split('\n').filter(line => {
          const lineTrimmed = line.trim();
          return lineTrimmed.length > 0 && !lineTrimmed.startsWith('--');
        });
        if (nonCommentLines.length > 0) {
          statements.push(trimmed);
        }
      }

      let executed = 0;
      let failed = 0;
      const total = statements.length;
      
      console.log(`   Found ${total} SQL statements to execute`);
      console.log('');

      // Execute each statement individually (not in a single transaction)
      // This way, if one fails, others can still succeed
      for (let i = 0; i < statements.length; i++) {
        const statement = statements[i];
        if (statement.trim().length === 0 || statement.startsWith('--')) {
          continue;
        }

        try {
          // Execute each statement in its own transaction
          await railwaySequelize.query(statement + ';', { 
            raw: true,
            type: railwaySequelize.QueryTypes.RAW 
          });
          executed++;
          
          if (executed % 10 === 0 || executed === total - failed) {
            process.stdout.write(`\r   Progress: ${executed}/${total} statements executed (${failed} failed)...`);
          }
        } catch (error) {
          failed++;
          // Some errors are expected and can be ignored
          const ignorableErrors = [
            'already exists',
            'does not exist',
            'relation',
            'duplicate',
            'duplicate key',
            'unique constraint',
            'violates foreign key constraint',
            'validation error',
            'violates not-null constraint',
            'invalid input syntax'
          ];
          
          const isIgnorable = ignorableErrors.some(msg => error.message.toLowerCase().includes(msg));
          
          // Log errors to debug
          if (failed <= 10) {
            console.error(`\n⚠️  Error on statement ${i + 1}: ${error.message.substring(0, 300)}`);
            console.error(`   Statement preview: ${statement.substring(0, 150)}...`);
            if (error.original) {
              console.error(`   Original error: ${error.original.message?.substring(0, 200) || 'N/A'}`);
            }
          } else if (failed === 11) {
            console.error(`\n⚠️  (Suppressing further error details - ${failed} errors so far)`);
          }
          
          // Don't stop on ignorable errors - continue processing
        }
      }
      
      // Re-enable foreign key constraints
      console.log('');
      console.log('🔒 Re-enabling foreign key constraints...');
      await railwaySequelize.query('SET session_replication_role = DEFAULT;', { type: railwaySequelize.QueryTypes.RAW });
      console.log('✅ Foreign key constraints re-enabled');
      console.log('');
      
      console.log('');
      console.log('✅ RESTORE COMPLETE!');
      console.log('='.repeat(80));
      console.log(`   Executed ${executed} statements successfully`);
      if (failed > 0) {
        console.log(`   ⚠️  ${failed} statements failed (may be expected)`);
      }
      console.log('   Your local database has been restored to Railway.');
      console.log('');
      console.log('💡 Next steps:');
      console.log('   1. Verify the data in Railway dashboard');
      console.log('   2. Run migrations if needed: npm run migrate');
      console.log('   3. Verify schema: npm run verify-schema');
      console.log('');
      
  } catch (error) {
    // Re-enable foreign key constraints even on error
    try {
      await railwaySequelize.query('SET session_replication_role = DEFAULT;', { type: railwaySequelize.QueryTypes.RAW });
    } catch (e) {
      // Ignore error if we can't re-enable
    }
    
    console.error('');
    console.error('❌ RESTORE FAILED!');
    console.error('='.repeat(80));
    console.error('Error:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack.substring(0, 500));
    }
    console.error('');
    console.error('💡 Troubleshooting:');
    console.error('   1. Check Railway DATABASE_URL is correct');
    console.error('   2. Ensure Railway database is accessible');
    console.error('   3. Check if backup file is valid SQL');
    console.error('   4. Verify Railway database is running');
    console.error('');
    process.exit(1);
  } finally {
    await railwaySequelize.close();
  }
}

// Run main function
main().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

