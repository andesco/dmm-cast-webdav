
import { serveStatic } from 'hono/cloudflare-workers';
import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { serveAsset, getAssetsInDirectory } from './dynamic-assets.js';

const app = new Hono();

// --- Middleware ---

// Validate required environment variables
app.use('*', async (c, next) => {
    if (!c.env.RD_ACCESS_TOKEN || !c.env.WEBDAV_PASSWORD) {
        return c.text('Missing required environment variables: RD_ACCESS_TOKEN, WEBDAV_PASSWORD', 500);
    }
    await next();
});

// Basic Auth Middleware - Protect ALL routes except /health and public assets
app.use('*', async (c, next) => {
    // Skip auth for health check and public static assets
    const publicPaths = ['/health', '/style.css', '/public/'];
    if (publicPaths.some(path => c.req.path === path || c.req.path.startsWith(path))) {
        return next();
    }

    // Apply Basic Auth
    const username = c.env.WEBDAV_USERNAME || 'admin';
    const password = c.env.WEBDAV_PASSWORD;

    return basicAuth({
        verifyUser: (user, pass, c) => {
            return user === username && pass === password;
        },
    })(c, next);
});


import { layout, statusHeader, pageHeader, footer, formatBytes } from './html.js';

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

app.get('/', async (c) => {
    const hostname = new URL(c.req.url).origin;

    // Get casted links from DMM API
    const castedLinks = await getCastedLinks(c.env.RD_ACCESS_TOKEN);

    const content = `
		${statusHeader()}
		${castedLinks && castedLinks.length > 0 ? `
		<div class="status-info">
			<p><small>source: <a href="https://debridmediamanager.com/stremio/manage" target="_blank">debridmediamanager.com/stremio/manage</a></small><br />
			   <small>WebDAV: <code>${hostname}/</code></small>
            </p>
			<ul>
				${castedLinks.map(link => `
				<li>
                    ${link.filename}
                    <small class="nowrap">
                        <a href="${link.url}" target="_blank"><code>${link.sizeGB} GB</code></a>
                        &nbsp;<a href="/${encodeURIComponent(link.strmFilename).replace(/%7B/g, '{').replace(/%7D/g, '}')}"><code>1 KB .strm</code></a>
                    </small>
                </li>
				`).join('')}
			</ul>
		</div>
        <div class="button-wrapper">
            <a href="https://debridmediamanager.com/stremio/manage" target="_blank" role="button">Manage Casted Links</a>
        </div>
		` : ''}
		${footer()}
	`;
    return c.html(layout('', content));
});



app.get('/health', (c) => {
    // Workers don't track uptime, always return 0
    const uptime = 0;
    return c.json({
        status: 'ok',
        uptime: uptime,
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
            // Use precached strmFilename
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
                imdbId: link.imdbId,    // Store for reference
                hash: link.hash,         // Store for reference
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

        // Convert map to array and remove temporary timestamp field
        const files = Array.from(filesMap.values()).map(file => {
            const { modifiedTimestamp, ...cleanFile } = file;
            return cleanFile;
        });

        return files;
    } catch (error) {
        console.error('Error in getDMMCastWebDAVFiles:', error.message, error.stack);
        return [];
    }
}

// PROPFIND / - WebDAV root serving DMM Cast .strm files and PNG files
app.on(['PROPFIND'], '/', async (c) => {
    const files = await getDMMCastWebDAVFiles(c.env.RD_ACCESS_TOKEN);
    const depth = c.req.header('Depth') || '0';
    const requestUrl = new URL(c.req.url);
    const requestPath = requestUrl.pathname;

    const env = c.env;
    // Get all PNG files from public directory
    const publicFiles = await getAssetsInDirectory('', env);
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

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
${depth !== '0' ? responses : ''}${collectionResponse}
</D:multistatus>`;

    return new Response(xml, { status: 207, headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
});












// --- Static File Serving ---
// Dynamically serve files from R2 (if configured) or bundled assets

// Serve style.css from root path
app.get('/style.css', async (c) => {
    const response = await serveAsset('style.css', c.env);
    return response || c.text('File not found: style.css', 404);
});

// Dynamic route handler for /public/* paths
app.get('/public/*', async (c) => {
    const path = c.req.path.replace('/public/', '');
    const response = await serveAsset(path, c.env);
    return response || c.text(`File not found: ${path}`, 404);
});

// Removed generic /webdav/:directory/:filename route
// Static files are now handled in the specific routes below



// GET /:filename - Serve .strm files from DMM Cast or PNG files from public
app.get('/:filename', async (c) => {
    const { filename } = c.req.param();

    // First, try to serve as PNG file from public directory
    if (filename.endsWith('.png')) {
        const response = await serveAsset(filename, c.env);
        if (response) {
            return response;
        }
    }

    // Handle .strm files
    if (filename.endsWith('.strm')) {
        const files = await getDMMCastWebDAVFiles(c.env.RD_ACCESS_TOKEN);
        const file = files.find(f => f.name === filename);

        if (!file) {
            return c.text('File not found', 404);
        }

        return c.text(file.content, 200, { 'Content-Type': 'text/plain; charset=utf-8' });
    }

    return c.text('File not found', 404);
});

// DELETE /* - Delete DMM Cast entry via WebDAV
app.on(['DELETE'], '/*', async (c) => {
    // Extract filename from path
    const fullPath = new URL(c.req.url).pathname;
    const filename = decodeURIComponent(fullPath.replace('/', ''));

    try {
        // Parse hash and imdbId from encoded filename (both with prefixes)
        const match = filename.match(/\{hash-([^}]+)\}\{imdb-([^}]+)\}\.strm$/);
        if (!match) {
            console.error('Invalid filename format:', filename);
            return c.text('Invalid filename format - missing hash or imdbId encoding', 400);
        }

        const [, hash, imdbId] = match;

        console.log(`Deleting DMM cast: imdbId=${imdbId}, hash=${hash}`);

        // Call DMM delete API
        const response = await fetch('https://debridmediamanager.com/api/stremio/deletelink', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: c.env.RD_ACCESS_TOKEN,
                imdbId: imdbId,
                hash: hash,
            }),
        });

        if (!response.ok) {
            const error = await response.text();
            console.error('DMM delete failed:', response.status, error);
            return c.text(`Delete failed: ${error}`, response.status);
        }

        console.log('DMM cast deleted successfully');
        return new Response(null, { status: 204 }); // No Content
    } catch (error) {
        console.error('Error deleting DMM cast:', error);
        return c.text(`Delete failed: ${error.message}`, 500);
    }
});

export default app;
