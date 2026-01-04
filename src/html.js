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

export function browserView(castedLinks, hostname, isSingleUser) {
    const logoutButton = `<button class="outline secondary" style="padding: 0.2rem 0.5rem; font-size: 0.8rem; margin-top: 0.25rem;" onclick="location.href='/logout'">Sign Out</button>`;

    const webdavHints = `
        <div style="margin-top: 0.5rem;">
            <p style="margin-bottom: 0;"><small><strong>WebDAV URL:</strong> <code>${hostname}/</code></small></p>
            <p style="margin-bottom: 0;"><small><strong>username:</strong> <code>${isSingleUser ? 'your configured username' : 'apitoken'}</code></small></p>
            <p style="margin-bottom: 0;"><small><strong>password:</strong> <code>${isSingleUser ? 'your configured password' : '[your API token]'}</code></small></p>
        </div>`;

    return `
${statusHeader()}
<div class="status-info">
    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
        <div>
            <p><small>source: <a href="https://debridmediamanager.com/stremio/manage" target="_blank">debridmediamanager.com/stremio/manage</a></small></p>
            ${webdavHints}
        </div>
        ${logoutButton}
    </div>
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
${footer()}
`;
}

export function loginPage(hostname, isSingleUser, defaultUsername) {
    const usernameValue = isSingleUser ? (defaultUsername || '') : 'apitoken';
    const usernameReadonly = isSingleUser ? '' : 'readonly';
    const passwordPlaceholder = isSingleUser ? 'enter WebDAV password' : 'paste your API token';
    const passwordLabel = isSingleUser ? 'WebDAV Password' : 'Real-Debrid API Token';

    return `
<header>
    <h2>DMM Cast WebDAV</h2>
    <p>${isSingleUser ? 'Sign in with your WebDAV credentials.' : 'Enter your Real-Debrid token to browse your files.'}</p>
</header>

<div id="login-section">
    <form id="login-form" method="POST" action="/login">
        <label for="username">Username
            <input type="text" id="username" name="username" value="${usernameValue}" ${usernameReadonly} autocomplete="username" required>
        </label>
        
        <label for="password">${passwordLabel}
            <input type="password" id="password" name="password" placeholder="${passwordPlaceholder}" autocomplete="current-password" required>
            ${!isSingleUser ? '<small><a href="https://real-debrid.com/apitoken" target="_blank">real-debrid.com/apitoken</a></small>' : ''}
        </label>
        <button type="submit">Sign In</button>
    </form>
</div>

<article style="margin-top: 2rem;">
    <h3>WebDAV for Infuse and other media players</h3>
    <ul>
        <li><strong>WebDAV URL:</strong> <code>${hostname}/</code></li>
        <li><strong>username:</strong> <code>${isSingleUser ? (defaultUsername || 'your_username') : 'apitoken'}</code></li>
        <li><strong>password:</strong> <code>${isSingleUser ? '[your_password]' : '[your API token]'}</code></li>
    </ul>
</article>
`;
}

export function footer() {
    return `
<footer style="margin-top: 2rem; text-align: center;">
    <small>
        <a href="https://github.com/andesco/dmm-cast-webdav" target="_blank"><code>andesco/dmm-cast-webdav</code></a>
    </small>
</footer>`;
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
