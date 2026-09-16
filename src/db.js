import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const { Pool } = pg;
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export async function initDb() {
  await pool.query(`CREATE TABLE IF NOT EXISTS api_logs (
    id BIGSERIAL PRIMARY KEY,
    app_name VARCHAR(120), app_version VARCHAR(50), build_number VARCHAR(50),
    platform VARCHAR(30), os_version VARCHAR(100), device_model VARCHAR(150),
    user_id VARCHAR(255), method VARCHAR(10) NOT NULL, url TEXT NOT NULL,
    endpoint TEXT, status_code INTEGER, duration_ms INTEGER,
    request_headers JSONB, request_body JSONB, response_headers JSONB,
    response_body JSONB, error_type VARCHAR(100), error_message TEXT,
    ip_address INET, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_api_logs_created_at ON api_logs(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_api_logs_status ON api_logs(status_code);
  CREATE INDEX IF NOT EXISTS idx_api_logs_endpoint ON api_logs(endpoint);`);
}
