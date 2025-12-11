# Discord Voice Status Dashboard

A real-time dashboard showing voice channel activity across multiple Discord servers.

## Features

- ✅ Monitor unlimited Discord servers simultaneously
- ✅ Real-time voice channel updates
- ✅ Shows muted, deafened, streaming, and video status
- ✅ Beautiful tabbed interface to switch between servers
- ✅ View all servers at once or individually
- ✅ Auto-refresh every 10 seconds
- ✅ Responsive design

## Setup Instructions

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
# Navigate to your project folder
cd discord-voice-status

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
