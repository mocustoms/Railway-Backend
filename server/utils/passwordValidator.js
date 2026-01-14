// Password validation utility functions
// Adapted from the original EasyMauzo CODE

const validatePassword = (password) => {
    const errors = [];
    
    if (password.length < 8) {
        errors.push('Password must be at least 8 characters long');
    }
    if (password.length > 128) {
        errors.push('Password must not exceed 128 characters');
    }
    if (!/[A-Z]/.test(password)) {
        errors.push('Password must contain at least one uppercase letter');
    }
    if (!/[a-z]/.test(password)) {
        errors.push('Password must contain at least one lowercase letter');
    }
    if (!/[0-9]/.test(password)) {
        errors.push('Password must contain at least one number');
    }
    if (!/[^A-Za-z0-9]/.test(password)) {
        errors.push('Password must contain at least one special character');
    }
    if (/\s/.test(password)) {
        errors.push('Password cannot contain spaces');
    }
    
    // Check for common passwords
    const commonPasswords = ['Password123', 'password123', '12345678', 'qwerty123'];
    if (commonPasswords.includes(password)) {
        errors.push('Password is too common, please choose a stronger password');
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
};

const getPasswordStrength = (password) => {
    let score = 0;
    let feedback = [];
    
    if (password.length >= 8) score += 1;
    if (password.length >= 12) score += 1;
    if (password.length >= 16) score += 1;
    if (/[a-z]/.test(password)) score += 1;
    if (/[A-Z]/.test(password)) score += 1;
    if (/[0-9]/.test(password)) score += 1;
    if (/[^A-Za-z0-9]/.test(password)) score += 1;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
    if (/[0-9]/.test(password) && /[a-zA-Z]/.test(password)) score += 1;
    
    let strength = 'weak';
    if (score >= 6) strength = 'strong';
    else if (score >= 4) strength = 'medium';
    
    if (password.length < 8) feedback.push('Use at least 8 characters');
    if (!/[A-Z]/.test(password)) feedback.push('Add uppercase letters');
    if (!/[a-z]/.test(password)) feedback.push('Add lowercase letters');
    if (!/[0-9]/.test(password)) feedback.push('Add numbers');
    if (!/[^A-Za-z0-9]/.test(password)) feedback.push('Add special characters');
    
    return { score, strength, feedback: feedback.slice(0, 3) };
};

module.exports = {
    validatePassword,
    getPasswordStrength
}; 