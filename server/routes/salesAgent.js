const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { SalesAgent, User } = require('../models');
const { Op } = require('sequelize');
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { csrfProtection } = require('../middleware/csrfProtection');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const ExportService = require('../utils/exportService');
const { getUploadDir } = require('../utils/uploadsPath');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Configure multer for photo uploads (uses UPLOAD_PATH for Railway Volume / partition)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = getUploadDir('salesAgentPhotos');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'sales-agent-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// GET /api/sales-agents - List all sales agents with pagination, search, and filtering
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, search, status, sortBy = 'created_at', sortOrder = 'desc' } = req.query;
    const offset = (page - 1) * limit;

    // Build where clause
    const whereClause = {};
    
    // Handle search
    if (search) {
      whereClause[Op.or] = [
        { agent_number: { [Op.iLike]: `%${search}%` } },
        { full_name: { [Op.iLike]: `%${search}%` } }
      ];
    }
    
    // Handle status filter
    if (status && status !== 'all') {
      whereClause.status = status;
    }

    // Handle sorting
    const allowedSortFields = ['agent_number', 'full_name', 'status', 'created_at', 'updated_at'];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'created_at';
    const sortDirection = sortOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const { count, rows: salesAgents } = await SalesAgent.findAndCountAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        { 
          model: User, 
          as: 'createdByUser', 
          attributes: ['id', 'first_name', 'last_name'],
          required: false
        },
        { 
          model: User, 
          as: 'updatedByUser', 
          attributes: ['id', 'first_name', 'last_name'],
          required: false
        }
      ],
      order: [[sortField, sortDirection]],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    // Transform data to match frontend expectations
    const transformedAgents = salesAgents.map(agent => ({
      id: agent.id,
      agentNumber: agent.agent_number,
      fullName: agent.full_name,
      photo: agent.photo,
      status: agent.status,
      created_by: agent.created_by,
      updated_by: agent.updated_by,
      created_at: agent.created_at,
      updated_at: agent.updated_at,
      created_by_name: agent.createdByUser ? `${agent.createdByUser.first_name} ${agent.createdByUser.last_name}` : null,
      updated_by_name: agent.updatedByUser ? `${agent.updatedByUser.first_name} ${agent.updatedByUser.last_name}` : null
    }));

    res.json({
      success: true,
      data: transformedAgents,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit),
        hasNextPage: parseInt(page) < Math.ceil(count / limit),
        hasPrevPage: parseInt(page) > 1
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch sales agents' });
  }
});

// GET /api/sales-agents/stats - Get sales agent statistics
router.get('/stats', async (req, res) => {
  try {
    const totalAgents = await SalesAgent.count({
      where: buildCompanyWhere(req)
    });
    const activeAgents = await SalesAgent.count({ 
      where: buildCompanyWhere(req, { status: 'active' })
    });
    const inactiveAgents = await SalesAgent.count({ 
      where: buildCompanyWhere(req, { status: 'inactive' })
    });
    
    // Get last update time
    const lastAgent = await SalesAgent.findOne({
      where: buildCompanyWhere(req),
      order: [['updated_at', 'DESC']],
      attributes: ['updated_at']
    });
    
    const lastUpdate = lastAgent ? lastAgent.updated_at : null;

    res.json({
      success: true,
      data: {
        totalAgents,
        activeAgents,
        inactiveAgents,
        lastUpdate: lastUpdate ? lastUpdate.toISOString() : 'Never'
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch sales agent statistics' });
  }
});

// GET /api/sales-agents/:id - Get single sales agent
router.get('/:id', async (req, res) => {
  try {
    const salesAgent = await SalesAgent.findOne({
      where: buildCompanyWhere(req, { id: req.params.id }),
      include: [
        { 
          model: User, 
          as: 'createdByUser', 
          attributes: ['id', 'first_name', 'last_name']
        },
        { 
          model: User, 
          as: 'updatedByUser', 
          attributes: ['id', 'first_name', 'last_name']
        }
      ]
    });

    if (!salesAgent) {
      return res.status(404).json({ success: false, error: 'Sales agent not found' });
    }

    const transformedAgent = {
      id: salesAgent.id,
      agentNumber: salesAgent.agent_number,
      fullName: salesAgent.full_name,
      photo: salesAgent.photo,
      status: salesAgent.status,
      created_by: salesAgent.created_by,
      updated_by: salesAgent.updated_by,
      created_at: salesAgent.created_at,
      updated_at: salesAgent.updated_at,
      created_by_name: salesAgent.createdByUser ? `${salesAgent.createdByUser.first_name} ${salesAgent.createdByUser.last_name}` : null,
      updated_by_name: salesAgent.updatedByUser ? `${salesAgent.updatedByUser.first_name} ${salesAgent.updatedByUser.last_name}` : null
    };

    res.json({
      success: true,
      data: transformedAgent
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch sales agent' });
  }
});

// POST /api/sales-agents - Create new sales agent
router.post('/', upload.single('photo'), csrfProtection, async (req, res) => {
  try {
    const { agentNumber, fullName, status = 'active' } = req.body;

    // Validate required fields
    if (!agentNumber || !fullName) {
      return res.status(400).json({ 
        success: false, 
        error: 'Agent number and full name are required' 
      });
    }

    // Check if agent number already exists in this company
    // Always check within company, even for super-admins
    if (!req.user.companyId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Company ID is required to create a sales agent' 
      });
    }

    const existingAgent = await SalesAgent.findOne({ 
      where: {
        agent_number: agentNumber,
        companyId: req.user.companyId
      }
    });
    
    if (existingAgent) {
      return res.status(400).json({ 
        success: false, 
        error: 'Agent number already exists in your company' 
      });
    }

    // Handle photo upload
    let photoPath = null;
    if (req.file) {
      photoPath = req.file.filename;
    }

    const salesAgent = await SalesAgent.create({
      agent_number: agentNumber,
      full_name: fullName,
      companyId: req.user.companyId,
      photo: photoPath,
      status: status,
      created_by: req.user.id,
      updated_by: req.user.id
    });

    // Fetch the created agent with user details
    const createdAgent = await SalesAgent.findOne({
      where: buildCompanyWhere(req, { id: salesAgent.id }),
      include: [
        { 
          model: User, 
          as: 'createdByUser', 
          attributes: ['id', 'first_name', 'last_name']
        },
        { 
          model: User, 
          as: 'updatedByUser', 
          attributes: ['id', 'first_name', 'last_name']
        }
      ]
    });

    const transformedAgent = {
      id: createdAgent.id,
      agentNumber: createdAgent.agent_number,
      fullName: createdAgent.full_name,
      photo: createdAgent.photo,
      status: createdAgent.status,
      created_by: createdAgent.created_by,
      updated_by: createdAgent.updated_by,
      created_at: createdAgent.created_at,
      updated_at: createdAgent.updated_at,
      created_by_name: createdAgent.createdByUser ? `${createdAgent.createdByUser.first_name} ${createdAgent.createdByUser.last_name}` : null,
      updated_by_name: createdAgent.updatedByUser ? `${createdAgent.updatedByUser.first_name} ${createdAgent.updatedByUser.last_name}` : null
    };

    res.status(201).json({
      success: true,
      data: transformedAgent,
      message: 'Sales agent created successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create sales agent' });
  }
});

// PUT /api/sales-agents/:id - Update sales agent
router.put('/:id', upload.single('photo'), csrfProtection, async (req, res) => {
  try {
    const { agentNumber, fullName, status } = req.body;
    const salesAgent = await SalesAgent.findOne({
      where: buildCompanyWhere(req, { id: req.params.id })
    });

    if (!salesAgent) {
      return res.status(404).json({ success: false, error: 'Sales agent not found' });
    }

    // Check if agent number already exists in this company (excluding current agent)
    // Always check within company, even for super-admins
    if (agentNumber && agentNumber !== salesAgent.agent_number) {
      if (!req.user.companyId) {
        return res.status(400).json({ 
          success: false, 
          error: 'Company ID is required to update a sales agent' 
        });
      }

      // Use the salesAgent.id from the database query to ensure correct comparison
      const currentAgentId = salesAgent.id;

      const existingAgent = await SalesAgent.findOne({ 
        where: {
          agent_number: agentNumber,
          companyId: req.user.companyId,
          id: { [Op.ne]: currentAgentId }
        }
      });
      
      if (existingAgent) {
        return res.status(400).json({ 
          success: false, 
          error: 'Agent number already exists in your company' 
        });
      }
    }

    // Handle photo upload
    let photoPath = salesAgent.photo; // Keep existing photo if no new one uploaded
    if (req.file) {
      // Delete old photo if exists
      if (salesAgent.photo) {
        const oldPhotoPath = path.join('uploads/sales-agent-photos/', salesAgent.photo);
        if (fs.existsSync(oldPhotoPath)) {
          fs.unlinkSync(oldPhotoPath);
        }
      }
      photoPath = req.file.filename;
    }

    // Update agent
    await salesAgent.update({
      agent_number: agentNumber || salesAgent.agent_number,
      full_name: fullName || salesAgent.full_name,
      photo: photoPath,
      status: status || salesAgent.status,
      updated_by: req.user.id
    });

    // Fetch updated agent with user details
    const updatedAgent = await SalesAgent.findOne({
      where: buildCompanyWhere(req, { id: salesAgent.id }),
      include: [
        { 
          model: User, 
          as: 'createdByUser', 
          attributes: ['id', 'first_name', 'last_name']
        },
        { 
          model: User, 
          as: 'updatedByUser', 
          attributes: ['id', 'first_name', 'last_name']
        }
      ]
    });

    const transformedAgent = {
      id: updatedAgent.id,
      agentNumber: updatedAgent.agent_number,
      fullName: updatedAgent.full_name,
      photo: updatedAgent.photo,
      status: updatedAgent.status,
      created_by: updatedAgent.created_by,
      updated_by: updatedAgent.updated_by,
      created_at: updatedAgent.created_at,
      updated_at: updatedAgent.updated_at,
      created_by_name: updatedAgent.createdByUser ? `${updatedAgent.createdByUser.first_name} ${updatedAgent.createdByUser.last_name}` : null,
      updated_by_name: updatedAgent.updatedByUser ? `${updatedAgent.updatedByUser.first_name} ${updatedAgent.updatedByUser.last_name}` : null
    };

    res.json({
      success: true,
      data: transformedAgent,
      message: 'Sales agent updated successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to update sales agent' });
  }
});

// DELETE /api/sales-agents/:id - Delete sales agent
router.delete('/:id', csrfProtection, async (req, res) => {
  try {
    const salesAgent = await SalesAgent.findOne({
      where: buildCompanyWhere(req, { id: req.params.id })
    });

    if (!salesAgent) {
      return res.status(404).json({ success: false, error: 'Sales agent not found' });
    }

    // Delete photo file if exists
    if (salesAgent.photo) {
      const photoPath = path.join('uploads/sales-agent-photos/', salesAgent.photo);
      if (fs.existsSync(photoPath)) {
        fs.unlinkSync(photoPath);
      }
    }

    await salesAgent.destroy();

    res.json({
      success: true,
      message: 'Sales agent deleted successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete sales agent' });
  }
});

// PATCH /api/sales-agents/:id/deactivate - Deactivate sales agent
router.patch('/:id/deactivate', async (req, res) => {
  try {
    const salesAgent = await SalesAgent.findOne({
      where: buildCompanyWhere(req, { id: req.params.id })
    });

    if (!salesAgent) {
      return res.status(404).json({ success: false, error: 'Sales agent not found' });
    }

    await salesAgent.update({
      status: 'inactive',
      updated_by: req.user.id
    });

    res.json({
      success: true,
      message: 'Sales agent deactivated successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to deactivate sales agent' });
  }
});

// GET /api/sales-agents/:id/usage - Check sales agent usage
router.get('/:id/usage', async (req, res) => {
  try {
    const salesAgent = await SalesAgent.findOne({
      where: buildCompanyWhere(req, { id: req.params.id })
    });

    if (!salesAgent) {
      return res.status(404).json({ success: false, error: 'Sales agent not found' });
    }

    // TODO: Implement usage checking logic
    // For now, return that the agent is not used
    // In a real implementation, you would check if the agent is referenced in:
    // - Sales transactions
    // - Customer records
    // - Commission records
    // - etc.

    res.json({
      success: true,
      data: {
        isUsed: false,
        usageCount: 0,
        message: 'Sales agent is not currently used in any transactions'
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to check sales agent usage' });
  }
});

// GET /api/sales-agents/export/excel - Export sales agents to Excel
router.get('/export/excel', async (req, res) => {
  try {
    const { search, status } = req.query;

    // Build where clause
    const whereClause = {};
    
    if (search) {
      whereClause[Op.or] = [
        { agent_number: { [Op.iLike]: `%${search}%` } },
        { full_name: { [Op.iLike]: `%${search}%` } }
      ];
    }
    
    if (status && status !== 'all') {
      whereClause.status = status;
    }

    const salesAgents = await SalesAgent.findAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        { 
          model: User, 
          as: 'createdByUser', 
          attributes: ['first_name', 'last_name']
        }
      ],
      order: [['created_at', 'DESC']]
    });

    // Transform data for export
    const exportData = salesAgents.map(agent => ({
      'Agent Number': agent.agent_number,
      'Full Name': agent.full_name,
      'Status': agent.status,
      'Created By': agent.createdByUser ? `${agent.createdByUser.first_name} ${agent.createdByUser.last_name}` : '',
      'Created Date': agent.created_at.toLocaleDateString(),
      'Updated Date': agent.updated_at.toLocaleDateString()
    }));

    const fileName = `sales-agents-${new Date().toISOString().split('T')[0]}.csv`;
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    
    // Simple CSV generation
    const csvHeader = Object.keys(exportData[0] || {}).join(',');
    const csvRows = exportData.map(row => Object.values(row).map(val => `"${val}"`).join(','));
    const csvContent = [csvHeader, ...csvRows].join('\n');
    
    res.send(csvContent);
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to export sales agents' });
  }
});

// GET /api/sales-agents/export/pdf - Export sales agents to PDF
router.get('/export/pdf', async (req, res) => {
  try {
    const { search, status } = req.query;

    // Build where clause
    const whereClause = {};
    
    if (search) {
      whereClause[Op.or] = [
        { agent_number: { [Op.iLike]: `%${search}%` } },
        { full_name: { [Op.iLike]: `%${search}%` } }
      ];
    }
    
    if (status && status !== 'all') {
      whereClause.status = status;
    }

    const salesAgents = await SalesAgent.findAll({
      where: buildCompanyWhere(req, whereClause),
      include: [
        { 
          model: User, 
          as: 'createdByUser', 
          attributes: ['first_name', 'last_name']
        }
      ],
      order: [['created_at', 'DESC']]
    });

    // Generate PDF using ExportService
    const fileName = `sales-agents-${new Date().toISOString().split('T')[0]}.pdf`;
    const pdfBuffer = await ExportService.generateSalesAgentsPDF(salesAgents);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(pdfBuffer);
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to export sales agents to PDF' });
  }
});

module.exports = router;
