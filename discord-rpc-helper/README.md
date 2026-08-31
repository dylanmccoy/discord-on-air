# discord-rpc-helper

Optional desktop-side bridge that answers the question **"what is my mute status
when I'm not in a call?"**

The bot in `../backend` can only see your mute/deafen state while you are
connected to a *server* voice channel — that is all Discord sends over the
gateway. The mute button in Discord's UI while you are idle (or in a DM / group
call) is a **local client setting** that never leaves your machine.

The only way to read it is to talk to the Discord desktop client directly over
its local RPC (IPC) socket. That is what this helper does: it subscribes to
`VOICE_SETTINGS_UPDATE` / `VOICE_CHANNEL_SELECT`, and POSTs a compact
`{ inVoice, muted, deafened }` to the backend's `POST /api/ingest/:userId`
every time something changes (plus a heartbeat every 10s).

The backend then prefers this "rpc" data over the bot data whenever it is fresh,
so `/api/status` and `/api/stream` report the toggle state at all times.

```
Discord desktop app ──IPC──> discord-rpc-helper ──HTTP POST──> backend /api/ingest
                                                                     │
                                                          /api/stream (SSE) ──> Raspberry Pi
```

## Requirements

- **Node 18+** (uses the global `fetch`).
- The **Discord desktop app** must be running and logged in on the same machine.
- A Discord application you own — reuse the same one as the bot, or make a new
  one at <https://discord.com/developers/applications>. You need its **Client ID**
  and **Client Secret** (Settings → OAuth2).
- Under **OAuth2 → Redirects**, add `http://localhost` (or whatever you set as
  `DISCORD_REDIRECT_URI`).
- The Discord account that approves the RPC prompt must be the **app owner** or a
  member of the app's **team / tester list**. The `rpc` scope is otherwise
  restricted. For "just me and a friend", add the friend under the app's team.

## Setup

```bash
cd discord-on-air/discord-rpc-helper
npm install
cp .env.example .env
# fill in DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET, and API_TOKEN if the backend uses one
npm start
```

On first run Discord shows an authorization popup — approve it. The resulting
OAuth token is cached in `.token.json` and refreshed automatically, so
subsequent runs are silent.

## Running it as a service

Linux (`systemd --user`, so it starts with your desktop session):

```ini
# ~/.config/systemd/user/discord-rpc-helper.service
[Unit]
Description=Discord RPC -> discord-on-air bridge
After=graphical-session.target

[Service]
WorkingDirectory=%h/path/to/discord-on-air/discord-rpc-helper
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now discord-rpc-helper
```

## Notes / limitations

- If the helper is not running, the backend silently falls back to bot data
  after `RPC_TTL_MS` (30s) — you just lose the "muted while idle" state.
- `streaming` is not reported by this helper (RPC does not expose a simple flag
  for it); it stays whatever the bot last saw.
- This does **not** need the bot to be in any voice channel with you. The two
  data sources are independent and the backend merges them.
