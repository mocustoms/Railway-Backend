const fs = require('fs');
const path = require('path');

// Generate build timestamp file
const buildTimestamp = {
  timestamp: new Date().toISOString(),
  buildDate: new Date().toLocaleString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
};

const buildTimestampPath = path.join(__dirname, '../build-timestamp.json');

try {
  fs.writeFileSync(buildTimestampPath, JSON.stringify(buildTimestamp, null, 2));
  console.log('Build timestamp generated successfully:', buildTimestamp.timestamp);
} catch (error) {
  console.error('Failed to generate build timestamp:', error);
  process.exit(1);
}

