# FlixCoin

Production-oriented Telegram Mini App starter for a Watch-to-Earn vertical video platform.

FlixCoin is a dark, Instagram Reels/TikTok-style TMA with secure anonymous registration, role-based publishing, coin rewards, anti-cheat strikes, and a SuperAdmin panel called WalletAdminka.

## Repository Structure

```text
.
  backend/
    main.py
    requirements.txt
  frontend/
    src/
      App.jsx
  src/
    App.jsx
    main.jsx
    styles.css
  package.json
  tailwind.config.js
  vite.config.js
  README.md
```

The active Vite app in this workspace imports `src/App.jsx`. A mirrored copy is also placed at `frontend/src/App.jsx` to match the requested GitHub structure.

## Core Features

- Anonymous username/password registration with no phone number.
- Backend-generated unique `full_username`, such as `mentalego%5`.
- FastAPI bearer token auth.
- RBAC with `is_uploader` and `is_superadmin`.
- Empty global feed by default until an approved publisher posts video links.
- Secret Video Link Publisher visible only to uploaders and superadmins.
- Backend-enforced `403 Forbidden` for unauthorized video publishing.
- WebSocket feed push when a new video is published.
- Watch reward: completed video grants 2 coins.
- Creator reward: like grants 0.5 coins.
- Creator reward: follow grants 1 coin.
- IP and fingerprint anti-cheat strike system.
- Strike 1: nullify/deduct/log.
- Strike 2: freeze monetization for 24 hours.
- Strike 3: ban user and lock hardware fingerprint.
- Banned users are routed to WalletAdminka Ban Request page.
- SuperAdmin WalletAdminka can search users and edit coins, followers, likes, and uploader access.

## Backend Setup

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Health check:

```text
http://127.0.0.1:8000/health
```

Default local SuperAdmin:

```text
full_username: admin#0
password: Admin12345!
```

Set production secrets before deployment:

```bash
set FLIXCOIN_SECRET=replace-with-long-random-secret
set FLIXCOIN_SUPERADMIN_USERNAME=admin
set FLIXCOIN_SUPERADMIN_PASSWORD=replace-with-strong-password
set FRONTEND_ORIGIN=http://127.0.0.1:5173
```

## Frontend Setup

From the repository root:

```bash
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:5173/
```

Build:

```bash
npm run build
```

## Security Notes

- The frontend hides privileged controls, but security is enforced on the backend.
- `/videos` POST requires `is_uploader = true` or `is_superadmin = true`.
- The backend tracks `client.host` IP and browser fingerprint hashes.
- Abuse profiles lock banned fingerprints so new accounts from the same hardware signature are blocked.
- Passwords are hashed with bcrypt via Passlib.
- CORS is restricted to `http://127.0.0.1:5173` and `http://localhost:5173` for local development.
- The bundled token signer is HMAC-based for a compact demo. For production, migrate to JWT with key rotation and refresh-token sessions.
- Use PostgreSQL in production, enable TLS, WAF/CDN DDoS protection, structured audit logs, and managed secrets.

## Production Hardening Checklist

- Replace `FLIXCOIN_SECRET`.
- Replace bootstrap SuperAdmin password.
- Use PostgreSQL with async SQLAlchemy/Alembic migrations.
- Add refresh token rotation and session revocation.
- Rate-limit auth, watch, like, follow, and publish endpoints.
- Put FastAPI behind HTTPS-only Nginx or a managed load balancer.
- Store audit/security logs in append-only infrastructure.
- Validate video URLs with signed media ingestion instead of trusting arbitrary public URLs.
- Add Telegram `initData` validation before trusting Telegram Mini App context.
- Move anti-cheat rules into a dedicated risk service when volume grows.
