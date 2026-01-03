
import { serveStatic } from 'hono/cloudflare-workers';
import { Hono } from 'hono';
import { serveAsset, getAssetsInDirectory } from './dynamic-assets.js';
import { layout, statusHeader, pageHeader, footer, loginPage, formatBytes } from './html.js';

const app = new Hono();

// --- Middleware ---

// Public paths that don't need a token
const publicPaths = ['/health', '/style.css', '/public/'];

app.use('*', async (c, next) => {
    const path = c.req.path;
    if (path === '/' || publicPaths.some(p => path === p || path.startsWith(p))) {
        return next();
    }
    await next();
});

/**
 * Fetch casted links from Debrid Media Manager API
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

        return sortedData.map(link => {
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
                sizeGB: link.size ? (Math.round(link.size / 1024 * 10) / 10).toFixed(1) : '0.0',
                updatedAt: link.updatedAt,
                imdbId: link.imdbId,
                hash: link.hash,
            };
        });
    } catch (error) {
        console.error('Error fetching casted links:', error.message);
        return [];
    }
}

/**
 * Get DMM casted links as WebDAV files
 */
async function getDMMCastWebDAVFiles(rdAccessToken) {
    try {
        const castedLinks = await getCastedLinks(rdAccessToken);
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

// --- Routes ---

// Root route - Landing page for token setup
app.get('/', (c) => {
    const hostname = new URL(c.req.url).origin;
    return c.html(layout('', loginPage(hostname)));
});

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Static assets
app.get('/style.css', async (c) => (await serveAsset('style.css', c.env)) || c.text('Not found', 404));
app.get('/public/*', async (c) => {
    const path = c.req.path.replace('/public/', '');
    return (await serveAsset(path, c.env)) || c.text('Not found', 404);
});

// WebDAV Browser View - GET /:token/
app.get('/:token/', async (c) => {
    const { token } = c.req.param();
    const hostname = new URL(c.req.url).origin;
    const castedLinks = await getCastedLinks(token);

    if (castedLinks.length === 0) {
        return c.html(layout('', `
            ${statusHeader('No links found', null, 'DMM Cast WebDAV', 'Check if your token is correct or if you have any casted links.')}
            <div class="button-wrapper"><a href="/" role="button">Back to Setup</a></div>
            ${footer()}
        `));
    }

    const content = `
        ${statusHeader()}
        <div class="status-info">
            <p><small>WebDAV: <code>${hostname}/${token}/</code></small></p>
            <ul>
                ${castedLinks.map(link => `
                <li>
                    ${link.filename}
                    <small class="nowrap">
                        <a href="${link.url}" target="_blank"><code>${link.sizeGB} GB</code></a>
                        &nbsp;<a href="/${token}/${encodeURIComponent(link.strmFilename).replace(/%7B/g, '{').replace(/%7D/g, '}')}"><code>1 KB .strm</code></a>
                    </small>
                </li>
                `).join('')}
            </ul>
        </div>
        <div class="button-wrapper">
            <a href="https://debridmediamanager.com/stremio/manage" target="_blank" role="button">Manage Casted Links</a>
        </div>
        ${footer()}
    `;
    return c.html(layout('', content));
});

// WebDAV PROPFIND /:token/
app.on(['PROPFIND'], '/:token/', async (c) => {
    const { token } = c.req.param();
    const files = await getDMMCastWebDAVFiles(token);
    const depth = c.req.header('Depth') || '0';
    const requestPath = `/${token}/`;

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

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
${depth !== '0' ? responses : ''}
<D:response>
    <D:href>${requestPath}</D:href>
    <D:propstat>
        <D:prop>
            <D:resourcetype><D:collection/></D:resourcetype>
            <D:getlastmodified>${new Date().toUTCString()}</D:getlastmodified>
        </D:prop>
        <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
</D:response>
</D:multistatus>`;

    return new Response(xml, { status: 207, headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
});

// GET /:token/:filename - Serve files
app.get('/:token/:filename', async (c) => {
    const { token, filename } = c.req.param();

    if (filename.endsWith('.png')) {
        return (await serveAsset(filename, c.env)) || c.text('Not found', 404);
    }

    if (filename.endsWith('.strm')) {
        const files = await getDMMCastWebDAVFiles(token);
        const file = files.find(f => f.name === filename);
        if (!file) return c.text('File not found', 404);
        return c.text(file.content, 200, { 'Content-Type': 'text/plain; charset=utf-8' });
    }

    return c.text('File not found', 404);
});

// DELETE /:token/:filename - Delete DMM entry
app.on(['DELETE'], '/:token/:filename', async (c) => {
    const { token, filename } = c.req.param();
    const decodedFilename = decodeURIComponent(filename);

    try {
        const match = decodedFilename.match(/\{hash-([^}]+)\}\{imdb-([^}]+)\}\.strm$/);
        if (!match) return c.text('Invalid filename format', 400);

        const [, hash, imdbId] = match;
        const response = await fetch('https://debridmediamanager.com/api/stremio/deletelink', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, imdbId, hash }),
        });

        if (!response.ok) return c.text(await response.text(), response.status);
        return new Response(null, { status: 204 });
    } catch (error) {
        return c.text(error.message, 500);
    }
});

export default app;
