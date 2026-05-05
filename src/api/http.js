/** Centralized authenticated HTTP client with silent 401-refresh. */

import { CONFIG } from '../core/config.js';
import { getToken, logout, refreshAccessToken, shouldRefreshSoon } from '../auth/auth.js';
import { flushActiveTimers } from '../timer/timerFlush.js';

/**
 * Low-level authenticated fetch. Injects Authorization header; on 401 tries
 * a silent token refresh and retries once. On double-401 or refresh failure,
 * flushes timers and calls logout(), then returns null.
 */
export async function authedFetch(url, opts = {}) {
    await shouldRefreshSoon();

    const doFetch = (token) => fetch(url, {
        ...opts,
        headers: {
            ...opts.headers,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
    });

    let res = await doFetch(getToken());
    if (res.status !== 401) return res;

    try {
        const newToken = await refreshAccessToken();
        res = await doFetch(newToken);
        if (res.status === 401) {
            flushActiveTimers();
            logout();
            return null;
        }
    } catch {
        flushActiveTimers();
        logout();
        return null;
    }

    return res;
}

/**
 * Authenticated fetch against a custom base URL. Parses JSON, adds
 * Content-Type: application/json by default, and throws on non-2xx.
 * Returns undefined when authedFetch returns null (logout occurred).
 */
export async function apiFetchAtBase(baseUrl, path, opts = {}) {
    const res = await authedFetch(`${baseUrl}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...opts,
    });
    if (res === null) return;
    if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);
    const text = await res.text();
    return text ? JSON.parse(text) : {};
}

/**
 * Authenticated JSON fetch against CONFIG.BACKEND_BASE_URL.
 * path must include the full API prefix (e.g. '/api/weekly/blocks').
 */
export async function apiFetch(path, opts = {}) {
    return apiFetchAtBase(CONFIG.BACKEND_BASE_URL, path, opts);
}
