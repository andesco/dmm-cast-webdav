
import { serveStatic } from 'hono/cloudflare-workers';
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { serveAsset, getAssetsInDirectory } from './dynamic-assets.js';

const app = new Hono();

// --- Middleware ---

// Determine Auth Mode helper
function isSingleUserMode(env) {
    return !!(env.RD_ACCESS_TOKEN && env.WEBDAV_USERNAME && env.WEBDAV_PASSWORD);
}

// Credential Validator
function validateCredentials(username, password, env) {
    if (isSingleUserMode(env)) {
        // Single User Mode: Check against env vars
        if (username === env.WEBDAV_USERNAME && password === env.WEBDAV_PASSWORD) {
            return env.RD_ACCESS_TOKEN;
        }
    } else {
        // Multi User Mode: Username must be 'apitoken', password is the token
        if (username === 'apitoken') {
            return password;
        }
    }
    return null;
}

// Token Extractor - Checks Cookie then Basic Auth
async function extractToken(c) {
    // 1. Try Cookie (Browser Session)
    const cookieToken = getCookie(c, 'rd_token');
    if (cookieToken) return cookieToken;

    // 2. Try Basic Auth (WebDAV Clients)
    const auth = c.req.header('Authorization');
    if (auth && auth.startsWith('Basic ')) {
        try {
            const base64 = auth.split(' ')[1];
            const credentials = atob(base64);
            // Handle potential lack of colon
            const colonIndex = credentials.indexOf(':');
            if (colonIndex !== -1) {
                const user = credentials.substring(0, colonIndex);
                const pass = credentials.substring(colonIndex + 1);
                return validateCredentials(user, pass, c.env);
            }
        } catch (e) {
            console.error('Basic Auth decode error:', e);
        }
    }

    return null;
}


import { layout, loginPage, statusHeader, pageHeader, footer, formatBytes } from './html.js';

/**
 * Fetch casted links from Debrid Media Manager API
 * Returns all available items, sorted by most recent
 */
async function getCastedLinks(rdAccessToken) {
    try {
        const response = await fetch(`https://debridmediamanager.com/api/stremio/links?token=${rdAccessToken}`);
        if (!response.ok) {
            console.error('Failed to fetch casted links:', response.statusText);
            return [];
        }

        const data = await response.json();
        if (!data || !Array.isArray(data)) return [];

        // Sort by updatedAt (most recent first)
        const sortedData = data.sort((a, b) => {
            const timeA = new Date(a.updatedAt).getTime();
            const timeB = new Date(b.updatedAt).getTime();
            return timeB - timeA;
        });

        // Format for display
        return sortedData.map(link => {
            // Extract filename from URL path if not provided
            let filename = link.filename;
            if (!filename || filename === 'Unknown') {
                try {
                    const urlPath = new URL(link.url).pathname;
                    filename = decodeURIComponent(urlPath.split('/').pop()) || 'Unknown';
                } catch (e) {
                    filename = 'Unknown';
                }
            }

            return {
                url: link.url || '#',
                filename: filename,
                strmFilename: `${filename}{hash-${link.hash}}{imdb-${link.imdbId}}.strm`,
                sizeGB: link.size ? (Math.round(link.size / 1024 * 10) / 10).toFixed(1) : '0.0', // Convert MB to GB, 1 decimal
                updatedAt: link.updatedAt,
                imdbId: link.imdbId,  // For deletion support
                hash: link.hash,       // For deletion support
            };
        });
    } catch (error) {
        console.error('Error fetching casted links:', error.message);
        return [];
    }
}


// --- Routes ---

// Local Login Route (Form Submission)
app.post('/login', async (c) => {
    try {
        const body = await c.req.parseBody();
        const username = body.username;
        const password = body.password;

        const token = validateCredentials(username, password, c.env);

        if (token) {
            // Success: Set cookie
            const d = new Date();
            d.setTime(d.getTime() + (30 * 24 * 60 * 60 * 1000)); // 30 days
            setCookie(c, 'rd_token', token, {
                expires: d,
                path: '/',
                secure: true,
                sameSite: 'Strict',
                httpOnly: false // Accessible to JS for logout if needed, though strictly not necessary for the worker
            });
            return c.redirect('/');
        } else {
            return c.html(layout('Login Failed', '<h1>Login Failed</h1><p>Invalid credentials.</p><a href="/">Try Again</a>'));
        }
    } catch (e) {
        return c.text('Bad Request', 400);
    }
});

// Logout Route
app.get('/logout', (c) => {
    setCookie(c, 'rd_token', '', {
        expires: new Date(0), // Expire immediately
        path: '/',
        secure: true,
        sameSite: 'Strict'
    });
    return c.redirect('/');
});

// Root route - Browser View or Login Page
app.get('/', async (c) => {
    const token = getCookie(c, 'rd_token');
    const hostname = new URL(c.req.url).origin;
    const singleUser = isSingleUserMode(c.env);

    if (!token) {
        // If no token (cookie or basic auth), show sign in page
        return c.html(layout('Sign In', loginPage(hostname, singleUser, c.env.WEBDAV_USERNAME)));
    }

    // Get casted links from DMM API
    const castedLinks = await getCastedLinks(token);

    // If token is invalid (links fail to fetch), browserView will show empty or we could handle it
    const content = browserView(castedLinks, hostname, singleUser);
    return c.html(layout('', content));
});

app.get('/health', (c) => {
    return c.json({
        status: 'ok',
        uptime: 0,
        timestamp: new Date().toISOString(),
    });
});

/**
 * Get DMM casted links as WebDAV files
 * Returns .strm files for DMM Cast only
 */
async function getDMMCastWebDAVFiles(rdAccessToken) {
    try {
        const castedLinks = await getCastedLinks(rdAccessToken);

        // Deduplicate by filename, keeping most recent
        const filesMap = new Map();
        for (const link of castedLinks) {
            const strmUrl = link.url;
            const filename = link.strmFilename;
            const modified = new Date(link.updatedAt).getTime();

            const fileObj = {
                name: filename,
                content: strmUrl,
                size: strmUrl.length,
                modified: link.updatedAt,
                modifiedTimestamp: modified,
                contentType: 'text/plain; charset=utf-8',
                originalFilename: link.filename,
                filesize: link.sizeGB * 1024 * 1024 * 1024,
                downloadUrl: link.url,
                imdbId: link.imdbId,
                hash: link.hash,
            };

            const existing = filesMap.get(filename);
            if (existing) {
                if (modified > existing.modifiedTimestamp) {
                    filesMap.set(filename, fileObj);
                }
            } else {
                filesMap.set(filename, fileObj);
            }
        }

        return Array.from(filesMap.values()).map(({ modifiedTimestamp, ...cleanFile }) => cleanFile);
    } catch (error) {
        console.error('Error in getDMMCastWebDAVFiles:', error.message);
        return [];
    }
}

// PROPFIND / - WebDAV root
app.on(['PROPFIND'], '/', async (c) => {
    const token = await extractToken(c);
    if (!token) {
        return new Response('Unauthorized', {
            status: 401,
            headers: { 'WWW-Authenticate': 'Basic realm="DMM Cast WebDAV", charset="UTF-8"' }
        });
    }

    const files = await getDMMCastWebDAVFiles(token);
    const depth = c.req.header('Depth') || '0';
    const requestUrl = new URL(c.req.url);
    const requestPath = requestUrl.pathname;

    const publicFiles = await getAssetsInDirectory('', c.env);
    const pngFiles = publicFiles.filter(file => file.name.endsWith('.png'));

    const allFiles = [...files, ...pngFiles];

    const responses = allFiles.map(file => `
      <D:response>
        <D:href>${requestPath}${encodeURIComponent(file.name)}</D:href>
        <D:propstat>
          <D:prop>
            <D:displayname>${file.name}</D:displayname>
            <D:resourcetype/>
            <D:getcontentlength>${file.size}</D:getcontentlength>
            <D:getlastmodified>${new Date(file.modified).toUTCString()}</D:getlastmodified>
            <D:getcontenttype>${file.contentType}</D:getcontenttype>
          </D:prop>
          <D:status>HTTP/1.1 200 OK</D:status>
        </D:propstat>
      </D:response>`).join('');

    const collectionResponse = `
      <D:response>
        <D:href>${requestPath}</D:href>
        <D:propstat>
          <D:prop>
            <D:resourcetype><D:collection/></D:resourcetype>
            <D:getlastmodified>${new Date().toUTCString()}</D:getlastmodified>
          </D:prop>
          <D:status>HTTP/1.1 200 OK</D:status>
        </D:propstat>
      </D:response>`;

    const xml = `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">${depth !== '0' ? responses : ''}${collectionResponse}</D:multistatus>`;

    return new Response(xml, { status: 207, headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
});

// --- Static File Serving ---
app.get('/style.css', async (c) => {
    const response = await serveAsset('style.css', c.env);
    return response || c.text('File not found: style.css', 404);
});

app.get('/public/*', async (c) => {
    const path = c.req.path.replace('/public/', '');
    const response = await serveAsset(path, c.env);
    return response || c.text(`File not found: ${path}`, 404);
});

// GET /:filename - Serve .strm files or PNG files
app.get('/:filename', async (c) => {
    const { filename } = c.req.param();

    if (filename.endsWith('.png')) {
        const response = await serveAsset(filename, c.env);
        if (response) return response;
    }

    if (filename.endsWith('.strm')) {
        const token = await extractToken(c);
        if (!token) {
            return new Response('Unauthorized', {
                status: 401,
                headers: { 'WWW-Authenticate': 'Basic realm="DMM Cast WebDAV", charset="UTF-8"' }
            });
        }

        const files = await getDMMCastWebDAVFiles(token);
        const file = files.find(f => f.name === filename);

        if (!file) return c.text('File not found', 404);
        return c.text(file.content, 200, { 'Content-Type': 'text/plain; charset=utf-8' });
    }

    return c.text('File not found', 404);
});

// DELETE /* - Delete DMM Cast entry via WebDAV
app.on(['DELETE'], '/*', async (c) => {
    const fullPath = new URL(c.req.url).pathname;
    const filename = decodeURIComponent(fullPath.replace('/', ''));

    const token = await extractToken(c);
    if (!token) return c.text('Unauthorized', 401);

    try {
        const match = filename.match(/\{hash-([^}]+)\}\{imdb-([^}]+)\}\.strm$/);
        if (!match) return c.text('Invalid filename format', 400);

        const [, hash, imdbId] = match;
        const response = await fetch('https://debridmediamanager.com/api/stremio/deletelink', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, imdbId, hash }),
        });

        if (!response.ok) return c.text('Delete failed', response.status);
        return new Response(null, { status: 204 });
    } catch (error) {
        return c.text(`Delete failed: ${error.message}`, 500);
    }
});

export default app;
