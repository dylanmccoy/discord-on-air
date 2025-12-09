// ========== package.json ==========
{
  "name": "discord-voice-status-backend",
  "version": "1.0.0",
  "description": "Backend server for Discord voice channel status dashboard",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "keywords": ["discord", "voice", "status"],
  "author": "",
  "license": "MIT",
  "dependencies": {
    "express": "^4.18.2",
    "discord.js": "^14.14.1",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1"
  },
  "devDependencies": {
    "nodemon": "^3.0.2"
  }
}

// ========== .env ==========
// Copy this to a new file named ".env" and fill in your values

# Your Discord Bot Token (from https://discord.com/developers/applications)
DISCORD_BOT_TOKEN=your_bot_token_here

# Your Discord Server (Guild) ID
GUILD_ID=your_guild_id_here

# Server port (optional, defaults to 3000)
PORT=3000

// ========== .gitignore ==========
node_modules/
.env
.DS_Store
*.log

// ========== README.md ==========

# Discord Voice Status Dashboard

A real-time dashboard showing voice channel activity in your Discord server.

## Setup Instructions

### 1. Create a Discord Bot

1. Go to https://discord.com/developers/applications
2. Click "New Application" and give it a name
3. Go to the "Bot" tab and click "Add Bot"
4. Under "Privileged Gateway Intents", enable:
   - ✅ SERVER MEMBERS INTENT
   - ✅ PRESENCE INTENT (optional)
5. Click "Reset Token" and copy your bot token (save it for later)

### 2. Invite Bot to Your Server

1. Go to the "OAuth2" > "URL Generator" tab
2. Select scopes:
   - ✅ bot
3. Select bot permissions:
   - ✅ View Channels
   - ✅ Connect (to voice channels)
4. Copy the generated URL and open it in your browser
5. Select your server and authorize the bot

### 3. Get Your Guild (Server) ID

1. Enable Developer Mode in Discord:
   - Settings > Advanced > Developer Mode (toggle on)
2. Right-click your server icon and click "Copy Server ID"

### 4. Install Backend

```bash
# Navigate to your project folder
cd discord-voice-status

# Install dependencies
npm install

# Create .env file and add your credentials
# Edit .env with your favorite text editor:
nano .env

# Add these lines (replace with your actual values):
DISCORD_BOT_TOKEN=YOUR_BOT_TOKEN_HERE
GUILD_ID=YOUR_GUILD_ID_HERE
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
📊 Monitoring guild: YOUR_GUILD_ID
🚀 Server running on port 3000
📡 API available at http://localhost:3000/api/voice-channels
```

### 6. Open the Frontend

1. Open `index.html` in your web browser
2. The dashboard should connect automatically and show your voice channels

## API Endpoints

- `GET /api/voice-channels` - Get all voice channels with member data
- `GET /api/voice-channels/:channelId` - Get specific channel data
- `GET /api/health` - Check if bot is connected

## Troubleshooting

### Bot not connecting?
- Make sure your bot token is correct
- Check that the bot has been invited to your server
- Verify the bot has proper permissions

### No channels showing?
- Confirm your GUILD_ID is correct
- Make sure the bot can see voice channels in your server
- Check the browser console for errors

### CORS errors?
- Make sure the backend server is running
- Check that API_URL in index.html matches your backend URL
- If hosting remotely, update the CORS settings in server.js

## Customization

- Change refresh interval in `index.html` (default: 10 seconds)
- Modify port in `.env` file
- Customize styling in the `<style>` section of `index.html`

## Deployment

For production, consider:
- Using a process manager like PM2
- Setting up HTTPS
- Using environment variables for configuration
- Deploying to services like Heroku, Railway, or DigitalOcean

## License

MIT