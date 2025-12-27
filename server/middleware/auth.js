const { User } = require('../models');
const config = require('../../env');
const JWTService = require('../utils/jwtService');
const CookieService = require('../utils/cookieService');

const auth = async (req, res, next) => {
    try {
        // Get token from cookies (primary) or header (fallback)
        let token = CookieService.getAccessToken(req);
        
        if (!token) {
            // Fallback to header for backward compatibility
            const authHeader = req.header('Authorization');
            if (authHeader && authHeader.startsWith('Bearer ')) {
                token = authHeader.substring(7);
                }
        }
        
        if (!token) {
            return res.status(401).json({ message: 'No token, authorization denied' });
        }

        // Verify token using JWT service
        const decoded = JWTService.verifyAccessToken(token);
        
        // Find user by ID
        const user = await User.findByPk(decoded.userId);
        
        if (!user) {
            return res.status(401).json({ message: 'Token is not valid' });
        }

        // Add user info to request
        req.user = {
            id: user.id,
            userId: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
            companyId: user.companyId,
            isSystemAdmin: user.isSystemAdmin || false
        };

        next();
    } catch (error) {
        res.status(401).json({ message: 'Token is not valid' });
    }
};

module.exports = auth; 