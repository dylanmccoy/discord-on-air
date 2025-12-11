# Discord Voice Status - Frontend Server Setup

This is an Express.js frontend server to serve the Discord Voice Status dashboard.

## Project Structure

```
discord-voice-status-frontend/
├── frontend-server.js      # Express server
├── package.json           # Dependencies
├── .env                  # Configuration
├── .gitignore           # Git ignore file
└── public/
    └── index.html       # Frontend HTML/CSS/JS
```

## Quick Setup

### 1. Create the Project Structure

```bash
# Create project directory
mkdir discord-voice-status-frontend
cd discord-voice-status-frontend

# Create public directory
mkdir public

# Create files
touch frontend-server.js
touch package.json
touch .env
```

### 2. Install Dependencies

```bash
npm install
```

Or manually install:
```bash
npm install express dotenv
npm install --save-dev nodemon
```

### 3. Add Files

Place these files in your project:
- `frontend-server.js` - Main Express server (from artifact)
- `package.json` - Dependencies configuration (from artifact)
- `public/index.html` - Frontend HTML file (from artifact)
- `.env` - Environment configuration (from artifact)

### 4. Configure Environment

Edit `.env`:

```env
# Port for the frontend server
FRONTEND_PORT=8080

# Backend API URL (optional)
BACKEND_API_URL=https://mutechecker.onrender.com/api
```

### 5. Run the Server

**Development mode (with auto-reload):**
```bash
npm run dev
```

**Production mode:**
```bash
npm start
```

The frontend will be available at: `http://localhost:8080`

## API Configuration

The frontend automatically detects the environment:

- **Development** (localhost): Uses `http://localhost:3000/api`
- **Production**: Uses `https://mutechecker.onrender.com/api`

To change the API URL, edit the `API_URL` constant in `public/index.html`:

```javascript
const API_URL = window.location.hostname === 'localhost' 
    ? 'http://localhost:3000/api'  // Development
    : 'https://mutechecker.onrender.com/api';  // Production
```

## Deployment

### Deploy to Render.com

1. Create a new Web Service on Render
2. Connect your GitHub repository
3. Configure:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment Variables**: Add `FRONTEND_PORT=8080`

### Deploy to Heroku

```bash
# Login to Heroku
heroku login

# Create app
heroku create discord-voice-frontend

# Set environment variables
heroku config:set FRONTEND_PORT=8080

# Deploy
git push heroku main
```

### Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel
```

### Deploy to Railway

1. Push to GitHub
2. Create new project on Railway
3. Connect repository
4. Set environment variables
5. Deploy

## Running Both Backend and Frontend Together

### Option 1: Separate Servers (Recommended)

Run backend and frontend on different ports:

```bash
# Terminal 1 - Backend
cd discord-voice-status-backend
npm start  # Runs on port 3000

# Terminal 2 - Frontend
cd discord-voice-status-frontend
npm start  # Runs on port 8080
```

### Option 2: Combined Server

You can also serve the frontend from the backend server by adding this to your backend `server.js`:

```javascript
// Serve static frontend files
app.use(express.static(path.join(__dirname, '../discord-voice-status-frontend/public')));

// Serve frontend for root path
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../discord-voice-status-frontend/public/index.html'));
});
```

## CORS Configuration

If you're running frontend and backend on different domains, make sure CORS is configured in your backend:

```javascript
// In backend server.js
const cors = require('cors');

app.use(cors({
    origin: [
        'http://localhost:8080',           // Local frontend
        'https://your-frontend-domain.com' // Production frontend
    ],
    credentials: true
}));
```

## Development Tips

### Hot Reload

Use nodemon for auto-restart on file changes:
```bash
npm run dev
```

### Debugging

Check logs:
```bash
# Backend logs
curl http://localhost:3000/api/health

# Frontend logs
curl http://localhost:8080/health
```

### Environment-Specific Config

Create multiple `.env` files:
- `.env.development`
- `.env.production`

Then use:
```bash
NODE_ENV=production npm start
```

## Troubleshooting

### Port Already in Use

Change the port in `.env`:
```env
FRONTEND_PORT=8081
```

### Cannot Connect to Backend

1. Check backend is running: `curl http://localhost:3000/api/health`
2. Verify API_URL in `public/index.html`
3. Check CORS settings in backend

### 404 Errors

Make sure `public/index.html` exists and the path is correct in `frontend-server.js`

## File Permissions

Make sure files are executable:
```bash
chmod +x frontend-server.js
```

## Security Notes

- Never commit `.env` files to Git
- Use environment variables for sensitive config
- Enable HTTPS in production
- Set proper CORS origins
- Rate limit API requests if needed

## Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Use HTTPS
- [ ] Configure proper CORS origins
- [ ] Set up logging
- [ ] Add error monitoring (e.g., Sentry)
- [ ] Enable gzip compression
- [ ] Set up health checks
- [ ] Configure rate limiting
- [ ] Add security headers

## License

MIT
