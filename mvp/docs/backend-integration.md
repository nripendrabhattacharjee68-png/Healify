# Frontend -> Backend Integration Guide

`src/app.js` supports both local mode and backend mode.

## 1) Start backend
```bash
cd mvp/backend
cp .env.example .env
npm install
npm run dev
```

## 2) Use this base URL
`http://localhost:8787`

## 3) Enable backend mode in frontend
Open frontend with:
`http://127.0.0.1:5500/mvp/src/index.html?api_base=http://localhost:8787`

This stores `helify_api_base` in browser localStorage and switches app calls to backend APIs.

To switch back to local mode:
```js
localStorage.removeItem("helify_api_base");
location.reload();
```

## 4) Auth flow
1. `POST /auth/send-otp`
2. `POST /auth/verify-otp`
3. Use returned `access_token` as `Authorization: Bearer <token>` for protected APIs.

The current frontend handles this automatically and persists token in localStorage.

## 5) Minimum production hardening
1. Replace demo OTP with real SMS provider.
2. Encrypt backups and secure DB at rest.
3. Add audit logs for all physio actions and access events.
4. Add rate limiting for OTP and auth routes.
5. Add explicit emergency disclaimers in app UI.
