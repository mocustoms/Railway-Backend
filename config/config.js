const config = require('../env');

module.exports = {
  development: {
    username: config.DB_USER,
    password: config.DB_PASSWORD,
    database: config.DB_NAME,
    host: config.DB_HOST,
    port: config.DB_PORT,
    dialect: 'postgres',
    logging: config.DB_LOGGING === 'true' ? console.log : false,
  },
  test: {
    username: config.DB_USER,
    password: config.DB_PASSWORD,
    database: config.DB_NAME + '_test',
    host: config.DB_HOST,
    port: config.DB_PORT,
    dialect: 'postgres',
    logging: false,
  },
  production: {
    username: config.DB_USER,
    password: config.DB_PASSWORD,
    database: config.DB_NAME,
    host: config.DB_HOST,
    port: config.DB_PORT,
    dialect: 'postgres',
    logging: false,
  }
};
