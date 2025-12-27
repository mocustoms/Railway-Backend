const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const stripCompanyId = require('../middleware/stripCompanyId');
const { companyFilter, buildCompanyWhere } = require('../middleware/companyFilter');
const { csrfProtection } = require('../middleware/csrfProtection');
const { Product, ProductPharmaceuticalInfo, ProductDosage } = require('../models');

// Apply authentication and company filtering to all routes
router.use(auth);
router.use(companyFilter);
router.use(stripCompanyId); // CRITICAL: Prevent companyId override attacks

// Get pharmaceutical info for a product (including dosages)
router.get('/info/:productId', async (req, res) => {
    try {
        const { productId } = req.params;
        
        // Get pharmaceutical info (with company filter)
        const pharmaceuticalWhere = buildCompanyWhere(req, { product_id: productId });
        const pharmaceuticalInfo = await ProductPharmaceuticalInfo.findOne({
            where: pharmaceuticalWhere,
            include: [
                {
                    model: Product,
                    as: 'product',
                    attributes: ['id', 'name', 'code', 'product_type']
                }
            ]
        });
        
        // Get dosages for this product
        const baseWhere = buildCompanyWhere(req, { product_id: productId });
        const dosages = await ProductDosage.findAll({
            where: baseWhere,
            order: [['sort_order', 'ASC'], ['created_at', 'ASC']]
        });
        
        res.json({
            success: true,
            data: {
                ...pharmaceuticalInfo?.toJSON(),
                dosages: dosages
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch pharmaceutical info',
            error: error.message
        });
    }
});

// Create or update pharmaceutical info with dosages
router.post('/info', csrfProtection, async (req, res) => {
    try {
        const { 
            product_id, 
            adjustments,
            dosages = []
        } = req.body;
        const userId = req.user.id;
        
        // Validate product exists and is pharmaceutical type
        const product = await Product.findOne({
            where: buildCompanyWhere(req, { id: product_id })
        });
        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }
        
        if (product.product_type !== 'pharmaceuticals') {
            return res.status(400).json({
                success: false,
                message: 'Product must be of type "pharmaceuticals"'
            });
        }
        
        // Create or update pharmaceutical info
        let pharmaceuticalInfo;
        const pharmaceuticalWhere = buildCompanyWhere(req, { product_id });
        const [existingInfo, created] = await ProductPharmaceuticalInfo.findOrCreate({
            where: pharmaceuticalWhere,
            defaults: {
                product_id,
                adjustments,
                companyId: req.user.companyId, // Add companyId for multi-tenant isolation
                created_by: userId,
                updated_by: userId
            }
        });
        
        if (!created) {
            await existingInfo.update({
                adjustments,
                updated_by: userId
            });
        }
        pharmaceuticalInfo = existingInfo;
        
        // Handle dosages - save them to the database
        if (dosages && dosages.length > 0) {
            // Delete existing dosages for this product (with company filter)
            const dosageWhere = buildCompanyWhere(req, { product_id });
            await ProductDosage.destroy({
                where: dosageWhere
            });
            
            // Create new dosages
            const dosagePromises = dosages.map((dosage, index) => {
                return ProductDosage.create({
                    product_id,
                    name: dosage.name,
                    max_dose: dosage.max_dose,
                    frequency: dosage.frequency,
                    duration: dosage.duration,
                    indication: dosage.indication,
                    age_min: dosage.age_min,
                    age_max: dosage.age_max,
                    weight_min: dosage.weight_min,
                    weight_max: dosage.weight_max,
                    notes: dosage.notes,
                    sort_order: index,
                    companyId: req.user.companyId, // Add companyId for multi-tenant isolation
                    created_by: userId,
                    updated_by: userId
                });
            });
            
            await Promise.all(dosagePromises);
        }
        
        // Get updated dosages (with company filter)
        const dosageWhere = buildCompanyWhere(req, { product_id });
        const updatedDosages = await ProductDosage.findAll({
            where: dosageWhere,
            order: [['sort_order', 'ASC'], ['created_at', 'ASC']]
        });
        
        res.json({
            success: true,
            data: {
                ...pharmaceuticalInfo.toJSON(),
                dosages: updatedDosages.map(dosage => dosage.toJSON())
            },
            message: created ? 'Pharmaceutical info created successfully' : 'Pharmaceutical info updated successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to save pharmaceutical info',
            error: error.message
        });
    }
});

// Get dosage recommendations based on age and weight
router.post('/dosage-recommendations', csrfProtection, async (req, res) => {
    try {
        const { product_id, age, weight } = req.body;
        
        if (!product_id) {
            return res.status(400).json({
                success: false,
                message: 'Product ID is required'
            });
        }
        
        // Get all dosages for the product
        const baseWhere = buildCompanyWhere(req, { product_id });
        const dosages = await ProductDosage.findAll({
            where: baseWhere,
            order: [['sort_order', 'ASC'], ['created_at', 'ASC']]
        });
        
        // Filter dosages based on age and weight criteria
        const recommendations = dosages.filter(dosage => {
            let ageMatch = true;
            let weightMatch = true;
            
            // Check age range
            if (age !== undefined && age !== null) {
                const patientAge = parseFloat(age);
                if (dosage.age_min !== null && patientAge < parseFloat(dosage.age_min)) {
                    ageMatch = false;
                }
                if (dosage.age_max !== null && patientAge > parseFloat(dosage.age_max)) {
                    ageMatch = false;
                }
            }
            
            // Check weight range
            if (weight !== undefined && weight !== null) {
                const patientWeight = parseFloat(weight);
                if (dosage.weight_min !== null && patientWeight < parseFloat(dosage.weight_min)) {
                    weightMatch = false;
                }
                if (dosage.weight_max !== null && patientWeight > parseFloat(dosage.weight_max)) {
                    weightMatch = false;
                }
            }
            
            return ageMatch && weightMatch;
        });
        
        res.json({
            success: true,
            data: {
                recommendations: recommendations.map(dosage => dosage.toJSON()),
                total_dosages: dosages.length,
                matching_dosages: recommendations.length
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to get dosage recommendations',
            error: error.message
        });
    }
});

// Delete pharmaceutical info and dosages
router.delete('/info/:productId', csrfProtection, async (req, res) => {
    try {
        const { productId } = req.params;
        
        // Delete dosages first (due to foreign key constraints)
        const dosageWhere = buildCompanyWhere(req, { product_id: productId });
        await ProductDosage.destroy({
            where: dosageWhere
        });
        
        // Delete pharmaceutical info (with company filter)
        const pharmaceuticalWhere = buildCompanyWhere(req, { product_id: productId });
        await ProductPharmaceuticalInfo.destroy({
            where: pharmaceuticalWhere
        });
        
        res.json({
            success: true,
            message: 'Pharmaceutical info deleted successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to delete pharmaceutical info',
            error: error.message
        });
    }
});

// Get all dosages for a product
router.get('/dosages/:productId', async (req, res) => {
    try {
        const { productId } = req.params;
        const baseWhere = buildCompanyWhere(req, { product_id: productId });
        const dosages = await ProductDosage.findAll({
            where: baseWhere,
            order: [['sort_order', 'ASC'], ['created_at', 'ASC']]
        });
        res.json({ success: true, data: dosages });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch dosages', error: error.message });
    }
});

module.exports = router; 