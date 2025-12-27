const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

// Get package.json version
const getPackageVersion = () => {
  try {
    const packagePath = path.join(__dirname, '../../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    return packageJson.version || '1.0.0';
  } catch (error) {
    return '1.0.0';
  }
};

// Get build timestamp (from build-time file or current time)
const getBuildTimestamp = () => {
  try {
    // Try to read build timestamp file (created during build)
    const buildTimestampPath = path.join(__dirname, '../../build-timestamp.json');
    if (fs.existsSync(buildTimestampPath)) {
      const buildInfo = JSON.parse(fs.readFileSync(buildTimestampPath, 'utf8'));
      return buildInfo.timestamp || new Date().toISOString();
    }
  } catch (error) {
    // If file doesn't exist, use package.json modification time or current time
  }
  
  // Fallback: use package.json modification time
  try {
    const packagePath = path.join(__dirname, '../../package.json');
    const stats = fs.statSync(packagePath);
    return stats.mtime.toISOString();
  } catch (error) {
    return new Date().toISOString();
  }
};

// GET /api/app-version - Get current app version and build timestamp
router.get('/', (req, res) => {
  try {
    const version = getPackageVersion();
    const buildTimestamp = getBuildTimestamp();
    
    res.json({
      success: true,
      data: {
        version,
        buildTimestamp,
        // Create a unique identifier for this build
        buildId: `${version}-${buildTimestamp}`
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get app version',
      error: error.message
    });
  }
});

module.exports = router;

