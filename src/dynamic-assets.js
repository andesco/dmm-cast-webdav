// Dynamic asset serving
// - Node.js: Reads files directly from public/ directory
// - Workers: Uses pre-bundled assets from public-assets.js

import { publicAssets, assetMetadata } from './public-assets.js';

// Detect if we're in Node.js (has process.versions.node)
const isNodeJS = typeof process !== 'undefined' && process.versions?.node;

// Node.js filesystem imports (only loaded in Node.js)
let fs, path, fileURLToPath, dirname;
if (isNodeJS) {
    const fsModule = await import('fs');
    const pathModule = await import('path');
    const urlModule = await import('url');
    fs = fsModule;
    path = pathModule;
    fileURLToPath = urlModule.fileURLToPath;
    dirname = pathModule.dirname;
}

// Get the public directory path (Node.js only) - computed lazily when needed
let publicDir;
const getPublicDir = () => {
    if (!publicDir && isNodeJS) {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        publicDir = path.join(__dirname, '../public');
    }
    return publicDir;
};

// Convert base64 to ArrayBuffer (Workers only)
const base64ToBuffer = (base64) => {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
};

// Pre-convert bundled assets to buffers (always, for Workers use)
// Note: Even though this runs during build in Node.js, we need to populate
// this so it's available when the bundle runs in the Workers environment
const assetBuffers = {};
Object.keys(publicAssets).forEach(path => {
    assetBuffers[path] = base64ToBuffer(publicAssets[path]);
});

// Get MIME type from file extension
const getMimeType = (filename) => {
    const ext = filename.split('.').pop().toLowerCase();
    const mimeTypes = {
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'svg': 'image/svg+xml',
        'css': 'text/css',
        'xml': 'application/xml',
        'txt': 'text/plain',
    };
    return mimeTypes[ext] || 'application/octet-stream';
};

// Serve file dynamically
export async function serveAsset(assetPath, env) {
    // Runtime detection: check if we're in Workers (has caches global) or Node.js
    const isWorkers = typeof caches !== 'undefined';
    const hasFilesystem = !isWorkers && typeof fs !== 'undefined' && fs !== null;

    // Node.js: Read from filesystem
    if (hasFilesystem) {
        try {
            const filePath = path.join(getPublicDir(), assetPath);
            const buffer = fs.readFileSync(filePath);
            const stats = fs.statSync(filePath);

            return new Response(buffer, {
                headers: {
                    'Content-Type': getMimeType(assetPath),
                    'Cache-Control': 'public, max-age=31536000',
                    'Content-Length': stats.size.toString(),
                },
            });
        } catch (e) {
            return null; // File not found
        }
    }

    // Workers: Use bundled assets
    const buffer = assetBuffers[assetPath];
    const metadata = assetMetadata[assetPath];

    if (!buffer || !metadata) {
        return null;
    }

    return new Response(buffer, {
        headers: {
            'Content-Type': metadata.mimeType,
            'Cache-Control': 'public, max-age=31536000',
            'Content-Length': metadata.size.toString(),
        },
    });
}

// Get list of available assets for a directory (for PROPFIND)
export async function getAssetsInDirectory(directory, env) {
    const prefix = directory ? `${directory}/` : '';

    // Runtime detection: check if we're in Workers (has caches global) or Node.js
    const isWorkers = typeof caches !== 'undefined';
    const hasFilesystem = !isWorkers && typeof fs !== 'undefined' && fs !== null;

    // Node.js: Read from filesystem
    if (hasFilesystem) {
        try {
            const dirPath = path.join(getPublicDir(), directory || '');
            const files = fs.readdirSync(dirPath);

            return files
                .filter(file => {
                    // Skip .DS_Store files
                    if (file === '.DS_Store') return false;

                    const filePath = path.join(dirPath, file);
                    return fs.statSync(filePath).isFile();
                })
                .map(file => {
                    const filePath = path.join(dirPath, file);
                    const stats = fs.statSync(filePath);
                    return {
                        name: file,
                        size: stats.size,
                        modified: stats.mtime.toISOString(),
                        contentType: getMimeType(file),
                    };
                });
        } catch (e) {
            return []; // Directory not found
        }
    }

    // Workers: Use bundled assets metadata
    return Object.keys(assetMetadata)
        .filter(assetPath => {
            const filename = assetPath.substring(prefix.length);
            // Skip .DS_Store files and ensure it's in the correct directory
            return assetPath.startsWith(prefix) &&
                   !filename.includes('/') &&
                   filename !== '.DS_Store';
        })
        .map(assetPath => ({
            name: assetPath.substring(prefix.length),
            size: assetMetadata[assetPath].size,
            modified: '2025-12-12T00:00:00.000Z',
            contentType: assetMetadata[assetPath].mimeType,
        }));
}
