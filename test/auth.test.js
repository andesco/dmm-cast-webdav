import assert from 'node:assert/strict';
import test from 'node:test';
import app from '../src/app.js';
import { AUTH_MODE, getAuthMode } from '../src/auth.js';

const PROVIDERS = {
    rd: { envTokenKey: 'RD_API_TOKEN' },
    torbox: { envTokenKey: 'TORBOX_API_KEY' },
};

const combinations = [
    [false, false, false, AUTH_MODE.PUBLIC],
    [false, false, true, AUTH_MODE.MISCONFIGURED],
    [false, true, false, AUTH_MODE.MISCONFIGURED],
    [false, true, true, AUTH_MODE.MISCONFIGURED],
    [true, false, false, AUTH_MODE.MISCONFIGURED],
    [true, false, true, AUTH_MODE.MISCONFIGURED],
    [true, true, false, AUTH_MODE.MISCONFIGURED],
    [true, true, true, AUTH_MODE.PRIVATE],
];

test('getAuthMode covers every provider-secret combination', async (t) => {
    for (const [token, username, password, expected] of combinations) {
        await t.test(`${token}/${username}/${password} -> ${expected}`, () => {
            const env = {
                RD_API_TOKEN: token ? 'rd-secret' : '',
                WEBDAV_USERNAME: username ? 'webdav-user' : '',
                WEBDAV_PASSWORD: password ? 'webdav-secret' : '',
            };
            assert.equal(getAuthMode(env, PROVIDERS.rd, PROVIDERS), expected);
        });
    }
});

test('a missing provider credential is not inferred as public in private mode', () => {
    const env = {
        RD_API_TOKEN: 'rd-secret',
        WEBDAV_USERNAME: 'webdav-user',
        WEBDAV_PASSWORD: 'webdav-secret',
    };

    assert.equal(getAuthMode(env, PROVIDERS.rd, PROVIDERS), AUTH_MODE.PRIVATE);
    assert.equal(getAuthMode(env, PROVIDERS.torbox, PROVIDERS), AUTH_MODE.MISCONFIGURED);
});

test('either provider credential without WebDAV credentials disables both providers', () => {
    const env = { TORBOX_API_KEY: 'torbox-secret' };

    assert.equal(getAuthMode(env, PROVIDERS.rd, PROVIDERS), AUTH_MODE.MISCONFIGURED);
    assert.equal(getAuthMode(env, PROVIDERS.torbox, PROVIDERS), AUTH_MODE.MISCONFIGURED);
});

test('misconfigured requests fail closed before cookies or Basic Auth', async (t) => {
    const env = {
        RD_API_TOKEN: 'rd-secret',
        WEBDAV_USERNAME: 'webdav-user',
    };
    const credentials = Buffer.from('webdav-user:looks-valid').toString('base64');
    const cases = [
        ['browser', '/', { headers: { Cookie: 'rd_token=stale-secret' } }],
        ['login', '/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'username=webdav-user&password=looks-valid',
        }],
        ['PROPFIND', '/', {
            method: 'PROPFIND',
            headers: { Authorization: `Basic ${credentials}` },
        }],
        ['STRM GET', '/example.strm', {
            headers: { Authorization: `Basic ${credentials}` },
        }],
        ['PNG GET', '/favorite.png', {
            headers: { Authorization: `Basic ${credentials}` },
        }],
        ['DELETE', '/example%7Bhash-abc%7D%7Bimdb-tt1%7D.strm', {
            method: 'DELETE',
            headers: { Authorization: `Basic ${credentials}` },
        }],
    ];

    for (const [name, path, init] of cases) {
        await t.test(name, async () => {
            const response = await app.request(`https://example.com${path}`, init, env);
            assert.equal(response.status, 503);
            assert.doesNotMatch(await response.text(), /rd-secret|looks-valid|stale-secret/);
        });
    }
});

test('browser configuration error names variables but does not show a login form', async () => {
    const response = await app.request('https://example.com/', {}, {
        RD_API_TOKEN: 'rd-secret',
        WEBDAV_USERNAME: 'webdav-user',
    });
    const body = await response.text();

    assert.equal(response.status, 503);
    assert.match(body, /RD_API_TOKEN/);
    assert.match(body, /WEBDAV_USERNAME/);
    assert.match(body, /WEBDAV_PASSWORD/);
    assert.doesNotMatch(body, /<form/);
    assert.doesNotMatch(body, /rd-secret|webdav-user/);
});

test('health reports public, private, and misconfigured provider modes', async (t) => {
    const cases = [
        ['public', {}, 200, { rd: 'public', torbox: 'public' }],
        ['private', {
            RD_API_TOKEN: 'rd-secret',
            TORBOX_API_KEY: 'torbox-secret',
            WEBDAV_USERNAME: 'webdav-user',
            WEBDAV_PASSWORD: 'webdav-secret',
        }, 200, { rd: 'private', torbox: 'private' }],
        ['RD only', {
            RD_API_TOKEN: 'rd-secret',
            WEBDAV_USERNAME: 'webdav-user',
            WEBDAV_PASSWORD: 'webdav-secret',
        }, 503, { rd: 'private', torbox: 'misconfigured' }],
        ['TorBox only', {
            TORBOX_API_KEY: 'torbox-secret',
            WEBDAV_USERNAME: 'webdav-user',
            WEBDAV_PASSWORD: 'webdav-secret',
        }, 503, { rd: 'misconfigured', torbox: 'private' }],
        ['partial shared credentials', {
            WEBDAV_USERNAME: 'webdav-user',
        }, 503, { rd: 'misconfigured', torbox: 'misconfigured' }],
    ];

    for (const [name, env, status, providers] of cases) {
        await t.test(name, async () => {
            const response = await app.request('https://example.com/health', {}, env);
            const body = await response.json();

            assert.equal(response.status, status);
            assert.deepEqual(body.providers, providers);
            assert.doesNotMatch(JSON.stringify(body), /secret|webdav-user/);
        });
    }
});

test('invalid credentials in valid public and private modes return 401', async () => {
    const invalidPublic = Buffer.from('wrong-user:token').toString('base64');
    const publicResponse = await app.request('https://example.com/', {
        method: 'PROPFIND',
        headers: { Authorization: `Basic ${invalidPublic}` },
    }, {});

    const invalidPrivate = Buffer.from('webdav-user:wrong-password').toString('base64');
    const privateResponse = await app.request('https://example.com/', {
        method: 'PROPFIND',
        headers: { Authorization: `Basic ${invalidPrivate}` },
    }, {
        RD_API_TOKEN: 'rd-secret',
        TORBOX_API_KEY: 'torbox-secret',
        WEBDAV_USERNAME: 'webdav-user',
        WEBDAV_PASSWORD: 'webdav-secret',
    });

    assert.equal(publicResponse.status, 401);
    assert.equal(privateResponse.status, 401);
});

test('browser login UX follows the effective mode', async (t) => {
    await t.test('public mode requests a provider API credential', async () => {
        const response = await app.request('https://example.com/real-debrid/', {}, {});
        const body = await response.text();

        assert.equal(response.status, 200);
        assert.match(body, /Enter your Real-Debrid API token/);
        assert.match(body, /value="real-debrid" readonly/);
    });

    await t.test('private mode requests configured WebDAV credentials', async () => {
        const response = await app.request('https://example.com/real-debrid/', {}, {
            RD_API_TOKEN: 'rd-secret',
            TORBOX_API_KEY: 'torbox-secret',
            WEBDAV_USERNAME: 'webdav-user',
            WEBDAV_PASSWORD: 'webdav-secret',
        });
        const body = await response.text();

        assert.equal(response.status, 200);
        assert.match(body, /Sign in with your WebDAV credentials/);
        assert.doesNotMatch(body, /value="real-debrid" readonly/);
        assert.doesNotMatch(body, /rd-secret|torbox-secret|webdav-user|webdav-secret/);
    });
});

test('invalid browser logins in valid modes return 401, not 503', async () => {
    const publicResponse = await app.request('https://example.com/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'username=wrong-user&password=token',
    }, {});

    const privateResponse = await app.request('https://example.com/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'username=webdav-user&password=wrong-password',
    }, {
        RD_API_TOKEN: 'rd-secret',
        TORBOX_API_KEY: 'torbox-secret',
        WEBDAV_USERNAME: 'webdav-user',
        WEBDAV_PASSWORD: 'webdav-secret',
    });

    assert.equal(publicResponse.status, 401);
    assert.equal(privateResponse.status, 401);
});

test('Real-Debrid has a canonical provider endpoint and a compatible legacy root', async (t) => {
    await t.test('redirects the path without a trailing slash', async () => {
        const response = await app.request('https://example.com/real-debrid', {
            redirect: 'manual',
        }, {});

        assert.equal(response.status, 301);
        assert.equal(response.headers.get('location'), '/real-debrid/');
    });

    await t.test('renders canonical Real-Debrid URLs', async () => {
        const response = await app.request('https://example.com/real-debrid/', {}, {});
        const body = await response.text();

        assert.equal(response.status, 200);
        assert.match(body, /https:\/\/example\.com\/real-debrid\//);
        assert.match(body, /action="\/real-debrid\/login"/);
        assert.match(body, /href="\/real-debrid\/" aria-current="page"/);
    });

    await t.test('redirects the browser root to the canonical interface', async () => {
        const response = await app.request('https://example.com/', {
            redirect: 'manual',
        }, {});

        assert.equal(response.status, 302);
        assert.equal(response.headers.get('location'), '/real-debrid/');
    });

    await t.test('keeps legacy login and logout behavior consistent', async () => {
        const login = await app.request('https://example.com/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'username=real-debrid&password=public-token',
            redirect: 'manual',
        }, {});
        const logout = await app.request('https://example.com/logout', {
            redirect: 'manual',
        }, {});

        assert.equal(login.status, 302);
        assert.equal(login.headers.get('location'), '/');
        assert.match(login.headers.get('set-cookie'), /^rd_token=/);
        assert.equal(logout.status, 302);
        assert.equal(logout.headers.get('location'), '/');
        assert.match(logout.headers.get('set-cookie'), /^rd_token=/);
    });

    await t.test('supports WebDAV authentication at both paths', async () => {
        const invalid = Buffer.from('wrong-user:token').toString('base64');
        const init = {
            method: 'PROPFIND',
            headers: { Authorization: `Basic ${invalid}` },
        };

        const canonical = await app.request(
            'https://example.com/real-debrid/',
            init,
            {}
        );
        const legacy = await app.request('https://example.com/', init, {});

        assert.equal(canonical.status, 401);
        assert.equal(legacy.status, 401);
    });
});

test('canonical Real-Debrid routes also fail closed', async () => {
    const env = {
        RD_API_TOKEN: 'rd-secret',
        WEBDAV_USERNAME: 'webdav-user',
    };
    const response = await app.request('https://example.com/real-debrid/example.strm', {
        headers: { Cookie: 'rd_token=stale-secret' },
    }, env);

    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /rd-secret|webdav-user|stale-secret/);
});
