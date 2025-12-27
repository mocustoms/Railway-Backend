const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const {
  startScheduledInvoiceGenerator,
  stopScheduledInvoiceGenerator,
  getScheduledInvoiceGeneratorStatus,
  checkAndGenerateScheduledInvoices
} = require('../services/scheduledInvoiceGenerator');
const {
  startBirthdayBonusScheduler,
  stopBirthdayBonusScheduler,
  getBirthdayBonusSchedulerStatus,
  checkAndAwardBirthdayBonuses
} = require('../services/birthdayBonusScheduler');

// Middleware to ensure only system admins can access
const requireSystemAdmin = (req, res, next) => {
  if (!req.user || !req.user.isSystemAdmin) {
    return res.status(403).json({
      error: 'Access denied',
      message: 'Only system administrators can access scheduler management'
    });
  }
  next();
};

// Apply authentication and system admin check to all routes
router.use(auth);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks
router.use(requireSystemAdmin);

/**
 * GET /api/schedulers/status
 * Get status of all schedulers
 */
router.get('/status', csrfProtection, (req, res) => {
  try {
    const invoiceSchedulerStatus = getScheduledInvoiceGeneratorStatus();
    const birthdaySchedulerStatus = getBirthdayBonusSchedulerStatus();

    res.json({
      success: true,
      schedulers: {
        scheduledInvoiceGenerator: {
          name: 'Scheduled Invoice Generator',
          description: 'Generates invoices from scheduled/recurring invoices',
          schedule: 'Every hour at minute 0',
          ...invoiceSchedulerStatus
        },
        birthdayBonusScheduler: {
          name: 'Birthday Bonus Scheduler',
          description: 'Awards birthday bonus points to customers',
          schedule: 'Daily at 1:00 AM UTC',
          ...birthdaySchedulerStatus
        }
      }
    });
  } catch (error) {
    console.error('Error getting scheduler status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get scheduler status',
      error: error.message
    });
  }
});

/**
 * POST /api/schedulers/invoice-generator/trigger
 * Manually trigger the scheduled invoice generator
 */
router.post('/invoice-generator/trigger', csrfProtection, async (req, res) => {
  try {
    await checkAndGenerateScheduledInvoices();
    res.json({
      success: true,
      message: 'Scheduled invoice generator executed successfully'
    });
  } catch (error) {
    console.error('Error triggering scheduled invoice generator:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to trigger scheduled invoice generator',
      error: error.message
    });
  }
});

/**
 * POST /api/schedulers/birthday-bonus/trigger
 * Manually trigger the birthday bonus scheduler
 */
router.post('/birthday-bonus/trigger', csrfProtection, async (req, res) => {
  try {
    await checkAndAwardBirthdayBonuses();
    res.json({
      success: true,
      message: 'Birthday bonus scheduler executed successfully'
    });
  } catch (error) {
    console.error('Error triggering birthday bonus scheduler:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to trigger birthday bonus scheduler',
      error: error.message
    });
  }
});

/**
 * POST /api/schedulers/invoice-generator/restart
 * Restart the scheduled invoice generator
 */
router.post('/invoice-generator/restart', csrfProtection, (req, res) => {
  try {
    startScheduledInvoiceGenerator();
    const status = getScheduledInvoiceGeneratorStatus();
    res.json({
      success: true,
      message: 'Scheduled invoice generator restarted successfully',
      status
    });
  } catch (error) {
    console.error('Error restarting scheduled invoice generator:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to restart scheduled invoice generator',
      error: error.message
    });
  }
});

/**
 * POST /api/schedulers/birthday-bonus/restart
 * Restart the birthday bonus scheduler
 */
router.post('/birthday-bonus/restart', csrfProtection, (req, res) => {
  try {
    startBirthdayBonusScheduler();
    const status = getBirthdayBonusSchedulerStatus();
    res.json({
      success: true,
      message: 'Birthday bonus scheduler restarted successfully',
      status
    });
  } catch (error) {
    console.error('Error restarting birthday bonus scheduler:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to restart birthday bonus scheduler',
      error: error.message
    });
  }
});

/**
 * POST /api/schedulers/invoice-generator/stop
 * Stop the scheduled invoice generator
 */
router.post('/invoice-generator/stop', csrfProtection, (req, res) => {
  try {
    const stopped = stopScheduledInvoiceGenerator();
    if (stopped) {
      res.json({
        success: true,
        message: 'Scheduled invoice generator stopped successfully'
      });
    } else {
      res.json({
        success: false,
        message: 'Scheduled invoice generator was not running'
      });
    }
  } catch (error) {
    console.error('Error stopping scheduled invoice generator:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to stop scheduled invoice generator',
      error: error.message
    });
  }
});

/**
 * POST /api/schedulers/birthday-bonus/stop
 * Stop the birthday bonus scheduler
 */
router.post('/birthday-bonus/stop', csrfProtection, (req, res) => {
  try {
    const stopped = stopBirthdayBonusScheduler();
    if (stopped) {
      res.json({
        success: true,
        message: 'Birthday bonus scheduler stopped successfully'
      });
    } else {
      res.json({
        success: false,
        message: 'Birthday bonus scheduler was not running'
      });
    }
  } catch (error) {
    console.error('Error stopping birthday bonus scheduler:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to stop birthday bonus scheduler',
      error: error.message
    });
  }
});

module.exports = router;

