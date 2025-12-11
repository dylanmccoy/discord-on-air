// frontend-server.js
// A simple Express server to serve the frontend

const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.FRONTEND_PORT || 8080;

// Serve static files from 'public' directory
app.use(express.static('public'));

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'frontend' });
});

// Start server
app.listen(PORT, () => {
    console.log(`🎨 Frontend server running on http://localhost:${PORT}`);
    console.log(`📂 Serving files from: ${path.join(__dirname, 'public')}`);
});
