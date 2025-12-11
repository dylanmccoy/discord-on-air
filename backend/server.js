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

// Store for voice state data - one entry per guild
const guildsData = new Map();

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
});

// Update voice data when someone joins/leaves/changes state
client.on('voiceStateUpdate', (oldState, newState) => {
    // Update the guild where the state changed
    const guildId = newState.guild.id || oldState.guild.id;
    updateVoiceData(guildId);
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
