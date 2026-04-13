// Static asset serving via Wrangler Assets binding (env.ASSETS)

const ASSET_MANIFEST = [
    { name: 'cast-atv.png',      size: 158179, mimeType: 'image/png' },
    { name: 'cast.png',          size: 86070,  mimeType: 'image/png' },
    { name: 'favorite-atv.png',  size: 71083,  mimeType: 'image/png' },
    { name: 'favorite.png',      size: 121081, mimeType: 'image/png' },
    { name: 'link-atv.png',      size: 162166, mimeType: 'image/png' },
    { name: 'link.png',          size: 87435,  mimeType: 'image/png' },
    { name: 'orangecast-atv.png',size: 20824,  mimeType: 'image/png' },
    { name: 'orangecast.png',    size: 7913,   mimeType: 'image/png' },
    { name: 'style.css',         size: 1792,   mimeType: 'text/css'  },
];

const ASSET_MAP = Object.fromEntries(ASSET_MANIFEST.map(a => [a.name, a]));

// Serve a static asset via the ASSETS binding
export async function serveAsset(assetPath, env) {
    const meta = ASSET_MAP[assetPath];
    if (!meta || !env.ASSETS) return null;

    const response = await env.ASSETS.fetch(new Request(`http://placeholder/${assetPath}`));
    if (!response.ok) return null;
    return response;
}

// List assets for a directory (used by WebDAV PROPFIND)
export async function getAssetsInDirectory(directory, _env) {
    const prefix = directory ? `${directory}/` : '';
    return ASSET_MANIFEST
        .filter(a => !prefix || a.name.startsWith(prefix))
        .map(a => ({
            name: prefix ? a.name.slice(prefix.length) : a.name,
            size: a.size,
            modified: '2025-12-12T00:00:00.000Z',
            contentType: a.mimeType,
        }));
}
