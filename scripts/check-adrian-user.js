#!/usr/bin/env node
/**
 * Check user adrian.salamanda and store assignments in local database.
 * Run from repo root: node Railway_Backend/scripts/check-adrian-user.js
 * Or from Railway_Backend: node scripts/check-adrian-user.js
 */
const path = require('path');

// Load env from backend directory
const envPath = path.resolve(__dirname, '..', '.env');
require('dotenv').config({ path: envPath });

const sequelize = require('../config/database');
const bcrypt = require('bcryptjs');
const { User, Store, UserStore, PhysicalInventory } = require('../server/models');

const USERNAME = 'adrian.salamanda';
const PASSWORD = 'Admin@123';

async function run() {
  console.log('--- Checking local database for adrian.salamanda ---\n');

  try {
    await sequelize.authenticate();
    console.log('Database connected.\n');
  } catch (err) {
    console.error('Database connection failed:', err.message);
    process.exit(1);
  }

  try {
    // 1. Find user
    const user = await User.findOne({
      where: { username: USERNAME },
      attributes: ['id', 'username', 'email', 'first_name', 'last_name', 'role', 'companyId', 'is_active', 'isSystemAdmin'],
    });

    if (!user) {
      console.log('User not found:', USERNAME);
      process.exit(1);
    }

    console.log('User found:');
    console.log('  id:', user.id);
    console.log('  username:', user.username);
    console.log('  role:', user.role);
    console.log('  companyId:', user.companyId);
    console.log('  is_active:', user.is_active);
    console.log('  isSystemAdmin:', user.isSystemAdmin);
    console.log('');

    // 2. Verify password (need raw password from DB for compare)
    const userWithPassword = await User.findOne({
      where: { username: USERNAME },
      attributes: ['id', 'password'],
    });
    const passwordMatch = userWithPassword && await bcrypt.compare(PASSWORD, userWithPassword.password);
    console.log('Password check (Admin@123):', passwordMatch ? 'OK' : 'FAILED');
    console.log('');

    // 3. Assigned stores (same query as auth login)
    const userWithStores = await User.findByPk(user.id, {
      include: [
        {
          model: Store,
          as: 'assignedStores',
          through: { attributes: ['role', 'is_active', 'assigned_at'], where: { is_active: true } },
          attributes: ['id', 'name', 'store_type', 'location', 'is_active'],
          required: false,
        },
      ],
    });

    const assignedStores = userWithStores?.assignedStores || [];
    console.log('Assigned stores (is_active: true):', assignedStores.length);
    assignedStores.forEach((s, i) => {
      console.log('  ', i + 1, 'id:', s.id, '| name:', s.name, '| type:', s.store_type);
    });
    console.log('');

    // 4. Physical inventories for this company
    const companyId = user.companyId;
    const inventories = await PhysicalInventory.findAll({
      where: companyId ? { companyId } : {},
      attributes: ['id', 'reference_number', 'store_id', 'status', 'inventory_date', 'companyId'],
      order: [['created_at', 'DESC']],
      limit: 20,
    });

    console.log('Physical inventories (company)', companyId || 'any', '):', inventories.length);
    inventories.forEach((inv, i) => {
      const inAssigned = assignedStores.some(s => String(s.id) === String(inv.store_id));
      console.log('  ', i + 1, 'ref:', inv.reference_number, '| store_id:', inv.store_id, '| status:', inv.status, '| in assigned stores:', inAssigned);
    });
    console.log('');

    // 5. All stores for this company (to compare IDs)
    const companyStores = await Store.findAll({
      where: companyId ? { companyId } : {},
      attributes: ['id', 'name'],
    });
    console.log('Stores in company:', companyStores.length);
    companyStores.forEach((s, i) => {
      const assigned = assignedStores.some(a => String(a.id) === String(s.id));
      console.log('  ', i + 1, 'id:', s.id, '| name:', s.name, '| assigned to adrian:', assigned);
    });

    console.log('\n--- Done ---');
  } catch (err) {
    console.error('Error:', err.message);
    if (process.env.NODE_ENV === 'development') console.error(err.stack);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

run();
