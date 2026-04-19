/**
 * Wall of Fame proxy: shared team key (header) + GitHub App installation token (server-only).
 * Deploy with env vars; never commit keys. See README.md.
 */
'use strict';

const http = require('http');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const PORT = Number(process.env.PORT) || 8787;
const TEAM_KEY = process.env.WOF_TEAM_KEY || '';
const APP_ID = process.env.GITHUB_APP_ID || '';
const INSTALLATION_ID = process.env.GITHUB_APP_INSTALLATION_ID || '';
const PRIVATE_KEY = (process.env.GITHUB_APP_PRIVATE_KEY || '').replace(/\\n/g, '\n');

const OWNER = process.env.WOF_GITHUB_OWNER || 'MikeBane57';
const REPO = process.env.WOF_GITHUB_REPO || 'Wolf2.0';
const BRANCH = process.env.WOF_GITHUB_BRANCH || 'main';
const FILE_PATH = process.env.WOF_FILE_PATH || 'WALL of FAME/wall-of-fame.json';

const API = 'https://api.github.com';

let cachedToken = { token: '', expiresAt: 0 };

function timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
        return false;
    }
    try {
        return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
    } catch (e) {
        return false;
    }
}

function getTeamKeyFromRequest(req) {
    return (req.headers['x-wall-of-fame-key'] || req.headers['X-Wall-Of-Fame-Key'] || '').trim();
}

function assertTeamKey(req, res) {
    if (!TEAM_KEY) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Server missing WOF_TEAM_KEY' }));
        return false;
    }
    const key = getTeamKeyFromRequest(req);
    if (!timingSafeEqual(key, TEAM_KEY)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid or missing X-Wall-Of-Fame-Key' }));
        return false;
    }
    return true;
}

function createAppJwt() {
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign(
        { iss: APP_ID, iat: now - 60, exp: now + 600 },
        PRIVATE_KEY,
        { algorithm: 'RS256' }
    );
}

async function getInstallationToken() {
    const now = Date.now();
    if (cachedToken.token && cachedToken.expiresAt > now + 60_000) {
        return cachedToken.token;
    }
    const appJwt = createAppJwt();
    const url = `${API}/app/installations/${INSTALLATION_ID}/access_tokens`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${appJwt}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'wall-of-fame-proxy'
        }
    });
    if (!res.ok) {
        const t = await res.text();
        throw new Error(`installation token ${res.status}: ${t}`);
    }
    const data = await res.json();
    const exp = data.expires_at ? Date.parse(data.expires_at) : now + 3600_000;
    cachedToken = { token: data.token, expiresAt: exp };
    return data.token;
}

function contentsUrl() {
    const path = FILE_PATH.replace(/^\/+/, '')
        .split('/')
        .map(encodeURIComponent)
        .join('/');
    return `${API}/repos/${encodeURIComponent(OWNER)}/${encodeURIComponent(REPO)}/contents/${path}`;
}

async function githubGetFile(token) {
    const url = `${contentsUrl()}?ref=${encodeURIComponent(BRANCH)}`;
    const res = await fetch(url, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'wall-of-fame-proxy'
        }
    });
    if (res.status === 404) {
        return { sha: null, text: null };
    }
    if (!res.ok) {
        const t = await res.text();
        throw new Error(`GET file ${res.status}: ${t}`);
    }
    const meta = await res.json();
    const raw = meta.content ? Buffer.from(meta.content.replace(/\s/g, ''), 'base64').toString('utf8') : '';
    return { sha: meta.sha || null, text: raw };
}

function utf8ToBase64(str) {
    return Buffer.from(str, 'utf8').toString('base64');
}

async function githubPutFile(token, sha, bodyObj) {
    const payload = {
        message: 'Wall of Fame sync (GitHub App proxy)',
        content: utf8ToBase64(JSON.stringify(bodyObj, null, 2)),
        branch: BRANCH
    };
    if (sha) {
        payload.sha = sha;
    }
    const res = await fetch(contentsUrl(), {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
            'User-Agent': 'wall-of-fame-proxy'
        },
        body: JSON.stringify(payload)
    });
    const text = await res.text();
    if (res.status === 409) {
        return { conflict: true, status: res.status, text };
    }
    if (!res.ok) {
        throw new Error(`PUT file ${res.status}: ${text}`);
    }
    return { conflict: false, status: res.status, text };
}

function readBody(req) {
    return new Promise(function(resolve, reject) {
        var chunks = [];
        req.on('data', function(c) {
            chunks.push(c);
        });
        req.on('end', function() {
            resolve(Buffer.concat(chunks).toString('utf8'));
        });
        req.on('error', reject);
    });
}

const server = http.createServer(async function(req, res) {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    if (url.pathname !== '/wall-of-fame') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
    }

    if (!APP_ID || !INSTALLATION_ID || !PRIVATE_KEY) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Server missing GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, or GITHUB_APP_PRIVATE_KEY' }));
        return;
    }

    if (req.method === 'GET') {
        if (!assertTeamKey(req, res)) {
            return;
        }
        try {
            const token = await getInstallationToken();
            const { text } = await githubGetFile(token);
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store'
            });
            if (!text) {
                res.end(JSON.stringify({ entries: [], updatedAt: 0 }));
                return;
            }
            res.end(text);
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: String(e.message || e) }));
        }
        return;
    }

    if (req.method === 'PUT') {
        if (!assertTeamKey(req, res)) {
            return;
        }
        let bodyRaw;
        try {
            bodyRaw = await readBody(req);
        } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Bad body' }));
            return;
        }
        let doc;
        try {
            doc = JSON.parse(bodyRaw);
        } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
            return;
        }
        if (!doc || typeof doc !== 'object' || !Array.isArray(doc.entries)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Body must be { entries: [], updatedAt?: number }' }));
            return;
        }
        doc.updatedAt = Number(doc.updatedAt) || Date.now();

        try {
            const token = await getInstallationToken();
            let { sha } = await githubGetFile(token);
            let put = await githubPutFile(token, sha, doc);
            if (put.conflict) {
                const token2 = await getInstallationToken();
                const again = await githubGetFile(token2);
                put = await githubPutFile(token2, again.sha, doc);
                if (put.conflict) {
                    res.writeHead(409, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Conflict after retry' }));
                    return;
                }
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: String(e.message || e) }));
        }
        return;
    }

    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
});

server.listen(PORT, function() {
    console.log(`wall-of-fame-proxy listening on :${PORT}`);
});
