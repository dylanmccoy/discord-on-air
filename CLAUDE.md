# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Layout

The repo root is `discord-on-air/` (formerly a nested `MuteChecker/` folder — flattened, git history preserved). It holds four **independent** packages that are developed, deployed, and run separately:

- `backend/` — a Discord bot (discord.js v14) plus an Express REST API that exposes voice-channel state, and a single-user status API (`/api/status`, `/api/stream`, `/api/ingest`) for driving a hardware "on air" light.
- `frontend/` — a bare Express static-file server for the dashboard UI.
- `discord-rpc-helper/` — desktop-side bridge (Node ≥18, only dep is `dotenv`). Talks to the local Discord client over its RPC/IPC socket and POSTs `{inVoice,muted,deafened,streaming}` state. This is the only way to know the mute toggle while **not** connected to a voice channel. Targets either the backend's `/api/ingest/:userId` (`BACKEND_URL`) or, in "direct mode", an arbitrary URL (`INGEST_URL`) such as `pi-light`. Sends a heartbeat every 10s and a clear-state POST on clean exit.
- `pi-light/` — Raspberry Pi listener (`light_server.py`, stdlib + `gpiozero`). Receives the helper's POSTs and drives an RGB LED; a watchdog blanks the LED after `STALE_AFTER` seconds with no update. This is the whole device side for the "light only matters while my PC is on" setup — no bot/backend needed on that path.

There is no root package, no workspace tooling, no build step, and no test suite. Each package is installed and run on its own (`npm install` for the three Node ones; `pi-light` is stdlib Python + `gpiozero`).

## Commands

Backend (`cd backend`):

```bash
npm install
npm start        # node server.js
npm run dev      # nodemon server.js (auto-restart)
```

Frontend (`cd frontend`):

```bash
npm install
npm start        # node frontend-server.js
npm run dev      # nodemon frontend-server.js
```

Run both at once in separate terminals; the frontend expects the backend reachable at its configured `API_URL`.

Quick health checks: `curl http://localhost:3000/api/health` (backend) and `curl http://localhost:8080/health` (frontend).

## Configuration

Both packages read a local `.env` (gitignored) via `dotenv`.

- Backend: `DISCORD_BOT_TOKEN` (required), `GUILD_IDS` (comma-separated guild IDs; **empty means monitor every guild the bot is in**), `PORT` (default 3000), `TRACKED_USER_IDS` (comma-separated Discord user IDs the single-user endpoints expose; empty = every user seen), `API_TOKEN` (shared secret for `/api/status|stream|ingest`; empty = check disabled, fine for localhost-only).
- Frontend: `FRONTEND_PORT` (default 8080). `BACKEND_API_URL` exists in `.env` but is not consumed by `frontend-server.js` — the browser's API base URL is hardcoded in `frontend/public/index.html` instead (see below).
- `discord-rpc-helper`: `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` / `DISCORD_REDIRECT_URI`, `BACKEND_URL`, `API_TOKEN` (must match the backend), `DISCORD_SCOPES`.

## Backend architecture (`backend/server.js`)

Single file. Flow:

1. A discord.js `Client` connects with only the `Guilds` and `GuildVoiceStates` intents.
2. State is held entirely in memory in a `Map` keyed by guild ID (`guildsData`). There is no database or cache layer.
3. `updateVoiceData(guildId)` rebuilds one guild's snapshot from `client.guilds.cache`: it walks every channel of `type === 2` (voice), collects the members present, and derives per-member flags (`muted` = `mute || selfMute`, `deafened` = `deaf || selfDeaf`, plus `streaming`, `video`). `speaking` is always `false` (not derivable from this intent set).
4. It is called once per monitored guild on `ready`, and again on every `voiceStateUpdate` event for the affected guild. Nothing polls on a timer server-side — freshness comes from Discord gateway events.
5. `getMonitoredGuildIds()` returns `GUILD_IDS` if set, otherwise all cached guild IDs. All API routes go through it.

REST API (CORS fully open):

- `GET /api/guilds` — summary list (counts, `lastUpdate`); includes guilds that are known but have no snapshot yet.
- `GET /api/voice-channels` — full snapshot for every monitored guild (`{ guilds: [...] }`).
- `GET /api/voice-channels/:guildId` — one guild's snapshot; 404 if no data.
- `GET /api/voice-channels/:guildId/:channelId` — one channel.
- `GET /api/health` — bot connection + which guilds have data.

### Single-user status API (hardware light)

A second, independent layer in `server.js` tracks one derived `state` string per user — `disconnected` / `connected` / `muted` / `deafened` / `streaming` (mute/deafen outrank connection so an idle-but-muted state still shows). Two sources feed it: `botStates` from `voiceStateUpdate` (only while in a server voice channel) and `rpcStates` from `POST /api/ingest` (the desktop helper). A fresh rpc snapshot wins for `RPC_TTL_MS` (30s); otherwise the bot snapshot; otherwise `disconnected`. A timer re-evaluates so state falls back cleanly when the helper stops.

- `GET /api/status/:userId` — one compact snapshot `{ userId, state, inVoice, muted, deafened, streaming, source, ts }`.
- `GET /api/stream/:userId` — SSE; emits the snapshot immediately, then again on every `state` change. 15s `: ping` heartbeat. This is what the Pi consumes.
- `POST /api/ingest/:userId` — body `{ inVoice?, muted?, deafened?, streaming? }`; used only by `discord-rpc-helper`.

All three honor `checkToken` (query `?token=` or `Authorization: Bearer`), a no-op when `API_TOKEN` is unset.

## Frontend architecture

`frontend/public/index.html` is the entire app: one self-contained file, vanilla JS, no framework or bundler. It polls `GET /api/guilds` + `GET /api/voice-channels[/:guildId]` every 10 seconds, renders guild tabs and channel cards, and supports an "All Guilds" aggregate view.

The API base URL is a hardcoded constant near the top of the `<script>` block: `localhost` hostname → `http://localhost:3000/api`, otherwise → the deployed backend (`https://mutechecker.onrender.com/api`). Changing backends means editing that constant in the HTML.

`frontend/frontend-server.js` only does `express.static('public')` and serves `index.html` at `/`.

## Legacy / non-source files (do not treat as active code)

- `backend/discord-voice-status.html` — an earlier standalone copy of the dashboard, superseded by `frontend/public/index.html`. It still points its `API_URL` straight at the production backend.
- `backend/discord-setup-files.js` — not executable; a scratch file of concatenated `package.json` / `.env` / `README` snippets. Its snippets reference a stale singular `GUILD_ID` var that the current `server.js` does not use (`GUILD_IDS` is the real one).
- `backend/README.md` describes the older single-guild version; the root `README.md` is the current one.

## Deployment

The backend is deployed on Render at `mutechecker.onrender.com` (build `npm install`, start `npm start`). README suggests PM2 for self-hosting.
