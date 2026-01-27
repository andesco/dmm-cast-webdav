
import { serveStatic } from 'hono/cloudflare-workers';
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { serveAsset, getAssetsInDirectory } from './dynamic-assets.js';

const app = new Hono();

// --- Provider Configuration ---

const PROVIDERS = {
    rd: {
        name: 'Real-Debrid',
        apiPath: 'stremio',
        deletePath: 'stremio',
        managePage: 'https://debridmediamanager.com/stremio/manage',
        tokenPage: 'https://real-debrid.com/apitoken',
        cookieName: 'rd_token',
        envTokenKey: 'RD_API_TOKEN',
        username: 'real-debrid',
        legacyUsernames: ['apitoken'],
        basePath: '/',
    },
    torbox: {
        name: 'TorBox',
        apiPath: 'stremio-tb',
        apiPaths: ['stremio-tb'],
        deletePath: 'stremio-tb',
        managePage: 'https://debridmediamanager.com/stremio-torbox/manage',
        tokenPage: 'https://torbox.app/settings?section=account',
        cookieName: 'torbox_token',
        envTokenKey: 'TORBOX_API_KEY',
        tokenQueryKeys: ['apiKey', 'apikey', 'api_key', 'token'],
        username: 'torbox',
        basePath: '/torbox/',
    },
};

// --- Middleware ---

// Determine Auth Mode helper
function isSingleUserMode(env, provider) {
    return !!(env[provider.envTokenKey] && env.WEBDAV_USERNAME && env.WEBDAV_PASSWORD);
}

// Credential Validator
function validateCredentials(username, password, env, provider) {
    if (isSingleUserMode(env, provider)) {
        // Single User Mode: Check against env vars
        if (username === env.WEBDAV_USERNAME && password === env.WEBDAV_PASSWORD) {
            return env[provider.envTokenKey];
        }
    } else {
        // Multi User Mode: Username must match provider username (or legacy aliases), password is the token
        const validUsernames = [provider.username, ...(provider.legacyUsernames || [])];
        if (validUsernames.includes(username)) {
            return password;
        }
    }
    return null;
}

// Token Extractor - Checks Cookie then Basic Auth
async function extractToken(c, provider) {
    // 1. Try Cookie (Browser Session)
    const cookieToken = getCookie(c, provider.cookieName);
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
                return validateCredentials(user, pass, c.env, provider);
            }
        } catch (e) {
            console.error('Basic Auth decode error:', e);
        }
    }

    return null;
}


import { layout, loginPage, browserView, statusHeader, pageHeader, footer, formatBytes } from './html.js';

function parseCsv(value) {
    if (!value) return [];
    return value.split(',').map(item => item.trim()).filter(Boolean);
}

function getApiPaths(provider, env) {
    if (provider.name === 'TorBox') {
        const envPaths = parseCsv(env.TORBOX_API_PATHS);
        if (envPaths.length > 0) return envPaths;
    }
    if (Array.isArray(provider.apiPaths) && provider.apiPaths.length > 0) return provider.apiPaths;
    return [provider.apiPath];
}

function getTokenQueryKeys(provider, env) {
    if (provider.name === 'TorBox') {
        const envKeys = parseCsv(env.TORBOX_TOKEN_QUERY_KEYS);
        if (envKeys.length > 0) return envKeys;
    }
    if (Array.isArray(provider.tokenQueryKeys) && provider.tokenQueryKeys.length > 0) return provider.tokenQueryKeys;
    return ['token'];
}

function normalizeLinksPayload(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.links)) return data.links;
    if (data && Array.isArray(data.items)) return data.items;
    if (data && data.data && Array.isArray(data.data)) return data.data;
    return null;
}

const TORBOX_CACHE_TTL_MS = 5 * 60 * 1000;
const torboxCache = {
    torrentIds: new Map(),
    torrentFiles: new Map(),
    directLinks: new Map(),
};

function getCachedValue(entry) {
    if (!entry) return null;
    if (entry.expiresAt && Date.now() < entry.expiresAt) return entry.value;
    return null;
}

function setCachedValue(value, ttlMs) {
    return { value, expiresAt: Date.now() + ttlMs };
}

function isAbsoluteUrl(value) {
    return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function buildTorBoxMagnet(hash, filename) {
    const name = filename || hash;
    return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(name)}`;
}

async function getTorBoxTorrentId(apiKey, hash, filename) {
    const cacheKey = `${apiKey}:${hash}`;
    const cached = getCachedValue(torboxCache.torrentIds.get(cacheKey));
    if (cached) return cached;

    const form = new FormData();
    form.append('magnet', buildTorBoxMagnet(hash, filename));
    form.append('add_only_if_cached', 'true');

    const response = await fetch('https://api.torbox.app/v1/api/torrents/createtorrent', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
        body: form,
    });

    const data = await response.json();
    if (!data || data.success !== true || !data.data || typeof data.data.torrent_id !== 'number') {
        throw new Error(data?.detail || 'TorBox create torrent failed');
    }

    torboxCache.torrentIds.set(cacheKey, setCachedValue(data.data.torrent_id, TORBOX_CACHE_TTL_MS));
    return data.data.torrent_id;
}

async function getTorBoxTorrentFiles(apiKey, torrentId) {
    const cacheKey = `${apiKey}:${torrentId}`;
    const cached = getCachedValue(torboxCache.torrentFiles.get(cacheKey));
    if (cached) return cached;

    const response = await fetch(`https://api.torbox.app/v1/api/torrents/mylist?id=${torrentId}`, {
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
    });

    const data = await response.json();
    const files = Array.isArray(data?.data?.files) ? data.data.files : [];
    torboxCache.torrentFiles.set(cacheKey, setCachedValue(files, TORBOX_CACHE_TTL_MS));
    return files;
}

function selectTorBoxFileId(files, filename) {
    if (!Array.isArray(files) || files.length === 0) return 0;
    if (!filename) return files[0].id ?? 0;

    const match = files.find(file => file.name === filename || file.short_name === filename);
    if (match && typeof match.id === 'number') return match.id;

    const endsWith = files.find(file => filename.endsWith(`/${file.short_name}`));
    if (endsWith && typeof endsWith.id === 'number') return endsWith.id;

    return files[0].id ?? 0;
}

async function resolveTorBoxDownloadUrl(apiKey, hash, filename) {
    const torrentId = await getTorBoxTorrentId(apiKey, hash, filename);
    const files = await getTorBoxTorrentFiles(apiKey, torrentId);
    const fileId = selectTorBoxFileId(files, filename);

    const cacheKey = `${apiKey}:${torrentId}:${fileId}`;
    const cached = getCachedValue(torboxCache.directLinks.get(cacheKey));
    if (cached) return cached;

    const directUrl = new URL('https://api.torbox.app/v1/api/torrents/requestdl');
    directUrl.searchParams.set('token', apiKey);
    directUrl.searchParams.set('torrent_id', torrentId.toString());
    directUrl.searchParams.set('file_id', fileId.toString());
    directUrl.searchParams.set('redirect', 'false');

    const response = await fetch(directUrl.toString());
    const data = await response.json();
    if (!data || data.success !== true || !data.data) {
        throw new Error(data?.detail || 'TorBox requestdl failed');
    }

    torboxCache.directLinks.set(cacheKey, setCachedValue(data.data, TORBOX_CACHE_TTL_MS));
    return data.data;
}

/**
 * Fetch casted links from Debrid Media Manager API
 * Returns all available items, sorted by most recent
 */
async function getCastedLinks(token, provider, env) {
    try {
        if (provider.name === 'TorBox') {
            const linksUrl = new URL('https://debridmediamanager.com/api/stremio-tb/links');
            linksUrl.searchParams.set('apiKey', token);

            const response = await fetch(linksUrl.toString());
            if (!response.ok) {
                console.error('Failed to fetch casted links:', response.statusText);
                return [];
            }

            const parsed = await response.json();
            const data = normalizeLinksPayload(parsed) || [];
            const mapped = [];
            for (const link of data) {
                const fallbackFilename = link.url ? link.url.split('/').pop() : 'Unknown';
                const filename = fallbackFilename || 'Unknown';
                let downloadUrl = '#';
                try {
                    downloadUrl = await resolveTorBoxDownloadUrl(token, link.hash, link.url || filename);
                } catch (error) {
                    console.error('Failed to resolve TorBox direct link:', error.message);
                }

                mapped.push({
                    url: downloadUrl,
                    filename,
                    strmFilename: `${filename}{hash-${link.hash}}{imdb-${link.imdbId}}.strm`,
                    sizeGB: link.size ? (Math.round(link.size / 1024 * 10) / 10).toFixed(1) : '0.0',
                    updatedAt: link.updatedAt,
                    imdbId: link.imdbId,
                    hash: link.hash,
                });
            }

            const sortedData = mapped.sort((a, b) => {
                const timeA = new Date(a.updatedAt).getTime();
                const timeB = new Date(b.updatedAt).getTime();
                return timeB - timeA;
            });

            return sortedData;
        }

        const apiPaths = getApiPaths(provider, env || {});
        const tokenQueryKeys = getTokenQueryKeys(provider, env || {});
        const errors = [];
        let data = null;

        for (const apiPath of apiPaths) {
            for (const tokenKey of tokenQueryKeys) {
                const url = new URL(`https://debridmediamanager.com/api/${apiPath}/links`);
                url.searchParams.set(tokenKey, token);

                let response;
                try {
                    response = await fetch(url.toString());
                } catch (error) {
                    errors.push(`${apiPath} (${tokenKey}): ${error.message}`);
                    continue;
                }

                if (!response.ok) {
                    errors.push(`${apiPath} (${tokenKey}): ${response.status}`);
                    continue;
                }

                let parsed;
                try {
                    parsed = await response.json();
                } catch (error) {
                    errors.push(`${apiPath} (${tokenKey}): invalid json`);
                    continue;
                }

                const links = normalizeLinksPayload(parsed);
                if (!links) {
                    errors.push(`${apiPath} (${tokenKey}): unexpected payload`);
                    continue;
                }

                data = links;
                break;
            }
            if (data) break;
        }

        if (!data) {
            console.error('Failed to fetch casted links:', errors.join(' | '));
            return [];
        }

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


// --- Shared Handler Functions ---

async function handleLogin(c, provider) {
    try {
        const body = await c.req.parseBody();
        const username = body.username;
        const password = body.password;

        const token = validateCredentials(username, password, c.env, provider);

        if (token) {
            // Success: Set cookie
            const d = new Date();
            d.setTime(d.getTime() + (30 * 24 * 60 * 60 * 1000)); // 30 days
            const isSecure = new URL(c.req.url).protocol === 'https:';
            setCookie(c, provider.cookieName, token, {
                expires: d,
                path: '/',
                secure: isSecure,
                sameSite: 'Strict',
                httpOnly: false
            });
            return c.redirect(provider.basePath);
        } else {
            return c.html(layout('Login Failed', `<h2>Login Failed</h2><p>Invalid credentials.</p><a href="${provider.basePath}">Try Again</a>`));
        }
    } catch (e) {
        return c.text('Bad Request', 400);
    }
}

function handleLogout(c, provider) {
    const isSecure = new URL(c.req.url).protocol === 'https:';
    setCookie(c, provider.cookieName, '', {
        expires: new Date(0),
        path: '/',
        secure: isSecure,
        sameSite: 'Strict'
    });
    return c.redirect(provider.basePath);
}

async function handleBrowserView(c, provider) {
    const token = getCookie(c, provider.cookieName);
    const hostname = new URL(c.req.url).origin;
    const singleUser = isSingleUserMode(c.env, provider);

    if (!token) {
        return c.html(layout('Sign In', loginPage(hostname, singleUser, provider)));
    }

    const castedLinks = await getCastedLinks(token, provider, c.env);
    const content = browserView(castedLinks, hostname, singleUser, provider);
    return c.html(layout('', content));
}

/**
 * Get DMM casted links as WebDAV files
 * Returns .strm files for DMM Cast only
 */
async function getDMMCastWebDAVFiles(token, provider, env) {
    try {
        const castedLinks = await getCastedLinks(token, provider, env);

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

async function handlePropfind(c, provider) {
    const token = await extractToken(c, provider);
    if (!token) {
        return new Response('Unauthorized', {
            status: 401,
            headers: { 'WWW-Authenticate': `Basic realm="DMM Cast WebDAV for ${provider.name}", charset="UTF-8"` }
        });
    }

    const files = await getDMMCastWebDAVFiles(token, provider, c.env);
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
}

async function handleGetFile(c, provider) {
    const { filename: rawFilename } = c.req.param();
    let filename = rawFilename;
    try {
        filename = decodeURIComponent(rawFilename);
    } catch {
        filename = rawFilename;
    }

    if (filename.endsWith('.png')) {
        const response = await serveAsset(filename, c.env);
        if (response) return response;
    }

    if (filename.endsWith('.strm')) {
        const token = await extractToken(c, provider);
        if (!token) {
            return new Response('Unauthorized', {
                status: 401,
                headers: { 'WWW-Authenticate': `Basic realm="DMM Cast WebDAV for ${provider.name}", charset="UTF-8"` }
            });
        }

        const files = await getDMMCastWebDAVFiles(token, provider, c.env);
        const file = files.find(f => f.name === filename || f.name === rawFilename);

        if (!file) return c.text('File not found', 404);
        if (provider.name === 'TorBox' && !isAbsoluteUrl(file.content)) {
            try {
                const resolvedUrl = await resolveTorBoxDownloadUrl(token, file.hash, file.originalFilename || file.name);
                if (!resolvedUrl) return c.text('Stream not available', 502);
                return c.text(resolvedUrl, 200, { 'Content-Type': 'text/plain; charset=utf-8' });
            } catch (error) {
                return c.text(`Stream resolution failed: ${error.message}`, 502);
            }
        }

        return c.text(file.content, 200, { 'Content-Type': 'text/plain; charset=utf-8' });
    }

    return c.text('File not found', 404);
}

async function handleDelete(c, provider) {
    const fullPath = new URL(c.req.url).pathname;
    const filename = decodeURIComponent(fullPath.replace(provider.basePath, ''));

    const token = await extractToken(c, provider);
    if (!token) return c.text('Unauthorized', 401);

    try {
        const match = filename.match(/\{hash-([^}]+)\}\{imdb-([^}]+)\}\.strm$/);
        if (!match) return c.text('Invalid filename format', 400);

        const [, hash, imdbId] = match;
        const isTorBox = provider.name === 'TorBox';
        const payload = isTorBox
            ? { apiKey: token, imdbId, hash }
            : { token, imdbId, hash };
        const response = await fetch(`https://debridmediamanager.com/api/${provider.deletePath}/deletelink`, {
            method: isTorBox ? 'DELETE' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!response.ok) return c.text('Delete failed', response.status);
        return new Response(null, { status: 204 });
    } catch (error) {
        return c.text(`Delete failed: ${error.message}`, 500);
    }
}


// --- Real-Debrid Routes (root /) ---

app.post('/login', (c) => handleLogin(c, PROVIDERS.rd));
app.get('/logout', (c) => handleLogout(c, PROVIDERS.rd));
app.get('/', (c) => handleBrowserView(c, PROVIDERS.rd));

app.get('/health', (c) => {
    return c.json({
        status: 'ok',
        uptime: 0,
        timestamp: new Date().toISOString(),
    });
});

app.on(['PROPFIND'], '/', (c) => handlePropfind(c, PROVIDERS.rd));

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

// --- TorBox Routes (/torbox/) ---
// Registered before RD catch-all routes to prevent /:filename and /* from intercepting /torbox/* paths

app.all('/torbox', (c) => c.redirect('/torbox/', 301));

app.post('/torbox/login', (c) => handleLogin(c, PROVIDERS.torbox));
app.get('/torbox/logout', (c) => handleLogout(c, PROVIDERS.torbox));
app.get('/torbox/', (c) => handleBrowserView(c, PROVIDERS.torbox));
app.on(['PROPFIND'], '/torbox/', (c) => handlePropfind(c, PROVIDERS.torbox));
app.get('/torbox/:filename', (c) => handleGetFile(c, PROVIDERS.torbox));
app.on(['DELETE'], '/torbox/*', (c) => handleDelete(c, PROVIDERS.torbox));

// --- RD Catch-all Routes (must come after /torbox/ routes) ---

app.get('/:filename', (c) => handleGetFile(c, PROVIDERS.rd));
app.on(['DELETE'], '/*', (c) => handleDelete(c, PROVIDERS.rd));

export default app;
