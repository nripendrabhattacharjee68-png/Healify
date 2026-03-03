# Helify Paralysis MVP (Static Build)

This folder contains a runnable MVP for post-stroke hemiparesis rehab with:
- Patient onboarding + consent
- Daily safety check-in + red-flag gating
- Guided session flow with camera preview, exercise logging, assisted mode, and voice cues
- Session summary + 7-day progress
- Caregiver mode (large controls)
- Physio dashboard, alert queue, patient detail, notes, and care-plan updates
- Auto-alert engine for all requested rules
- Backend service implementation in `backend/` (Node + SQLite)

## Files
- `src/index.html`: UI screens
- `src/styles.css`: styling
- `src/app.js`: data model, endpoint-style API layer, alert logic, and screen handlers
- `docs/schema.sql`: backend SQL schema for migration
- `docs/api.md`: API contracts
- `docs/backend-integration.md`: switch from local mode to backend API mode
- `backend/`: runnable API server with the same contract

## Run
Open `src/index.html` in a browser.

If camera permissions are blocked in a local file context, host this folder with any static server.

## Frontend Modes
- Local mode (default): runs fully in browser localStorage.
- Remote API mode: append `?api_base=http://localhost:8787` to `src/index.html` once.
  - Example: `http://127.0.0.1:5500/mvp/src/index.html?api_base=http://localhost:8787`
  - The API base is stored in browser localStorage as `helify_api_base`.

## Backend Run
```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

`/auth/verify-otp` now returns a JWT access token, and frontend backend mode sends it automatically as `Authorization: Bearer ...`.

## Important MVP Note
This build intentionally runs fully client-side for quick prototyping.
For production/clinical use, move storage and auth to a secure backend and keep PHI off local storage.
