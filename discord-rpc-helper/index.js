// index.js — Discord RPC → discord-on-air backend bridge
//
// Runs on the same machine as the Discord *desktop* client. It reads your
// microphone mute / deafen toggle (which Discord knows even when you are NOT in
// a call) plus whether you are currently in a voice channel, and POSTs a
// compact status to the backend's /api/ingest/:userId endpoint.
//
// Requirements:
//   - Node 18+ (uses the global fetch)
//   - The Discord desktop app running and logged in
//   - A Discord application you own (Client ID + Secret). The account that
//     approves the RPC prompt must be the app owner or on the app's team /
//     tester list, otherwise Discord rejects the "rpc" scope.
//
// Only dependency: dotenv.

const net = require('net');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

require('dotenv').config();

const CLIENT_ID = requireEnv('DISCORD_CLIENT_ID');
const CLIENT_SECRET = requireEnv('DISCORD_CLIENT_SECRET');
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || 'http://localhost';
const BACKEND_URL = (process.env.BACKEND_URL || 'http://localhost:3000').replace(/\/$/, '');
// Direct mode: POST the raw flags to this exact URL (e.g. the pi-light listener)
// instead of the backend's /api/ingest/:userId route.
const INGEST_URL = process.env.INGEST_URL || '';
const API_TOKEN = process.env.API_TOKEN || '';
const SCOPES = (process.env.DISCORD_SCOPES || 'rpc').split(/[\s,]+/).filter(Boolean);
const TOKEN_FILE = path.join(__dirname, '.token.json');
const HEARTBEAT_MS = 10_000;

function requireEnv(name) {
    const v = process.env[name];
    if (!v) {
        console.error(`Missing ${name} — copy .env.example to .env and fill it in.`);
        process.exit(1);
    }
    return v;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// IPC transport
// ---------------------------------------------------------------------------
const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;

function ipcCandidatePaths() {
    if (process.platform === 'win32') {
        return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`);
    }
    const base =
        process.env.XDG_RUNTIME_DIR ||
        process.env.TMPDIR ||
        process.env.TMP ||
        process.env.TEMP ||
        '/tmp';
    // Flatpak / snap sandbox the socket into a subdirectory.
    const dirs = ['', 'app/com.discordapp.Discord/', 'snap.discord/'];
    const out = [];
    for (const d of dirs) {
        for (let i = 0; i < 10; i++) out.push(path.join(base, d, `discord-ipc-${i}`));
    }
    return out;
}

function connectIPC() {
    return new Promise((resolve, reject) => {
        const paths = ipcCandidatePaths();
        let i = 0;
        const tryNext = () => {
            if (i >= paths.length) {
                return reject(new Error('No Discord IPC socket found — is the desktop app running?'));
            }
            const sock = net.createConnection(paths[i++]);
            sock.once('connect', () => resolve(sock));
            sock.once('error', () => {
                sock.destroy();
                tryNext();
            });
        };
        tryNext();
    });
}

function encodeFrame(op, payload) {
    const body = Buffer.from(JSON.stringify(payload));
    const head = Buffer.alloc(8);
    head.writeInt32LE(op, 0);
    head.writeInt32LE(body.length, 4);
    return Buffer.concat([head, body]);
}

function attachFrameReader(sock, onFrame) {
    let buf = Buffer.alloc(0);
    sock.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 8) {
            const op = buf.readInt32LE(0);
            const len = buf.readInt32LE(4);
            if (buf.length < 8 + len) break;
            const json = buf.slice(8, 8 + len).toString();
            buf = buf.slice(8 + len);
            try {
                onFrame(op, JSON.parse(json));
            } catch (e) {
                console.error('bad frame:', e.message);
            }
        }
    });
}

// ---------------------------------------------------------------------------
// OAuth token handling
// ---------------------------------------------------------------------------
function loadToken() {
    try {
        return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    } catch {
        return null;
    }
}

function saveToken(tok) {
    tok.obtained_at = Date.now();
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tok, null, 2));
    return tok;
}

async function tokenRequest(extra) {
    const body = new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        ...extra,
    });
    const res = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });
    if (!res.ok) {
        throw new Error(`OAuth token request failed: ${res.status} ${await res.text()}`);
    }
    return saveToken(await res.json());
}

const exchangeCode = (code) =>
    tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI });
const refreshToken = (refresh_token) =>
    tokenRequest({ grant_type: 'refresh_token', refresh_token });

// ---------------------------------------------------------------------------
// State + backend push
// ---------------------------------------------------------------------------
const state = { inVoice: false, muted: false, deafened: false, streaming: false };
let userId = null;
let lastSent = '';

async function pushState(force = false) {
    if (!INGEST_URL && !userId) return;
    const key = JSON.stringify(state);
    if (!force && key === lastSent) return;
    lastSent = key;
    const base = INGEST_URL || `${BACKEND_URL}/api/ingest/${userId}`;
    const url = API_TOKEN
        ? `${base}${base.includes('?') ? '&' : '?'}token=${encodeURIComponent(API_TOKEN)}`
        : base;
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: key,
        });
        if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
        console.log('→ backend', state);
    } catch (e) {
        console.error('push failed:', e.message);
        lastSent = ''; // force a retry on the next change / heartbeat
    }
}

function applyVoiceSettings(d) {
    if (!d) return;
    state.muted = !!d.mute;
    state.deafened = !!d.deaf;
}

// ---------------------------------------------------------------------------
// One RPC session (resolves never; rejects when the socket drops)
// ---------------------------------------------------------------------------
function session() {
    return new Promise(async (resolve, reject) => {
        let sock;
        try {
            sock = await connectIPC();
        } catch (e) {
            return reject(e);
        }
        console.log('connected to Discord IPC');

        const timers = [];
        const cleanup = (err) => {
            timers.forEach(clearInterval);
            sock.destroy();
            reject(err);
        };
        sock.on('close', () => cleanup(new Error('IPC socket closed')));
        sock.on('error', (e) => cleanup(e));

        const pending = new Map();
        const send = (op, payload) => sock.write(encodeFrame(op, payload));

        const call = (cmd, args) =>
            new Promise((res, rej) => {
                const n = randomUUID();
                pending.set(n, { res, rej });
                send(OP_FRAME, { cmd, args, nonce: n });
            });
        const subscribe = (evt) =>
            new Promise((res, rej) => {
                const n = randomUUID();
                pending.set(n, { res, rej });
                send(OP_FRAME, { cmd: 'SUBSCRIBE', evt, nonce: n });
            });

        let onReady;
        const readyPromise = new Promise((r) => (onReady = r));

        attachFrameReader(sock, (op, data) => {
            if (op === OP_PING) return send(OP_PONG, data);
            if (op === OP_CLOSE) return cleanup(new Error(`IPC close: ${JSON.stringify(data)}`));
            if (op !== OP_FRAME) return;

            if (data.cmd === 'DISPATCH' && data.evt === 'READY') {
                userId = data.data?.user?.id || null;
                return onReady();
            }
            if (data.nonce && pending.has(data.nonce)) {
                const { res, rej } = pending.get(data.nonce);
                pending.delete(data.nonce);
                return data.evt === 'ERROR'
                    ? rej(new Error(JSON.stringify(data.data)))
                    : res(data.data);
            }
            if (data.cmd === 'DISPATCH') {
                if (data.evt === 'VOICE_SETTINGS_UPDATE') {
                    applyVoiceSettings(data.data);
                    pushState();
                } else if (data.evt === 'VOICE_CHANNEL_SELECT') {
                    state.inVoice = !!data.data?.channel_id;
                    pushState();
                }
            }
        });

        try {
            send(OP_HANDSHAKE, { v: 1, client_id: CLIENT_ID });
            await readyPromise;
            console.log('RPC ready for user', userId);

            await authenticate(call);

            applyVoiceSettings(await call('GET_VOICE_SETTINGS'));
            try {
                const ch = await call('GET_SELECTED_VOICE_CHANNEL');
                state.inVoice = !!(ch && ch.id);
            } catch {
                state.inVoice = false;
            }

            await subscribe('VOICE_SETTINGS_UPDATE');
            await subscribe('VOICE_CHANNEL_SELECT');

            await pushState(true);
            timers.push(setInterval(() => pushState(true), HEARTBEAT_MS));
            console.log('bridging — mute toggle is now reported even when not in a call');
        } catch (e) {
            cleanup(e);
        }
    });
}

async function authenticate(call) {
    let tok = loadToken();

    if (tok?.access_token) {
        try {
            await call('AUTHENTICATE', { access_token: tok.access_token });
            return;
        } catch {
            console.log('cached token rejected, trying refresh…');
        }
    }
    if (tok?.refresh_token) {
        try {
            tok = await refreshToken(tok.refresh_token);
            await call('AUTHENTICATE', { access_token: tok.access_token });
            return;
        } catch {
            console.log('refresh failed, requesting a fresh authorization…');
        }
    }

    console.log(`\n>>> Approve the "${SCOPES.join(' ')}" prompt in your Discord client <<<\n`);
    const { code } = await call('AUTHORIZE', { client_id: CLIENT_ID, scopes: SCOPES });
    tok = await exchangeCode(code);
    await call('AUTHENTICATE', { access_token: tok.access_token });
}

// On a clean exit, tell the light we're gone so it doesn't stay "muted"
// until the watchdog trips.
let shuttingDown = false;
async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('shutting down — clearing the light');
    state.inVoice = state.muted = state.deafened = state.streaming = false;
    try {
        await pushState(true);
    } catch {
        /* best effort */
    }
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

(async function main() {
    while (!shuttingDown) {
        try {
            await session();
        } catch (e) {
            console.error('session ended:', e.message);
        }
        lastSent = '';
        await sleep(3000);
    }
})();
