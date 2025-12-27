const cron = require('node-cron');
const { Op } = require('sequelize');
const sequelize = require('../../config/database');
const {
  Customer,
  LoyaltyCardConfig,
  Company
} = require('../models');
const { awardBirthdayBonus } = require('../utils/loyaltyBonusHelper');

/**
 * Scheduled task to check for customer birthdays and award birthday bonus points
 * Runs daily at 9:00 AM
 */
async function checkAndAwardBirthdayBonuses() {
  const today = new Date();
  const todayMonth = today.getMonth(); // 0-11
  const todayDate = today.getDate(); // 1-31

  try {
    // Get all active companies
    const companies = await Company.findAll({
      where: { isActive: true }
    });

    let totalAwarded = 0;
    let totalErrors = 0;

    for (const company of companies) {
      const transaction = await sequelize.transaction();
      
      try {
        // Find all customers with birthdays today
        // Using Sequelize literal to match month and day regardless of year
        const customersWithBirthday = await Customer.findAll({
          where: {
            companyId: company.id,
            birthday: {
              [Op.not]: null
            },
            is_active: true,
            loyalty_card_config_id: {
              [Op.not]: null
            },
            [Op.and]: [
              sequelize.literal(`EXTRACT(MONTH FROM birthday) = ${todayMonth + 1}`),
              sequelize.literal(`EXTRACT(DAY FROM birthday) = ${todayDate}`)
            ]
          },
          transaction
        });

        for (const customer of customersWithBirthday) {
          try {
            if (!customer || !customer.loyalty_card_config_id) {
              continue;
            }

            // Get loyalty config
            const loyaltyConfig = await LoyaltyCardConfig.findByPk(
              customer.loyalty_card_config_id,
              { transaction }
            );

            if (!loyaltyConfig) {
              continue;
            }

            // Award birthday bonus
            const bonusTransaction = await awardBirthdayBonus(customer, loyaltyConfig, {
              transaction,
              user: { id: customer.created_by },
              companyId: company.id,
              birthdayDate: today
            });

            if (bonusTransaction) {
              totalAwarded++;
            }
          } catch (customerError) {
            totalErrors++;
            // Continue with next customer
          }
        }

        await transaction.commit();
      } catch (companyError) {
        await transaction.rollback();
        totalErrors++;
        // Continue with next company
      }
    }
  } catch (error) {
    // Fatal error in birthday bonus scheduler
  }
}

// Store task reference globally
let birthdayBonusTask = null;

/**
 * Initialize and start the birthday bonus scheduler
 * Runs daily at 1:00 AM
 */
function startBirthdayBonusScheduler() {
  // If task already exists, stop it first
  if (birthdayBonusTask) {
    birthdayBonusTask.stop();
    birthdayBonusTask = null;
  }

  // Schedule: Run daily at 1:00 AM
  // Cron format: minute hour day month dayOfWeek
  // '0 1 * * *' = At 1:00 AM every day
  const cronSchedule = '0 1 * * *';

  // Run immediately on startup (for testing/debugging)
  // Comment out in production if you only want it to run at scheduled time
  // Wrap in try-catch to prevent startup failure
  checkAndAwardBirthdayBonuses().catch(() => {
    // Error in initial birthday bonus check
  });

  // Schedule the task with error handling
  birthdayBonusTask = cron.schedule(cronSchedule, async () => {
    try {
      await checkAndAwardBirthdayBonuses();
    } catch (error) {
      // Don't stop the task - it will continue running
    }
  }, {
    scheduled: true,
    timezone: 'UTC' // Adjust timezone as needed
  });

  return birthdayBonusTask;
}

/**
 * Stop the birthday bonus scheduler
 */
function stopBirthdayBonusScheduler() {
  if (birthdayBonusTask) {
    birthdayBonusTask.stop();
    birthdayBonusTask = null;
    return true;
  }
  return false;
}

/**
 * Get the status of the birthday bonus scheduler
 */
function getBirthdayBonusSchedulerStatus() {
  return {
    isRunning: birthdayBonusTask !== null && birthdayBonusTask.getStatus() === 'scheduled',
    taskStatus: birthdayBonusTask ? birthdayBonusTask.getStatus() : 'not_started'
  };
}

module.exports = {
  startBirthdayBonusScheduler,
  stopBirthdayBonusScheduler,
  getBirthdayBonusSchedulerStatus,
  checkAndAwardBirthdayBonuses
};

