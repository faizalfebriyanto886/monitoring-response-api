import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'api_monitoring',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

/**
 * Initialize database
 */
export const initDb = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS api_logs (
        id BIGSERIAL PRIMARY KEY,

        app_name VARCHAR(255),
        app_version VARCHAR(100),
        build_number VARCHAR(100),

        platform VARCHAR(50),
        os_version VARCHAR(100),
        device_model VARCHAR(255),

        user_id VARCHAR(255),

        method VARCHAR(20) NOT NULL,
        url TEXT NOT NULL,
        endpoint TEXT,

        status_code INTEGER,
        duration_ms INTEGER,

        request_headers JSONB,
        request_body JSONB,

        response_headers JSONB,
        response_body JSONB,

        error_type VARCHAR(255),
        error_message TEXT,

        ip_address INET,

        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    /**
     * Indexes
     */

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_api_logs_created_at
      ON api_logs(created_at DESC);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_api_logs_status_code
      ON api_logs(status_code);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_api_logs_platform
      ON api_logs(platform);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_api_logs_app_version
      ON api_logs(app_version);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_api_logs_endpoint
      ON api_logs(endpoint);
    `);

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
};