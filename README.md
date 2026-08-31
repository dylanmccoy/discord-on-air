# discord-on-air

Discord voice-channel status — as a real-time web dashboard, and/or as a physical
"on air" light (RGB LED on a Raspberry Pi) that turns red the moment you mute.

## Features

- ✅ Monitor unlimited Discord servers simultaneously
- ✅ Real-time voice channel updates
- ✅ Shows muted, deafened, streaming, and video status
- ✅ Beautiful tabbed interface to switch between servers
- ✅ View all servers at once or individually
- ✅ Auto-refresh every 10 seconds
- ✅ Responsive design

## What's in this repo

| Path | What it is |
|------|------------|
| `backend/` | Discord bot (discord.js) + Express REST/SSE API |
| `frontend/` | Static web dashboard server |
| `discord-rpc-helper/` | **PC-side** bridge: reads your mute/deafen toggle from the local Discord desktop client over its RPC socket and POSTs it out |
| `pi-light/` | **Raspberry Pi-side** HTTP → RGB LED server |
| `esp32-light/` | **ESP32-S2-side** MicroPython HTTP server → onboard WS2812 LED (same protocol as `pi-light`, over Wi-Fi) |

Two independent ways to use it:

- **Web dashboard** — the bot watches server voice channels and a browser page shows who's in voice and their mute/deafen/stream status. See [Dashboard setup (web UI)](#dashboard-setup-web-ui).
- **Hardware "on air" light** — a physical RGB LED that turns red the moment you mute in Discord (in a call *or* just sitting idle), driven straight from your PC. No bot, no server, no cloud. See [Hardware mute light (Raspberry Pi)](#hardware-mute-light-raspberry-pi).

---

## Hardware mute light (Raspberry Pi)

Use this when the light only needs to work while your PC is on. The chain is
**PC → Pi → LED** and nothing else is involved.

> **On an ESP32-S2 instead of a Pi?** See [`esp32-light/`](esp32-light/) — a
> MicroPython port of `pi-light` that drives the board's onboard RGB LED over
> Wi-Fi. The PC side is unchanged; just set
> `INGEST_URL=http://<esp-ip>:8000/` in the helper's `.env`.

### Why RPC and not the bot

A Discord bot only sees your mute/deafen state while you're connected to a
*server* voice channel — that's all Discord sends over the gateway. The mute
button while you're idle, or in a DM / group call, is a **local client setting**
that never leaves your machine. The only way to read it is to talk to the
Discord *desktop app* directly over its local RPC (IPC) socket, which is what
`discord-rpc-helper` does. That socket only exists on the machine running
Discord, so the helper runs on your **PC**, not the Pi.

### Architecture

```
        YOUR PC (where Discord runs)                     RASPBERRY PI
 ┌───────────────────────────────────┐         ┌──────────────────────────────────┐
 │   Discord desktop app             │         │   pi-light/light_server.py       │
 │        │  local IPC socket        │         │      (stdlib HTTP + gpiozero)    │
 │        ▼                          │  HTTP   │        │  sets GPIO 17/27/22     │
 │   discord-rpc-helper/index.js  ───┼─POST────┼──►  HTTP server :8000            │
 │        (Node 18+, dotenv only)    │  JSON   │        │                         │
 │        - reads mute/deafen toggle │  every  │        ▼                         │
 │        - reads in-voice channel   │  change │     RGB LED  (red = muted)       │
 │        - heartbeat every 10s      │  +10s   │                                  │
 │        - clear POST on clean exit │         │   watchdog: no POST for 30s →    │
 │                                   │         │             LED off ("stale")    │
 └───────────────────────────────────┘         └──────────────────────────────────┘
        systemd --user service                     systemd system service
```

Payload the helper sends: `{"inVoice":true,"muted":true,"deafened":false,"streaming":false}`

State the Pi derives (priority **deafen > mute > streaming > connected**):

| LED | meaning |
|-----|---------|
| 🔵 blue | deafened |
| 🔴 red | muted — in a call **or** idle |
| 🟢 green | in a voice channel, mic live |
| ⚫ off | not in voice / not muted, **or** PC asleep / Discord closed / helper stopped (watchdog) |

`streaming` (magenta) is defined but RPC doesn't expose a simple flag for it, so
in this setup it stays off.

### 1. Create a Discord application (one-time)

1. <https://discord.com/developers/applications> → your app (reuse the bot's app, or make a new one).
2. **OAuth2** → copy the **Client ID** and **Client Secret**.
3. **OAuth2 → Redirects** → add exactly `http://localhost` → Save.
4. Second person running their own helper? Add them under **App → Team** (or as a tester). Discord rejects the `rpc` scope for accounts that aren't on the app's team.

### 2. Raspberry Pi

Wire a common-cathode RGB LED: each colour leg → 220–330 Ω resistor → BCM
**17 (R) / 27 (G) / 22 (B)**, common leg → GND. (Common-anode: common → 3V3, and
set `LED_ACTIVE_HIGH=0`.)

```bash
# copy the repo (or just pi-light/) to the Pi, e.g. ~/discord-on-air
cd ~/discord-on-air/pi-light
pip install -r requirements.txt        # gpiozero — usually already on Pi OS
cp .env.example .env
```

Edit `.env` — set `API_TOKEN` to a long random string, adjust `LED_PINS` if needed.

Run as a service (edit `User=` and paths in `pi-light.service` first):

```bash
sudo cp pi-light.service /etc/systemd/system/
sudo systemctl enable --now pi-light
journalctl -u pi-light -f
```

Smoke test — the LED should turn red:

```bash
curl -X POST 'http://localhost:8000/?token=YOUR_TOKEN' \
  -H 'Content-Type: application/json' -d '{"inVoice":true,"muted":true}'
```

### 3. Networking

The PC needs a stable address for the Pi:

- Easiest: `raspberrypi.local` (mDNS, on by default in Pi OS). Check from the PC with `ping raspberrypi.local`.
- Or assign the Pi a static DHCP lease and use its IP.
- Open the port if the Pi runs a firewall: `sudo ufw allow from 192.168.0.0/16 to any port 8000`.
- To also work away from home, put both machines on Tailscale and use the Pi's tailnet name in `INGEST_URL`.

### 4. Your PC

```bash
cd discord-rpc-helper
npm install
cp .env.example .env
```

Edit `.env`:

```env
DISCORD_CLIENT_ID=<from step 1>
DISCORD_CLIENT_SECRET=<from step 1>
DISCORD_REDIRECT_URI=http://localhost
INGEST_URL=http://raspberrypi.local:8000/
API_TOKEN=<same string as the Pi>
```

```bash
npm start
```

Discord shows an authorization popup the first time — approve it. The OAuth
token is cached in `.token.json` and refreshed automatically, so later starts
are silent. Toggle your mute; the Pi LED should follow within a fraction of a
second.

Start it with your desktop session — `~/.config/systemd/user/discord-rpc-helper.service`:

```ini
[Unit]
Description=Discord RPC -> pi-light bridge
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
loginctl enable-linger "$USER"   # optional: run before a GUI session is open
```

(Windows: Task Scheduler "at log on", or `pm2`. macOS: a LaunchAgent.)

### Behaviour

| Situation | Result |
|-----------|--------|
| You mute (in call or idle) | helper POSTs immediately → LED red in <1s |
| PC sleeps | POSTs stop → Pi watchdog blanks the LED after `STALE_AFTER` (30s) |
| PC wakes | helper reconnect loop resumes → LED correct within ~10s |
| You quit Discord | IPC socket drops → helper retries every 3s; LED off via watchdog meanwhile |
| You stop the helper (Ctrl-C / `systemctl stop`) | it sends one final all-false POST → LED off right away |
| Pi reboots | `pi-light` autostarts, LED off until the next POST |

### Alternative: keep the web dashboard too

Point the helper at the Node backend instead of the Pi — set `BACKEND_URL=`
(not `INGEST_URL=`) and run `backend/`. The helper then POSTs to
`/api/ingest/<your user id>`, and `GET /api/status/:userId` / `GET /api/stream/:userId`
expose the merged bot-plus-RPC state (see [Single-user status API](#single-user-status-api)).
The Pi's LED script would then read `/api/stream` instead of running `pi-light`.

---

## Dashboard setup (web UI)

### 1. Create a Discord Bot

1. Go to https://discord.com/developers/applications
2. Click "New Application" and give it a name
3. Go to the "Bot" tab and click "Add Bot"
4. Under "Privileged Gateway Intents", enable:
   - ✅ SERVER MEMBERS INTENT
   - ✅ PRESENCE INTENT (optional)
5. Click "Reset Token" and copy your bot token (save it for later)

### 2. Invite Bot to Your Servers

1. Go to the "OAuth2" > "URL Generator" tab
2. Select scopes:
   - ✅ bot
3. Select bot permissions:
   - ✅ View Channels
   - ✅ Connect (to voice channels)
4. Copy the generated URL and open it in your browser
5. Authorize the bot for EACH server you want to monitor
6. Repeat for all servers

### 3. Get Your Guild (Server) IDs (Optional)

**Option A: Monitor ALL servers** (Recommended)
- Leave `GUILD_IDS` empty in your `.env` file
- Bot will automatically monitor all servers it's in

**Option B: Monitor specific servers**
1. Enable Developer Mode in Discord:
   - Settings > Advanced > Developer Mode (toggle on)
2. Right-click each server icon and click "Copy Server ID"
3. Add all IDs to `.env` separated by commas (see below)

### 4. Install Backend

```bash
# Navigate to the backend package
cd backend

# Install dependencies
npm install

# Create .env file
# Edit .env with your favorite text editor:
nano .env
```

Add these lines to `.env`:

```env
# Your bot token
DISCORD_BOT_TOKEN=YOUR_BOT_TOKEN_HERE

# Option A: Monitor all servers (leave empty)
GUILD_IDS=

# Option B: Monitor specific servers (comma-separated)
# GUILD_IDS=123456789012345678,987654321098765432,111222333444555666

# Port (optional)
PORT=3000
```

### 5. Start the Backend Server

```bash
npm start

# Or for development with auto-restart:
npm run dev
```

You should see:
```
✅ Bot logged in as YourBotName#1234
📊 Monitoring 3 guilds:
   - Server One (123456789012345678)
   - Server Two (987654321098765432)
   - Server Three (111222333444555666)
🚀 Server running on port 3000
📡 API available at http://localhost:3000/api/guilds
```

### 6. Open the Frontend

1. Open `index.html` in your web browser
2. The dashboard will show tabs for each server
3. Click any tab to view that server's voice channels
4. Click "All Guilds" to see all servers at once

## API Endpoints

### Get all guilds
```
GET /api/guilds
```
Returns a list of all monitored guilds with basic info.

### Get all voice channels (all guilds)
```
GET /api/voice-channels
```
Returns voice channel data for all guilds.

### Get voice channels for specific guild
```
GET /api/voice-channels/:guildId
```
Returns voice channel data for a specific guild.

### Get specific channel
```
GET /api/voice-channels/:guildId/:channelId
```
Returns data for a specific channel.

### Health check
```
GET /api/health
```
Check if bot is connected and see monitored guilds.

### Single-user status API

A separate layer for driving one person's status light. It derives a single
`state` string per user — `disconnected` / `connected` / `muted` / `deafened` /
`streaming` — from two sources that are merged automatically: `voiceStateUpdate`
gateway events (only while in a server voice channel) and POSTs from
`discord-rpc-helper` (the mute toggle at all times). A fresh RPC POST wins for 30
seconds, otherwise the gateway data is used.

```
GET  /api/status/:userId          → { userId, state, inVoice, muted, deafened, streaming, source, ts }
GET  /api/stream/:userId          → text/event-stream; emits the snapshot now, then on every state change
POST /api/ingest/:userId          → body { inVoice?, muted?, deafened?, streaming? }; used by discord-rpc-helper
```

Config in `backend/.env`:

```env
# Discord user IDs the endpoints above expose (comma-separated). Empty = every user seen.
TRACKED_USER_IDS=

# Shared secret for /api/status, /api/stream and /api/ingest (query ?token= or Authorization: Bearer).
# Empty disables the check — fine when the backend only listens on localhost.
API_TOKEN=
```

For the fully local, no-bot alternative see
[Hardware mute light (Raspberry Pi)](#hardware-mute-light-raspberry-pi).

## Configuration Options

### Monitor All Guilds
Set `GUILD_IDS=` (empty) in `.env` to automatically monitor all servers the bot is in.

### Monitor Specific Guilds
Set `GUILD_IDS=123...,456...,789...` with comma-separated guild IDs.

### Change Port
Set `PORT=3000` (or any port) in `.env`.

## Troubleshooting

### Bot not connecting?
- Make sure your bot token is correct
- Check that the bot has been invited to your servers
- Verify the bot has proper permissions

### No channels showing?
- Confirm your GUILD_IDS are correct (or empty for all guilds)
- Make sure the bot can see voice channels in your server
- Check the browser console for errors

### CORS errors?
- Make sure the backend server is running
- Check that API_URL in index.html matches your backend URL
- If hosting remotely, update the CORS settings in server.js

### Can't see all my servers?
- Make sure GUILD_IDS is empty to monitor all servers
- Or add all server IDs separated by commas
- Check that the bot is actually in those servers

## Adding More Servers

1. Invite the bot to the new server using your OAuth2 URL
2. If using GUILD_IDS, add the new server ID to the list
3. Restart the backend server
4. Refresh the frontend - new server will appear!

## Customization

- Change refresh interval in `index.html` (default: 10 seconds)
- Modify port in `.env` file
- Customize styling in the `<style>` section of `index.html`
- Adjust which guilds to monitor in `.env`

## Deployment

For production, consider:
- Using a process manager like PM2
- Setting up HTTPS with a reverse proxy (nginx)
- Using environment variables for configuration
- Deploying to services like:
  - Railway
  - Heroku
  - DigitalOcean
  - AWS
  - Google Cloud Platform

## Example PM2 Setup

```bash
# Install PM2
npm install -g pm2

# Start with PM2
pm2 start server.js --name discord-voice-status

# Save configuration
pm2 save

# Setup startup script
pm2 startup
```

## License

MIT
