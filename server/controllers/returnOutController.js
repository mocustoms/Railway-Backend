const ReturnOutService = require('../services/returnOutService');

const create = async (req, res, next) => {
  try {
    const data = req.body;
    data.companyId = req.user.companyId || req.body.companyId || req.user.companyId;
    const result = await ReturnOutService.createReturnOut(data, req.user);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

const getById = async (req, res, next) => {
  try {
    const id = req.params.id;
    const companyId = req.user.companyId;
    const result = await ReturnOutService.getById(id, companyId);
    if (!result) return res.status(404).json({ message: 'Not found' });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const list = async (req, res, next) => {
    console.log('request', req.user);
  try {
    const filters = { companyId: req.user.companyId };
    if (req.query.storeId) filters.storeId = req.query.storeId;
    if (req.query.vendorId) filters.vendorId = req.query.vendorId;
    if (req.query.status) filters.status = req.query.status;
    const results = await ReturnOutService.list(filters);
    res.json(results);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  create,
  getById,
  list
};
