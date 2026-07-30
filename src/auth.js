export const AUTH_MODE = Object.freeze({
    PUBLIC: 'public',
    PRIVATE: 'private',
    MISCONFIGURED: 'misconfigured',
});

function isConfigured(value) {
    return Boolean(value);
}

/**
 * Determine the effective authentication mode for a provider.
 *
 * Public mode is only enabled when the deployment has no authentication
 * secrets at all. Once private mode is attempted, every provider must have
 * its own API credential and the shared WebDAV credential pair.
 */
export function getAuthMode(env, provider, providers) {
    const usernameConfigured = isConfigured(env.WEBDAV_USERNAME);
    const passwordConfigured = isConfigured(env.WEBDAV_PASSWORD);
    const providerTokenConfigured = isConfigured(env[provider.envTokenKey]);
    const anyProviderTokenConfigured = Object.values(providers)
        .some(candidate => isConfigured(env[candidate.envTokenKey]));

    if (!usernameConfigured && !passwordConfigured && !anyProviderTokenConfigured) {
        return AUTH_MODE.PUBLIC;
    }

    if (usernameConfigured && passwordConfigured && providerTokenConfigured) {
        return AUTH_MODE.PRIVATE;
    }

    return AUTH_MODE.MISCONFIGURED;
}

/**
 * Return effective authentication modes without exposing secret values.
 */
export function getAuthModes(env, providers) {
    return Object.fromEntries(
        Object.entries(providers).map(([key, provider]) => [
            key,
            getAuthMode(env, provider, providers),
        ])
    );
}
