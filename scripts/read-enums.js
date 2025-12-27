const sequelize = require('../config/database');
const { QueryTypes } = require('sequelize');

async function readEnums() {
    try {
        await sequelize.authenticate();
        
        // Get all ENUM types
        const enums = await sequelize.query(`
            SELECT 
                t.typname as enum_name,
                array_agg(e.enumlabel ORDER BY e.enumsortorder)::text[] as enum_values
            FROM pg_type t 
            JOIN pg_enum e ON t.oid = e.enumtypid  
            GROUP BY t.typname
            ORDER BY t.typname;
        `, { type: QueryTypes.SELECT });

        console.log('Found ENUM types:\n');
        const enumMap = {};
        
        for (const enumType of enums) {
            // Clean up the enum values - remove curly braces and parse properly
            let values = [];
            
            if (Array.isArray(enumType.enum_values)) {
                values = enumType.enum_values;
            } else if (typeof enumType.enum_values === 'string') {
                // Remove curly braces and split by comma
                const cleaned = enumType.enum_values.replace(/[{}]/g, '');
                values = cleaned.split(',').map(v => v.trim()).filter(v => v);
            } else {
                // Try to extract from object
                const raw = JSON.stringify(enumType.enum_values);
                const cleaned = raw.replace(/[{}"]/g, '');
                values = cleaned.split(',').map(v => v.trim()).filter(v => v);
            }
            
            // Clean up values - remove any remaining artifacts
            values = values.map(v => {
                // Remove quotes and clean
                v = v.replace(/^["']|["']$/g, '');
                // Remove any enum prefix artifacts
                v = v.replace(/^enum_.*_/, '');
                return v.trim();
            }).filter(v => v && !v.includes('{') && !v.includes('}'));
            
            console.log(`${enumType.enum_name}: [${values.join(', ')}]`);
            enumMap[enumType.enum_name] = values;
        }
        
        const fs = require('fs');
        const path = require('path');
        const outputPath = path.join(__dirname, '../database-enums.json');
        fs.writeFileSync(outputPath, JSON.stringify(enumMap, null, 2));
        console.log(`\n✅ ENUM types saved to: ${outputPath}`);
        
        await sequelize.close();
        return enumMap;
    } catch (error) {
        console.error('Error reading ENUMs:', error);
        throw error;
    }
}

if (require.main === module) {
    readEnums()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error('Error:', error.message);
            process.exit(1);
        });
}

module.exports = readEnums;
