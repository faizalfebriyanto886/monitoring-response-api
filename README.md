# Flutter API Monitor — Node.js + Express + PostgreSQL

## Requirements
- Node.js 20+
- PostgreSQL 14+

## Run
1. Create database: `createdb api_monitoring`
2. Copy `.env.example` to `.env` and change `MONITOR_API_KEY`.
3. `npm install`
4. `npm run dev`
5. Open `http://localhost:3000`

The server auto-creates the `api_logs` table on startup.

## Production notes
- Put the server behind HTTPS/reverse proxy.
- Do not use a permanent secret embedded in a mobile app as a strong authentication mechanism. Treat the mobile key as an ingestion credential, rotate it, rate-limit the endpoint, and consider per-installation signed tokens.
- Keep PII/secrets out of logs. The Flutter interceptor redacts common credentials.
- Add authentication to dashboard endpoints before exposing it publicly.
- Use a queue (Redis/BullMQ) if ingestion volume becomes high.
