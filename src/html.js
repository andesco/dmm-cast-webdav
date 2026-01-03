// src/html.js

export function layout(title, content) {
    const pageTitle = title ? `DMM Cast WebDAV · ${title}` : 'DMM Cast WebDAV';
    // The cache-busting query parameter is added here.
    const cacheBuster = new Date().getTime();
    return `<!DOCTYPE html>
<html data-theme="light">
<head>
    <meta charset="UTF-8">
    <title>${pageTitle}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
    <link rel="stylesheet" href="/style.css?_v=${cacheBuster}">
    <script>
        // Support light and dark mode based on system preference
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.documentElement.setAttribute('data-theme', 'dark');
        }
    </script>
</head>
<body>
    <main class="container">
        <article>
            ${content}
        </article>
    </main>
</body>
</html>`;
}

export function statusHeader(error = null, success = null, defaultTitle = 'DMM Cast WebDAV', defaultSubtitle = 'Stream media from Debrid Media Manager Cast') {
    const title = error ? 'Failed to Cast' : success || defaultTitle;
    let subtitle = error;
    if (error && error.startsWith('Failed to cast: ')) {
        subtitle = `error: <code>${error.replace('Failed to cast: ', '')}</code>`;
    } else if (!error && !success) {
        subtitle = defaultSubtitle;
    }

    return `
<header>
    ${error ? `<span class="status-badge error">ERROR</span>` : ''}
    ${success ? `<span class="status-badge success">SUCCESS</span>` : ''}
    <h2>${title}</h2>
    ${subtitle ? `<p>${subtitle}</p>` : ''}
</header>`;
}

export function pageHeader(title, subtitle = null) {
    return `
<header>
    <h2>${title}</h2>
    ${subtitle ? `<p>${subtitle}</p>` : ''}
</header>`;
}

export function footer() {
    return `
<footer style="margin-top: 2rem; text-align: center;">
    <small>
        <a href="https://github.com/andesco/dmm-cast-webdav" target="_blank"><code>andesco/dmm-cast-webdav</code></a>
    </small>
</footer>`;
}

export function loginPage(hostname) {
    return `
<header>
    <h2>DMM Cast WebDAV Setup</h2>
    <p>This worker is protected by HTTP Basic Authentication.</p>
</header>

<div class="status-info">
    <p>To connect your WebDAV client (Infuse, Kodi, VLC, etc.), use the following credentials:</p>
    <ul>
        <li><strong>URL:</strong> <code>${hostname}/</code></li>
        <li><strong>Username:</strong> <code>token</code></li>
        <li><strong>Password:</strong> <code>[Your Real-Debrid API Token]</code></li>
    </ul>
    <p><small>You can find your token at <a href="https://real-debrid.com/apitoken" target="_blank">real-debrid.com/apitoken</a></small></p>
</div>

<div class="button-wrapper">
    <a href="/" role="button">Access Files Online</a>
</div>

<article style="margin-top: 2rem; border-top: 1px solid var(--pico-muted-border-color); padding-top: 1rem;">
    <h3>How to logout/switch users</h3>
    <p><small>To switch to a different Real-Debrid account, you need to clear your browser's authentication cache. The easiest way is to use a Private/Incognito window or clear your "Site Data" for this domain.</small></p>
</article>
`;
}

export function formatBytes(bytes) {
    if (bytes === 0) return '0.0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    // Always show MB as GB for better readability
    if (i === 2) { // MB
        const gb = bytes / Math.pow(k, 3);
        return gb.toFixed(1) + ' GB';
    }

    return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}
