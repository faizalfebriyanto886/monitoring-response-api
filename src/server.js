import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import { logsCollection, initDb } from './db.js';

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
const clean = (value) => value === undefined ? null : value;

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

const serializeLog = (snapshot) => {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    ...data,
    created_at: data.created_at?.toDate
      ? data.created_at.toDate().toISOString()
      : data.created_at ?? null,
  };
};

const asDate = (value) => {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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
    await logsCollection.limit(1).get();

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

      const createdAt = new Date();
      const log = {
        app_name: clean(data.app_name),
        app_version: clean(data.app_version),
        build_number: clean(data.build_number),
        platform: clean(data.platform),
        os_version: clean(data.os_version),
        device_model: clean(data.device_model),
        user_id: clean(data.user_id),
        method: data.method,
        url: data.url,
        endpoint: clean(data.endpoint),
        status_code: statusCode,
        duration_ms: data.duration_ms !== undefined && Number.isFinite(Number(data.duration_ms))
          ? Number(data.duration_ms)
          : null,
        request_headers: clean(data.request_headers),
        request_body: clean(data.request_body),
        response_headers: clean(data.response_headers),
        response_body: clean(data.response_body),
        error_type: errorType,
        error_message: errorMessage,
        ip_address: req.ip,
        created_at: createdAt,
      };
      const result = await logsCollection.add(log);

      return res.status(201).json({
        success: true,
        id: result.id,
        created_at: createdAt.toISOString(),
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
    // Keep dashboard stats bounded. A full collection scan here was repeated
    // on every dashboard refresh and grew in cost with the log history.
    const [countSnapshot, snapshot] = await Promise.all([
      logsCollection.count().get(),
      logsCollection.orderBy('created_at', 'desc').limit(100).get(),
    ]);
    const logs = snapshot.docs.map((doc) => doc.data());
    const endpointMap = new Map();
    const platformMap = new Map();
    let errors = 0;
    let durationTotal = 0;
    let durationCount = 0;

    for (const log of logs) {
      if (Number(log.status_code) >= 400) errors += 1;
      if (log.duration_ms !== null && log.duration_ms !== undefined && Number.isFinite(Number(log.duration_ms))) {
        durationTotal += Number(log.duration_ms);
        durationCount += 1;
      }
      const endpoint = log.endpoint || '';
      const endpointStats = endpointMap.get(endpoint) || { endpoint, total: 0, errors: 0, durationTotal: 0, durationCount: 0 };
      endpointStats.total += 1;
      if (Number(log.status_code) >= 400) endpointStats.errors += 1;
      if (log.duration_ms !== null && log.duration_ms !== undefined && Number.isFinite(Number(log.duration_ms))) {
        endpointStats.durationTotal += Number(log.duration_ms);
        endpointStats.durationCount += 1;
      }
      endpointMap.set(endpoint, endpointStats);
      const platform = log.platform || 'unknown';
      platformMap.set(platform, (platformMap.get(platform) || 0) + 1);
    }

    const topEndpoints = [...endpointMap.values()]
      .map(({ durationTotal: total, durationCount: count, ...item }) => ({
        ...item,
        avg_ms: count ? Math.round(total / count) : 0,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
    const platforms = [...platformMap.entries()]
      .map(([platform, total]) => ({ platform, total }))
      .sort((a, b) => b.total - a.total);

    return res.json({
      total: countSnapshot.data().count,
      errors,
      avgMs: durationCount ? Math.round(durationTotal / durationCount) : 0,
      topEndpoints,
      platforms,
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

    // Search is applied in memory, so cap its candidate set to recent records
    // rather than downloading the entire history on every request.
    const candidateLimit = Math.min(Math.max(offset + limit, 100), 500);
    const snapshot = await logsCollection.orderBy('created_at', 'desc').limit(candidateLimit).get();
    let logs = snapshot.docs.map(serializeLog);
    if (req.query.status) {
      const status = Number(req.query.status);
      if (Number.isFinite(status)) logs = logs.filter((log) => Number(log.status_code) === status);
    }
    if (req.query.platform) logs = logs.filter((log) => log.platform === req.query.platform);
    if (req.query.app_version) logs = logs.filter((log) => log.app_version === req.query.app_version);
    if (req.query.search) {
      const search = String(req.query.search).toLowerCase();
      logs = logs.filter((log) => `${log.endpoint || ''} ${log.url || ''}`.toLowerCase().includes(search));
    }
    logs = logs.slice(offset, offset + limit);

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
      logs
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
      const result = await logsCollection.doc(req.params.id).get();

      if (!result.exists) {
        return res.status(404).json({
          success: false,
          message: 'Log not found',
        });
      }

      return res.json({
        success: true,
        data: serializeLog(result),
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
      let deleted = 0;
      while (true) {
        const snapshot = await logsCollection.limit(450).get();
        if (snapshot.empty) break;
        const batch = logsCollection.firestore.batch();
        snapshot.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
        deleted += snapshot.size;
      }

      return res.json({
        success: true,
        deleted,
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
