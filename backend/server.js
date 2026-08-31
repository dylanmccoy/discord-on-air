// server.js
// Install dependencies: npm install express discord.js cors dotenv

const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Discord bot setup
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// Configuration - You can specify multiple guild IDs separated by commas
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_IDS = process.env.GUILD_IDS ? process.env.GUILD_IDS.split(',').map(id => id.trim()) : [];
const TRACKED_USER_IDS = (process.env.TRACKED_USER_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
const API_TOKEN = process.env.API_TOKEN || '';

// Store for voice state data - one entry per guild
const guildsData = new Map();

// ---------------------------------------------------------------------------
// Single-user status tracking (for a hardware "on air" light on e.g. a Pi)
// ---------------------------------------------------------------------------
// Two independent sources feed one derived state per user:
//   - "bot": discord.js voiceStateUpdate events. Only populated while the user
//            is connected to a *server* voice channel.
//   - "rpc": POSTs to /api/ingest from a local Discord RPC helper running on the
//            desktop. Knows the mute/deafen toggle even when NOT in a call.
// An rpc snapshot wins while it is fresh (RPC_TTL_MS); otherwise the bot
// snapshot is used; otherwise the user is reported "disconnected".
const RPC_TTL_MS = 30_000;

const botStates = new Map();       // userId -> snapshot
const rpcStates = new Map();       // userId -> { snap, receivedAt }
const lastPublished = new Map();   // userId -> snapshot (for change detection)
const subscribers = new Map();     // userId -> Set<res> (open SSE responses)

function isTracked(userId) {
    return TRACKED_USER_IDS.length === 0 || TRACKED_USER_IDS.includes(userId);
}

// Collapse the raw flags into one canonical state string. Mute/deafen take
// priority over connection so an rpc-sourced "muted while idle" still shows.
function deriveState({ inVoice, muted, deafened, streaming }) {
    if (deafened) return 'deafened';
    if (muted) return 'muted';
    if (streaming) return 'streaming';
    if (inVoice) return 'connected';
    return 'disconnected';
}

function makeSnapshot(userId, { inVoice, muted, deafened, streaming, source }) {
    const flags = {
        inVoice: !!inVoice,
        muted: !!muted,
        deafened: !!deafened,
        streaming: !!streaming,
    };
    return { userId, state: deriveState(flags), ...flags, source, ts: new Date().toISOString() };
}

function snapshotFromVoiceState(userId, vs) {
    return makeSnapshot(userId, {
        inVoice: !!(vs && vs.channelId),
        muted: !!(vs && (vs.mute || vs.selfMute)),
        deafened: !!(vs && (vs.deaf || vs.selfDeaf)),
        streaming: !!(vs && (vs.streaming || vs.selfVideo)),
        source: 'bot',
    });
}

function effectiveSnapshot(userId) {
    const rpc = rpcStates.get(userId);
    if (rpc && Date.now() - rpc.receivedAt < RPC_TTL_MS) return rpc.snap;
    return botStates.get(userId) || makeSnapshot(userId, { source: 'none' });
}

// Recompute the effective state and, if the state string changed, fan it out
// to every SSE subscriber for that user.
function publish(userId) {
    const snap = effectiveSnapshot(userId);
    const prev = lastPublished.get(userId);
    if (prev && prev.state === snap.state && prev.source === snap.source) return;
    lastPublished.set(userId, snap);
    const payload = `data: ${JSON.stringify(snap)}\n\n`;
    for (const res of subscribers.get(userId) || []) res.write(payload);
    console.log(`💡 ${userId} -> ${snap.state} (${snap.source})`);
}

// When an rpc snapshot goes stale we need to fall back to the bot snapshot even
// though no event fired. Re-evaluate the known users periodically.
setInterval(() => {
    const ids = new Set([...TRACKED_USER_IDS, ...rpcStates.keys(), ...botStates.keys()]);
    for (const id of ids) publish(id);
}, RPC_TTL_MS / 2);

// Simple shared-secret guard for the single-user endpoints. No-op if unset.
function checkToken(req, res, next) {
    if (!API_TOKEN) return next();
    const supplied = req.query.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (supplied !== API_TOKEN) return res.status(401).json({ error: 'unauthorized' });
    next();
}

// Discord bot ready event
client.once('ready', () => {
    console.log(`✅ Bot logged in as ${client.user.tag}`);
    
    if (GUILD_IDS.length === 0) {
        console.log('📊 Monitoring all guilds the bot is in');
        client.guilds.cache.forEach(guild => {
            console.log(`   - ${guild.name} (${guild.id})`);
            updateVoiceData(guild.id);
        });
    } else {
        console.log(`📊 Monitoring ${GUILD_IDS.length} specified guild(s):`);
        GUILD_IDS.forEach(guildId => {
            const guild = client.guilds.cache.get(guildId);
            if (guild) {
                console.log(`   - ${guild.name} (${guild.id})`);
                updateVoiceData(guildId);
            } else {
                console.log(`   ⚠️  Guild ${guildId} not found (bot may not be in this server)`);
            }
        });
    }

    // Seed single-user status from whatever voice state Discord already knows.
    const seedIds = TRACKED_USER_IDS.length > 0 ? TRACKED_USER_IDS : [];
    if (TRACKED_USER_IDS.length > 0) {
        console.log(`🎯 Tracking status for user(s): ${TRACKED_USER_IDS.join(', ')}`);
    }
    for (const userId of seedIds) {
        let vs = null;
        for (const guild of client.guilds.cache.values()) {
            vs = guild.voiceStates.cache.get(userId) || null;
            if (vs) break;
        }
        botStates.set(userId, snapshotFromVoiceState(userId, vs));
        publish(userId);
    }
});

// Update voice data when someone joins/leaves/changes state
client.on('voiceStateUpdate', (oldState, newState) => {
    // Update the guild where the state changed
    const guildId = newState.guild.id || oldState.guild.id;
    updateVoiceData(guildId);

    // Feed the single-user tracker. newState has no channelId once the user
    // leaves voice entirely - treat that as "not in voice".
    const userId = newState.id;
    if (isTracked(userId)) {
        botStates.set(userId, snapshotFromVoiceState(userId, newState.channelId ? newState : null));
        publish(userId);
    }
});

// Function to get voice channel data for a specific guild
function updateVoiceData(guildId) {
    try {
        const guild = client.guilds.cache.get(guildId);
        
        if (!guild) {
            console.error(`❌ Guild ${guildId} not found!`);
            return;
        }

        const channels = [];

        // Get all voice channels
        guild.channels.cache.forEach(channel => {
            if (channel.type === 2) { // Voice channel type
                const members = [];

                // Get members in this channel
                channel.members.forEach(member => {
                    const voiceState = member.voice;
                    
                    members.push({
                        id: member.id,
                        name: member.user.username,
                        displayName: member.displayName,
                        avatar: member.user.displayAvatarURL(),
                        muted: voiceState.mute || voiceState.selfMute,
                        deafened: voiceState.deaf || voiceState.selfDeaf,
                        streaming: voiceState.streaming,
                        video: voiceState.selfVideo,
                        speaking: false
                    });
                });

                channels.push({
                    id: channel.id,
                    name: channel.name,
                    position: channel.position,
                    memberCount: members.length,
                    members: members
                });
            }
        });

        // Sort channels by position
        channels.sort((a, b) => a.position - b.position);

        guildsData.set(guildId, {
            id: guildId,
            name: guild.name,
            icon: guild.iconURL(),
            channels: channels,
            lastUpdate: new Date().toISOString(),
            memberCount: guild.memberCount
        });

        const totalMembers = channels.reduce((sum, ch) => sum + ch.memberCount, 0);
        console.log(`🔄 Updated ${guild.name} - ${channels.length} channels, ${totalMembers} in voice`);
    } catch (error) {
        console.error(`❌ Error updating voice data for guild ${guildId}:`, error);
    }
}

// Function to get list of guilds to monitor
function getMonitoredGuildIds() {
    if (GUILD_IDS.length > 0) {
        return GUILD_IDS;
    }
    // If no specific guilds specified, monitor all guilds the bot is in
    return Array.from(client.guilds.cache.keys());
}

// API Routes

// Get list of all available guilds
app.get('/api/guilds', (req, res) => {
    const guildIds = getMonitoredGuildIds();
    const guilds = guildIds.map(guildId => {
        const data = guildsData.get(guildId);
        const guild = client.guilds.cache.get(guildId);
        
        if (!data && guild) {
            // Guild exists but data not yet loaded
            return {
                id: guildId,
                name: guild.name,
                icon: guild.iconURL(),
                memberCount: guild.memberCount,
                channelCount: 0,
                voiceMemberCount: 0,
                lastUpdate: null
            };
        } else if (data) {
            return {
                id: data.id,
                name: data.name,
                icon: data.icon,
                memberCount: data.memberCount,
                channelCount: data.channels.length,
                voiceMemberCount: data.channels.reduce((sum, ch) => sum + ch.memberCount, 0),
                lastUpdate: data.lastUpdate
            };
        }
        return null;
    }).filter(g => g !== null);

    res.json({ guilds });
});

// Get all voice channel data for all guilds
app.get('/api/voice-channels', (req, res) => {
    const allGuildsData = [];
    
    getMonitoredGuildIds().forEach(guildId => {
        const data = guildsData.get(guildId);
        if (data) {
            allGuildsData.push(data);
        }
    });

    res.json({ guilds: allGuildsData });
});

// Get voice channel data for a specific guild
app.get('/api/voice-channels/:guildId', (req, res) => {
    const guildId = req.params.guildId;
    const data = guildsData.get(guildId);
    
    if (!data) {
        return res.status(404).json({ error: 'Guild not found or no data available' });
    }
    
    res.json(data);
});

// Get specific channel data
app.get('/api/voice-channels/:guildId/:channelId', (req, res) => {
    const { guildId, channelId } = req.params;
    const guildData = guildsData.get(guildId);
    
    if (!guildData) {
        return res.status(404).json({ error: 'Guild not found' });
    }
    
    const channel = guildData.channels.find(ch => ch.id === channelId);
    
    if (!channel) {
        return res.status(404).json({ error: 'Channel not found' });
    }
    
    res.json(channel);
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    const monitoredGuilds = getMonitoredGuildIds();
    const guildsWithData = monitoredGuilds.filter(id => guildsData.has(id)).length;
    
    res.json({
        status: 'ok',
        botConnected: client.isReady(),
        monitoringGuilds: monitoredGuilds.length,
        guildsWithData: guildsWithData,
        guilds: monitoredGuilds.map(id => {
            const guild = client.guilds.cache.get(id);
            return guild ? { id, name: guild.name } : { id, name: 'Unknown' };
        })
    });
});

// ---------------------------------------------------------------------------
// Single-user status API (hardware "on air" light)
// ---------------------------------------------------------------------------

// One-shot compact status for a user. Handy for polling / debugging.
app.get('/api/status/:userId', checkToken, (req, res) => {
    res.json(effectiveSnapshot(req.params.userId));
});

// Server-Sent Events stream: emits the current snapshot immediately, then a new
// snapshot every time the derived state changes. Clients (the Pi) just keep the
// connection open and reconnect on drop.
app.get('/api/stream/:userId', checkToken, (req, res) => {
    const { userId } = req.params;

    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write(`data: ${JSON.stringify(effectiveSnapshot(userId))}\n\n`);

    if (!subscribers.has(userId)) subscribers.set(userId, new Set());
    subscribers.get(userId).add(res);

    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
    req.on('close', () => {
        clearInterval(heartbeat);
        subscribers.get(userId)?.delete(res);
    });
});

// Ingest authoritative state from a local Discord RPC helper on the desktop.
// Body: { inVoice?, muted?, deafened?, streaming? }. This is the only way to
// know the mute toggle while NOT connected to a voice channel.
app.post('/api/ingest/:userId', checkToken, (req, res) => {
    const { userId } = req.params;
    const { inVoice, muted, deafened, streaming } = req.body || {};
    rpcStates.set(userId, {
        snap: makeSnapshot(userId, { inVoice, muted, deafened, streaming, source: 'rpc' }),
        receivedAt: Date.now(),
    });
    publish(userId);
    res.json({ ok: true });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📡 API available at http://localhost:${PORT}/api/guilds`);
});

// Login to Discord
client.login(DISCORD_BOT_TOKEN).catch(error => {
    console.error('❌ Failed to login to Discord:', error);
    process.exit(1);
});
