/**
 * Helper script to register a product via API
 * Usage: node scripts/register-product-helper.js
 * 
 * This script helps register "Amx 500" pharmaceutical product
 * with retail and wholesale price categories
 */

const axios = require('axios');
const readline = require('readline');

// Configuration - Update these based on your setup
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
const CSRF_TOKEN_ENDPOINT = `${API_BASE_URL}/csrf-token`;

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Helper function to get CSRF token
async function getCSRFToken() {
  try {
    const response = await axios.get(CSRF_TOKEN_ENDPOINT, {
      withCredentials: true
    });
    return response.data.csrfToken;
  } catch (error) {
    console.error('Error getting CSRF token:', error.message);
    return null;
  }
}

// Helper function to get price categories
async function getPriceCategories(authToken, csrfToken) {
  try {
    const response = await axios.get(`${API_BASE_URL}/products/reference/pricecategories`, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'X-CSRF-Token': csrfToken
      },
      withCredentials: true
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching price categories:', error.message);
    return [];
  }
}

// Helper function to get reference data
async function getReferenceData(authToken, csrfToken) {
  try {
    const [categories, units, stores] = await Promise.all([
      axios.get(`${API_BASE_URL}/products/reference/categories`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'X-CSRF-Token': csrfToken
        },
        withCredentials: true
      }),
      axios.get(`${API_BASE_URL}/packaging`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'X-CSRF-Token': csrfToken
        },
        withCredentials: true
      }),
      axios.get(`${API_BASE_URL}/products/reference/stores`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'X-CSRF-Token': csrfToken
        },
        withCredentials: true
      })
    ]);

    return {
      categories: categories.data,
      units: units.data,
      stores: stores.data
    };
  } catch (error) {
    console.error('Error fetching reference data:', error.message);
    return { categories: [], units: [], stores: [] };
  }
}

// Helper function to register product
async function registerProduct(productData, authToken, csrfToken) {
  try {
    // Use form-data package for Node.js
    const FormData = require('form-data');
    const formData = new FormData();
    
    // Add all product fields to FormData
    Object.keys(productData).forEach(key => {
      if (key === 'price_category_ids' || key === 'store_ids') {
        // Arrays need to be stringified
        formData.append(key, JSON.stringify(productData[key]));
      } else if (productData[key] !== null && productData[key] !== undefined) {
        formData.append(key, productData[key]);
      }
    });

    const response = await axios.post(`${API_BASE_URL}/products`, formData, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'X-CSRF-Token': csrfToken,
        ...formData.getHeaders()
      },
      withCredentials: true
    });

    return response.data;
  } catch (error) {
    if (error.response) {
      console.error('Error response:', error.response.data);
      throw new Error(error.response.data.error || error.message);
    }
    throw error;
  }
}

// Main function
async function main() {
  console.log('\n=== Product Registration Helper ===\n');
  console.log('This script will help you register "Amx 500" pharmaceutical product');
  console.log('with retail and wholesale price categories.\n');

  // Get authentication token
  rl.question('Enter your authentication token (JWT): ', async (authToken) => {
    if (!authToken) {
      console.error('Authentication token is required');
      rl.close();
      return;
    }

    try {
      // Get CSRF token
      console.log('\nGetting CSRF token...');
      const csrfToken = await getCSRFToken();
      if (!csrfToken) {
        console.error('Failed to get CSRF token');
        rl.close();
        return;
      }
      console.log('✓ CSRF token obtained');

      // Get price categories
      console.log('\nFetching price categories...');
      const priceCategories = await getPriceCategories(authToken, csrfToken);
      console.log(`✓ Found ${priceCategories.length} price categories:`);
      priceCategories.forEach(pc => {
        console.log(`  - ${pc.name} (${pc.code}) - ID: ${pc.id}`);
      });

      // Find retail and wholesale
      const retail = priceCategories.find(pc => 
        pc.name.toLowerCase().includes('retail') || 
        pc.code.toLowerCase().includes('retail')
      );
      const wholesale = priceCategories.find(pc => 
        pc.name.toLowerCase().includes('wholesale') || 
        pc.code.toLowerCase().includes('wholesale')
      );

      if (!retail) {
        console.warn('\n⚠ Warning: Retail price category not found');
        console.log('Available categories:', priceCategories.map(pc => pc.name).join(', '));
      }
      if (!wholesale) {
        console.warn('\n⚠ Warning: Wholesale price category not found');
        console.log('Available categories:', priceCategories.map(pc => pc.name).join(', '));
      }

      if (!retail || !wholesale) {
        console.log('\nPlease create the missing price categories first or use existing ones.');
        rl.question('\nContinue anyway? (y/n): ', async (answer) => {
          if (answer.toLowerCase() !== 'y') {
            rl.close();
            return;
          }
          await continueRegistration(authToken, csrfToken, priceCategories, retail, wholesale);
        });
      } else {
        await continueRegistration(authToken, csrfToken, priceCategories, retail, wholesale);
      }
    } catch (error) {
      console.error('Error:', error.message);
      rl.close();
    }
  });
}

async function continueRegistration(authToken, csrfToken, priceCategories, retail, wholesale) {
  try {
    // Get reference data
    console.log('\nFetching reference data (categories, units, stores)...');
    const refData = await getReferenceData(authToken, csrfToken);
    console.log(`✓ Found ${refData.categories.length} categories, ${refData.units.length} units, ${refData.stores.length} stores`);

    // Build product data
    const priceCategoryIds = [];
    if (retail) priceCategoryIds.push(retail.id);
    if (wholesale) priceCategoryIds.push(wholesale.id);

    // Ask for required fields
    rl.question('\nEnter selling price (or press Enter to skip): ', (sellingPrice) => {
      rl.question('Enter average cost (or press Enter to skip): ', (averageCost) => {
        rl.question('Select a category ID (or press Enter to skip): ', (categoryId) => {
          rl.question('Select a unit ID (or press Enter to skip): ', (unitId) => {
            rl.question('Enter description (or press Enter to skip): ', async (description) => {
              const productData = {
                name: 'Amx 500',
                product_type: 'pharmaceuticals',
                selling_price: sellingPrice ? parseFloat(sellingPrice) : undefined,
                average_cost: averageCost ? parseFloat(averageCost) : undefined,
                category_id: categoryId || null,
                unit_id: unitId || null,
                description: description || '',
                price_category_ids: priceCategoryIds,
                store_ids: [], // Empty array - you can add stores later
                is_active: true,
                price_tax_inclusive: false,
                track_serial_number: false
              };

              console.log('\nProduct data to be registered:');
              console.log(JSON.stringify(productData, null, 2));

              rl.question('\nProceed with registration? (y/n): ', async (answer) => {
                if (answer.toLowerCase() === 'y') {
                  try {
                    console.log('\nRegistering product...');
                    const result = await registerProduct(productData, authToken, csrfToken);
                    console.log('\n✓ Product registered successfully!');
                    console.log('Product ID:', result.id);
                    console.log('Product Code:', result.code);
                    console.log('Product Name:', result.name);
                    if (result.priceCategories && result.priceCategories.length > 0) {
                      console.log('\nPrice Categories:');
                      result.priceCategories.forEach(pc => {
                        console.log(`  - ${pc.name}: ${pc.calculated_price}`);
                      });
                    }
                  } catch (error) {
                    console.error('\n✗ Registration failed:', error.message);
                    if (error.response && error.response.data) {
                      console.error('Details:', JSON.stringify(error.response.data, null, 2));
                    }
                  }
                } else {
                  console.log('Registration cancelled.');
                }
                rl.close();
              });
            });
          });
        });
      });
    });
  } catch (error) {
    console.error('Error:', error.message);
    rl.close();
  }
}

// Run the script
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { main, registerProduct, getPriceCategories };

