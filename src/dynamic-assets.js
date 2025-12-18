// Dynamic asset serving for Cloudflare Workers
// Uses pre-bundled assets from public-assets.js

import { publicAssets, assetMetadata } from './public-assets.js';

// Convert base64 to ArrayBuffer
const base64ToBuffer = (base64) => {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
};

// Pre-convert bundled assets to buffers
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

// Serve file from bundled assets
export async function serveAsset(assetPath, env) {
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

    // Use bundled assets metadata
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
