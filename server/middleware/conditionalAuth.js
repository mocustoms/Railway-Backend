const auth = require('./auth');

// Standard authentication middleware
// Always uses real JWT authentication
const conditionalAuth = (req, res, next) => {
    return auth(req, res, next);
};

module.exports = conditionalAuth; 