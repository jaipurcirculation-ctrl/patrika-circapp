require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

module.exports = {
  DB: {
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME     || 'patrika_vitran',
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || '',
  },
  API_HOST:     process.env.API_HOST || '0.0.0.0',
  API_PORT:     parseInt(process.env.API_PORT || '8000', 10),
  CORS_ORIGINS: (process.env.CORS_ORIGINS || 'http://localhost:8123').split(','),
};
