# Helify Paralysis MVP Backend

Node + Express + SQLite backend for post-stroke hemiparesis home rehab.

## What is implemented
- OTP auth with production provider support (`SMS_PROVIDER=twilio`) and mock fallback.
- JWT access + refresh token flow with server-side refresh token rotation.
- Refresh token revocation on logout.
- Role-based authorization (`patient`, `caregiver`, `physio`).
- Rate limiting (global + auth endpoints).
- Request audit logs stored in `audit_logs`.
- Core clinical flows: onboarding, check-in gate, guided session logging, summary/progress.
- Physio workflows: alert queue, resolve alert, notes, and care plan edits.

## API endpoints
1. `POST /auth/send-otp`
2. `POST /auth/verify-otp`
3. `POST /auth/refresh`
4. `POST /auth/logout`
5. `GET /me/profile`
6. `POST /patients/onboarding`
7. `POST /sessions/start`
8. `POST /sessions/:id/checkin`
9. `POST /sessions/:id/exercise-result`
10. `POST /sessions/:id/finish`
11. `GET /patients/:id/progress?days=7`
12. `GET /physio/alerts?status=open`
13. `POST /physio/alerts/:id/resolve`
14. `POST /physio/patients/:id/plan`
15. `GET /physio/patients`
16. `GET /physio/patients/:id`
17. `POST /physio/patients/:id/notes`

## Security hardening in this MVP
- Security headers on all responses.
- CORS allowlist via `CORS_ORIGIN`.
- Query/body parameter pollution guard.
- Access token verification on protected routes.
- Refresh token hashing in DB (`sha256`) and rotation per refresh.
- OTP max attempt enforcement (`OTP_MAX_ATTEMPTS`).
- Full API request audit trail (`audit_logs`) with method/path/status/ip/user-agent metadata.
- Production guard to prevent default JWT secret in production.

## Auth response contract
`POST /auth/verify-otp` and `POST /auth/refresh` return:
- `access_token`
- `refresh_token`
- `token_type` (`Bearer`)
- `expires_in`

Use header on protected APIs:
`Authorization: Bearer <access_token>`

## Environment variables
Copy `.env.example` to `.env` and set:
- `NODE_ENV`, `PORT`, `DB_PATH`, `CORS_ORIGIN`
- `JWT_SECRET`, `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_DAYS`
- `SMS_PROVIDER` (`mock` or `twilio`)
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` (required if `SMS_PROVIDER=twilio`)
- `OTP_TTL_MINUTES`, `OTP_MAX_ATTEMPTS`
- `RATE_LIMIT_*`

## Local run
```bash
cd mvp/backend
cp .env.example .env
npm install
npm run dev
```

If `node` is not on PATH:
```bash
NODE_DIR=/Users/nripendrabhattacharjee/Documents/Healify/mvp/.tooling/node
PATH="$NODE_DIR/bin:$PATH" "$NODE_DIR/bin/node" "$NODE_DIR/lib/node_modules/npm/bin/npm-cli.js" install
PATH="$NODE_DIR/bin:$PATH" "$NODE_DIR/bin/node" src/server.js
```

Server default: `http://localhost:8787`

## Smoke test
```bash
cd mvp/backend
./scripts/smoke.sh http://localhost:8787
```

This now validates:
- OTP send/verify
- session flow + progress
- refresh token rotation
- logout revocation (refresh rejected after logout)

## Deployment
### Docker
```bash
cd mvp/backend
docker build -t helify-backend .
docker run --env-file .env -p 8787:8787 helify-backend
```

### Render
- Blueprint file: repository root `render.yaml`.
- Set secret env vars in Render dashboard:
  - `CORS_ORIGIN`
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_VERIFY_SERVICE_SID`
- Attach persistent disk (already declared in blueprint at `/var/data`).

### GitHub Actions
- CI workflow: `.github/workflows/backend-ci.yml` (install + smoke test).
- CD workflow: `.github/workflows/backend-deploy.yml` (triggers Render deploy hook).
- Add repository secret: `RENDER_DEPLOY_HOOK_URL`.
