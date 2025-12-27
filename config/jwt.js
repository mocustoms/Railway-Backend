const jwt = require('jsonwebtoken');
const config = require('../env');

const generateToken = (payload) => {
    return jwt.sign(payload, config.JWT_SECRET, {
        expiresIn: config.JWT_EXPIRES_IN,
        algorithm: config.JWT_ALGORITHM
    });
};

const verifyToken = (token) => {
    try {
        return jwt.verify(token, config.JWT_SECRET, {
            algorithms: [config.JWT_ALGORITHM]
        });
    } catch (error) {
        throw new Error('Invalid token');
    }
};

module.exports = {
    generateToken,
    verifyToken
}; 