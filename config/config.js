require('dotenv').config();

module.exports = {
  development: {
    username: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || null,
    database: process.env.DB_NAME || 'smm_db',
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306'),
    dialect: process.env.DB_DIALECT || 'mysql',
    logging: console.log
  },
  test: {
    username: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || null,
    database: process.env.DB_NAME_TEST || 'smm_test_db',
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306'),
    dialect: process.env.DB_DIALECT || 'mysql',
    logging: false
  },
  production: {
    username: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306'),
    dialect: process.env.DB_DIALECT || 'mysql',
    use_env_variable: process.env.DATABASE_URL ? 'DATABASE_URL' : undefined,
    logging: false
  }
};
