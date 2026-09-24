import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import { pool, initDb } from './db.js';

dotenv.config();

const app = express();

/**
 * ============================================================
 * CONFIGURATION
 * ============================================================
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);

const PUBLIC_PATH = path.join(
  __dirname,
  '../public'
);

/**
 * ============================================================
 * MIDDLEWARE
 * ============================================================
 */

const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN
      .split(',')
      .map((origin) => origin.trim())
  : true;

app.use(
  cors({
    origin: corsOrigin,
  })
);

app.use(
  express.json({
    limit: '1mb',
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: '1mb',
  })
);

app.use(
  express.static(PUBLIC_PATH)
);

/**
 * ============================================================
 * HELPERS
 * ============================================================
 */

/**
 * Convert undefined to null.
 */
const clean = (value) => {
  return value === undefined ? null : value;
};

/**
 * Check whether HTTP status is an error.
 *
 * 400 - 499 = Client Error
 * 500 - 599 = Server Error
 */
const isErrorStatus = (statusCode) => {
  return (
    Number.isInteger(statusCode) &&
    statusCode >= 400
  );
};

/**
 * Safely parse JSON value.
 *
 * PostgreSQL JSONB accepts:
 * - object
 * - array
 * - primitive JSON values
 *
 * If Flutter sends a string, keep it as a string.
 */
const normalizeJson = (value) => {
  if (value === undefined || value === null) return null;

  if (typeof value === 'string') {
    try {
      JSON.parse(value);      // string ini sudah JSON valid
      return value;
    } catch {
      return JSON.stringify(value); // bungkus jadi JSON string
    }
  }

  // object & array: selalu kirim sebagai teks JSON
  return JSON.stringify(value);
};

/**
 * ============================================================
 * AUTHENTICATION
 * ============================================================
 */

const auth = (req, res, next) => {
  const apiKey = req.get(
    'X-Mobile-Monitor-Key'
  );

  if (
    !apiKey ||
    apiKey !== process.env.MONITOR_API_KEY
  ) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized',
    });
  }

  next();
};

/**
 * ============================================================
 * HEALTH CHECK
 * ============================================================
 */

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');

    return res.json({
      success: true,
      message: 'API Monitor is running',
      database: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Health check failed:', error);

    return res.status(500).json({
      success: false,
      message: 'Database connection failed',
    });
  }
});

/**
 * ============================================================
 * POST API LOG
 * ============================================================
 *
 * Flutter:
 *
 * POST /api/v1/mobile-monitoring/logs
 *
 * Header:
 *
 * X-Mobile-Monitor-Key: YOUR_KEY
 *
 * Also supports:
 *
 * POST /api/v1/logs
 */

app.post(
  [
    '/api/v1/logs',
    '/api/v1/mobile-monitoring/logs',
  ],
  auth,
  async (req, res) => {
    try {
      const data = req.body;

      /**
       * Validate required fields
       */
      if (!data.method || !data.url) {
        return res.status(422).json({
          success: false,
          message:
            'method and url are required',
        });
      }

      /**
       * Normalize status code
       */
      let statusCode = null;

      if (
        data.status_code !== undefined &&
        data.status_code !== null &&
        data.status_code !== ''
      ) {
        const parsedStatusCode = Number(
          data.status_code
        );

        if (!Number.isNaN(parsedStatusCode)) {
          statusCode = parsedStatusCode;
        }
      }

      /**
       * Check error
       *
       * 400+
       */
      const isError = isErrorStatus(statusCode) || Boolean(data.error_type || data.error_message);

      /**
       * Automatically create error type
       *
       * Example:
       *
       * HTTP_500
       * HTTP_404
       * HTTP_401
       */
      const errorType =
        data.error_type ??
        (isError
          ? `HTTP_${statusCode}`
          : null);

      /**
       * Automatically create error message
       */
      const errorMessage =
        data.error_message ??
        (isError
          ? `API returned HTTP ${statusCode}`
          : null);

      /**
       * SQL
       */
      const query = `
        INSERT INTO api_logs (
          app_name,
          app_version,
          build_number,
          platform,
          os_version,
          device_model,
          user_id,
          method,
          url,
          endpoint,
          status_code,
          duration_ms,
          request_headers,
          request_body,
          response_headers,
          response_body,
          error_type,
          error_message,
          ip_address
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14,
          $15,
          $16,
          $17,
          $18,
          $19
        )
        RETURNING id, created_at
      `;

      /**
       * Values
       */
      const values = [
        clean(data.app_name),
        clean(data.app_version),
        clean(data.build_number),

        clean(data.platform),
        clean(data.os_version),
        clean(data.device_model),

        clean(data.user_id),

        data.method,
        data.url,

        clean(data.endpoint),

        statusCode,

        data.duration_ms !== undefined
          ? Number(data.duration_ms)
          : null,

        normalizeJson(
          data.request_headers
        ),

        normalizeJson(
          data.request_body
        ),

        normalizeJson(
          data.response_headers
        ),

        normalizeJson(
          data.response_body
        ),

        errorType,
        errorMessage,

        req.ip,
      ];

      /**
       * Insert
       */
      const result = await pool.query(
        query,
        values
      );

      return res.status(201).json({
        success: true,
        id: result.rows[0].id,
        created_at:
          result.rows[0].created_at,
        is_error: isError,
      });
    } catch (error) {
      console.error(
        'Failed to save API log:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Internal server error',
      });
    }
  }
);

/**
 * ============================================================
 * GET STATS
 * ============================================================
 *
 * GET /api/v1/stats
 */

app.get('/api/v1/stats', async (_req, res) => {
  try {
    const [
      totalResult,
      errorsResult,
      avgResult,
      topEndpointsResult,
      platformsResult,
    ] = await Promise.all([
      /**
       * Total requests
       */
      pool.query(`
        SELECT
          COUNT(*)::int AS total
        FROM api_logs
      `),

      /**
       * Total errors
       *
       * 400+
       */
      pool.query(`
        SELECT
          COUNT(*)::int AS total
        FROM api_logs
        WHERE status_code >= 400
      `),

      /**
       * Average response time
       */
      pool.query(`
        SELECT
          COALESCE(
            ROUND(AVG(duration_ms)),
            0
          )::int AS avg
        FROM api_logs
        WHERE duration_ms IS NOT NULL
      `),

      /**
       * Top endpoints
       */
      pool.query(`
        SELECT
          COALESCE(endpoint, '') AS endpoint,

          COUNT(*)::int AS total,

          COUNT(*) FILTER (
            WHERE status_code >= 400
          )::int AS errors,

          COALESCE(
            ROUND(AVG(duration_ms)),
            0
          )::int AS avg_ms

        FROM api_logs

        GROUP BY endpoint

        ORDER BY total DESC

        LIMIT 10
      `),

      /**
       * Platform statistics
       */
      pool.query(`
        SELECT
          COALESCE(
            platform,
            'unknown'
          ) AS platform,

          COUNT(*)::int AS total

        FROM api_logs

        GROUP BY platform

        ORDER BY total DESC
      `),
    ]);

    return res.json({
      total:
        totalResult.rows[0].total,

      errors:
        errorsResult.rows[0].total,

      avgMs:
        avgResult.rows[0].avg,

      topEndpoints:
        topEndpointsResult.rows,

      platforms:
        platformsResult.rows,
    });
  } catch (error) {
    console.error(
      'Failed to get stats:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Internal server error',
    });
  }
});

/**
 * ============================================================
 * GET LOGS
 * ============================================================
 *
 * GET /api/v1/logs
 *
 * Examples:
 *
 * /api/v1/logs
 * /api/v1/logs?limit=50
 * /api/v1/logs?status=500
 * /api/v1/logs?platform=android
 * /api/v1/logs?search=/login
 */

app.get('/api/v1/logs', async (req, res) => {
  try {
    /**
     * Pagination
     */
    const limit = Math.min(
      Math.max(
        Number(req.query.limit) || 50,
        1
      ),
      200
    );

    const offset = Math.max(
      Number(req.query.offset) || 0,
      0
    );

    /**
     * Query values
     */
    const values = [];

    /**
     * WHERE conditions
     */
    const conditions = [];

    /**
     * Helper for dynamic conditions
     */
    const addCondition = (
      sql,
      value
    ) => {
      values.push(value);

      const parameter =
        `$${values.length}`;

      conditions.push(
        sql.replace(
          '$X',
          parameter
        )
      );
    };

    /**
     * Status filter
     *
     * Example:
     *
     * ?status=500
     */
    if (req.query.status) {
      const status = Number(
        req.query.status
      );

      if (!Number.isNaN(status)) {
        addCondition(
          'status_code = $X',
          status
        );
      }
    }

    /**
     * Platform filter
     */
    if (req.query.platform) {
      addCondition(
        'platform = $X',
        req.query.platform
      );
    }

    /**
     * App version filter
     */
    if (req.query.app_version) {
      addCondition(
        'app_version = $X',
        req.query.app_version
      );
    }

    /**
     * Search endpoint / URL
     */
    if (req.query.search) {
      addCondition(
        `
        (
          endpoint ILIKE $X
          OR url ILIKE $X
        )
        `,
        `%${req.query.search}%`
      );
    }

    /**
     * WHERE SQL
     */
    const whereSql =
      conditions.length > 0
        ? `
          WHERE
          ${conditions.join(
            ' AND '
          )}
        `
        : '';

    /**
     * Main query
     *
     * IMPORTANT:
     * Response is an ARRAY directly.
     *
     * This matches the existing
     * dashboard frontend.
     */
    const query = `
      SELECT
        id,
        app_name,
        app_version,
        build_number,
        platform,
        os_version,
        device_model,
        user_id,
        method,
        url,
        endpoint,
        status_code,
        duration_ms,
        request_headers,
        request_body,
        response_headers,
        response_body,
        error_type,
        error_message,
        ip_address,
        created_at

      FROM api_logs

      ${whereSql}

      ORDER BY created_at DESC

      LIMIT ${limit}

      OFFSET ${offset}
    `;

    const result = await pool.query(
      query,
      values
    );

    /**
     * IMPORTANT:
     *
     * Do NOT return:
     *
     * {
     *   success: true,
     *   data: [...]
     * }
     *
     * because existing dashboard
     * expects an array.
     */
    return res.json(
      result.rows
    );
  } catch (error) {
    console.error(
      'Failed to get logs:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Internal server error',
    });
  }
});

/**
 * ============================================================
 * GET LOG DETAIL
 * ============================================================
 *
 * GET /api/v1/logs/:id
 */

app.get(
  '/api/v1/logs/:id',
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          SELECT
            *
          FROM api_logs
          WHERE id = $1
          `,
          [req.params.id]
        );

      if (!result.rowCount) {
        return res.status(404).json({
          success: false,
          message: 'Log not found',
        });
      }

      return res.json({
        success: true,
        data: result.rows[0],
      });
    } catch (error) {
      console.error(
        'Failed to get log detail:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Internal server error',
      });
    }
  }
);

/**
 * ============================================================
 * DELETE ALL LOGS
 * ============================================================
 *
 * DELETE /api/v1/logs
 */

app.delete(
  '/api/v1/logs',
  async (_req, res) => {
    try {
      const result =
        await pool.query(`
          DELETE FROM api_logs
        `);

      return res.json({
        success: true,
        deleted:
          result.rowCount,
      });
    } catch (error) {
      console.error(
        'Failed to delete logs:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Internal server error',
      });
    }
  }
);

/**
 * ============================================================
 * FRONTEND
 * ============================================================
 */

app.get(
  '/',
  (_req, res) => {
    res.sendFile(
      path.join(
        PUBLIC_PATH,
        'index.html'
      )
    );
  }
);

/**
 * ============================================================
 * FRONTEND FALLBACK
 * ============================================================
 */

app.use(
  (_req, res) => {
    res.sendFile(
      path.join(
        PUBLIC_PATH,
        'index.html'
      )
    );
  }
);

/**
 * ============================================================
 * ERROR HANDLER
 * ============================================================
 */

app.use(
  (
    error,
    _req,
    res,
    _next
  ) => {
    console.error(
      'Unhandled server error:',
      error
    );

    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
);

/**
 * ============================================================
 * START SERVER
 * ============================================================
 */

const startServer = async () => {
  try {
    await initDb();

    app.listen(
      PORT,
      () => {
        console.log('');
        console.log(
          '========================================'
        );
        console.log(
          '        API MONITOR STARTED'
        );
        console.log(
          '========================================'
        );
        console.log(
          `Dashboard : http://localhost:${PORT}`
        );
        console.log(
          `Logs      : http://localhost:${PORT}/api/v1/logs`
        );
        console.log(
          `Stats     : http://localhost:${PORT}/api/v1/stats`
        );
        console.log(
          `Health    : http://localhost:${PORT}/health`
        );
        console.log(
          '========================================'
        );
        console.log('');
      }
    );
  } catch (error) {
    console.error(
      'Failed to start API Monitor:',
      error
    );

    process.exit(1);
  }
};

startServer();