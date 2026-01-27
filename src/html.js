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

function providerNav(provider) {
    const rdActive = provider.basePath === '/' ? ' aria-current="page"' : '';
    const torboxActive = provider.basePath === '/torbox/' ? ' aria-current="page"' : '';
    return `
<nav>
    <ul>
        <li><h1 style="margin: 0; font-size: inherit;">DMM Cast WebDAV</h1></li>
    </ul>
    <ul>
        <li><a href="/"${rdActive}>Real-Debrid</a></li>
        <li><a href="/torbox/"${torboxActive}>TorBox</a></li>
    </ul>
</nav>`;
}

export function statusHeader(error = null, success = null, provider = null) {
    const defaultTitle = provider ? provider.name : 'DMM Cast WebDAV';

    const title = error ? 'Failed to Cast' : success || defaultTitle;
    let subtitle = error;
    if (error && error.startsWith('Failed to cast: ')) {
        subtitle = `error: <code>${error.replace('Failed to cast: ', '')}</code>`;
    } else if (!error && !success) {
        subtitle = null;
    }

    const nav = provider ? providerNav(provider) : '';

    return `
${nav}
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

export function browserView(castedLinks, hostname, isSingleUser, provider) {
    const logoutButton = `<button class="outline secondary" style="padding: 0.2rem 0.5rem; font-size: 0.8rem; margin-top: 0.25rem;" onclick="location.href='${provider.basePath}logout'">Sign Out</button>`;

    const webdavUrl = `${hostname}${provider.basePath}`;
    const webdavHints = isSingleUser ? `
            <p><small>WebDAV URL: <code>${webdavUrl}</code></small></p>
    ` : `
            <p>
                <small>WebDAV URL: <code>${webdavUrl}</code></small><br>
                <small>username: <code>${provider.username}</code></small><br>
                <small>password: <code>[your API token]</code></small>
            </p>
    `;

    return `
${statusHeader(null, null, provider)}
<div class="status-info">
    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
        <div>
            <p><small>source: <a href="${provider.managePage}" target="_blank">${provider.managePage.replace('https://', '')}</a></small></p>
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
                &nbsp;<a href="${provider.basePath}${encodeURIComponent(link.strmFilename)}"><code>1 KB .strm</code></a>
            </small>
        </li>
        `).join('')}
    </ul>
</div>
<div class="button-wrapper">
    <a href="${provider.managePage}" target="_blank" role="button">Manage Casted Links</a>
</div>
${footer()}
`;
}

export function loginPage(hostname, isSingleUser, provider) {
    const usernameValue = isSingleUser ? '' : provider.username;
    const usernameReadonly = isSingleUser ? '' : 'readonly';
    const passwordPlaceholder = isSingleUser ? '' : 'paste your API token';
    const passwordLabel = isSingleUser ? 'password' : `${provider.name} API token`;
    const tokenLinkText = provider.tokenPage.replace('https://', '').replace(/\?.*$/, '');

    const webdavUrl = `${hostname}${provider.basePath}`;

    return `
${providerNav(provider)}
<header>
    <h2>${provider.name}</h2>
    <p>${isSingleUser ? 'Sign in with your WebDAV credentials to view your casted media links.' : `Enter your ${provider.name} API token to view your casted media links.`}</p>
</header>

<div id="login-section">
    <form id="login-form" method="POST" action="${provider.basePath}login">
        <label for="username">username
            <input type="text" id="username" name="username" value="${usernameValue}" ${usernameReadonly} autocomplete="username" required>
        </label>

        <label for="password">${passwordLabel}
            <input type="password" id="password" name="password" placeholder="${passwordPlaceholder}" autocomplete="current-password" required>
            ${!isSingleUser ? `<small><a href="${provider.tokenPage}" target="_blank">${tokenLinkText}</a></small>` : ''}
        </label>
        <button type="submit">Sign In</button>
    </form>
</div>

${!isSingleUser ? `<article style="margin-top: 2rem;">
    <p>
        <small>WebDAV URL: <code>${webdavUrl}</code></small><br>
        <small>username: <code>${provider.username}</code></small><br>
        <small>password: <code>[your API token]</code></small>
    </p>
</article>` : ''}
${footer()}
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
