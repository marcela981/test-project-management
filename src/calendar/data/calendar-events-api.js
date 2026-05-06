/**
 * Calendar events client — talks to /api/calendar/events with a small
 * Map-based stale-while-revalidate cache on top of the browser's HTTP cache.
 *
 * Two cache layers cooperate:
 *   1. The browser respects `Cache-Control` + `ETag` from the backend, so
 *      repeat fetches inside the TTL window resolve from disk without
 *      hitting the network.
 *   2. This module keeps a tiny in-memory `Map` so we can answer
 *      `getCalendarEvents(date, view)` synchronously (the renderer needs
 *      data NOW; the network round-trip happens only on a real miss).
 *
 * On logout the Map is cleared from `auth.js` to prevent leaking events
 * between user sessions on the same machine.
 */

import { CONFIG } from '../../core/config.js';
import { authedFetch, apiFetch } from '../../api/http.js';

const BASE = `${CONFIG.BACKEND_BASE_URL}/api/calendar`;

// Mirror the backend's per-view TTLs (seconds → ms).
// Numeric separators (e.g. 300_000) are intentionally avoided here because
// the project's ESLint parser predates ES2021; Vite's parser accepts them
// fine, but the lint pre-commit hook blows up.
const TTL_MS_BY_VIEW = {
    day:      300000,
    week:     300000,
    month:    600000,
    quarter:  900000,
    semester: 1800000,
};

// Same threshold as the backend (CACHE_STALE_THRESHOLD).
const STALE_FACTOR = 0.7;

// key → { events, fetchedAt, ttlMs, source }
const _cache = new Map();
// Dedupes concurrent fetches for the same key.
const _inFlight = new Map();
// Tracks which views have already primed the backend cache so we only ask
// for `prefetch: true` ONCE per session per view, never on plain navigation.
const _viewsPrimed = new Set();

function _cacheKey(view, rangeStartIso, rangeEndIso) {
    return `${view}:${rangeStartIso}:${rangeEndIso}`;
}

function _toIso(d) {
    if (typeof d === 'string') return d.slice(0, 10);
    const yyyy = d.getFullYear();
    const mm   = String(d.getMonth() + 1).padStart(2, '0');
    const dd   = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

/**
 * Fetch events for a range. SWR semantics:
 *   - fresh hit  → resolves immediately with cached data, NO network call
 *   - stale hit  → resolves immediately with cached data, refresh in bg
 *   - miss       → resolves after the network round-trip
 *
 * @param {Date|string} rangeStart      inclusive
 * @param {Date|string} rangeEnd        inclusive
 * @param {'day'|'week'|'month'|'quarter'|'semester'} view
 * @param {{prefetch?: boolean}} [opts]
 * @returns {Promise<{events: object[], cache: 'fresh'|'stale'|'miss'}>}
 */
export async function fetchCalendarEvents(rangeStart, rangeEnd, view, opts = {}) {
    const startIso = _toIso(rangeStart);
    const endIso   = _toIso(rangeEnd);
    const key      = _cacheKey(view, startIso, endIso);
    const ttlMs    = TTL_MS_BY_VIEW[view] ?? TTL_MS_BY_VIEW.week;

    const entry = _cache.get(key);
    if (entry) {
        const age = Date.now() - entry.fetchedAt;
        if (age < ttlMs * STALE_FACTOR) {
            return { events: entry.events, cache: 'fresh' };
        }
        if (age < ttlMs) {
            // Stale: fire-and-forget refresh, return cached data NOW.
            _refresh(key, startIso, endIso, view, opts.prefetch).catch(() => {});
            return { events: entry.events, cache: 'stale' };
        }
        // Past TTL — fall through to network fetch.
    }

    return _refresh(key, startIso, endIso, view, opts.prefetch);
}

/**
 * Synchronous accessor for already-cached events. Renderers that don't
 * want to await (e.g. skeleton paths) call this; if the cache is empty
 * they get `[]` and should call `fetchCalendarEvents` separately.
 */
export function getCalendarEvents(rangeStart, rangeEnd, view) {
    const startIso = _toIso(rangeStart);
    const endIso   = _toIso(rangeEnd);
    const entry    = _cache.get(_cacheKey(view, startIso, endIso));
    return entry?.events ?? [];
}

/**
 * Drop the in-memory cache. Call from auth.logout() so the next user
 * never inherits events from the previous session.
 */
export function clearCalendarCache() {
    _cache.clear();
    _inFlight.clear();
    _viewsPrimed.clear();
}

/**
 * Fire-and-forget warm-up for a calendar view. Triggers `prefetch: true`
 * exactly once per `view` in this session, so the backend cache is ready
 * for both the current and the adjacent window. Subsequent navigations
 * within the view (next/prev) reuse the warm cache.
 */
export function maybePrefetchOnFirstMount(view, rangeStart, rangeEnd) {
    if (_viewsPrimed.has(view)) return;
    _viewsPrimed.add(view);
    fetchCalendarEvents(rangeStart, rangeEnd, view, { prefetch: true })
        .catch(() => {/* warm-up shouldn't surface errors */});
}

/**
 * Force the backend to drop its cache for the current user. Used when the
 * user explicitly hits "refresh" — keeps the next /events call from
 * serving stale data from Redis.
 */
export async function invalidateBackendCache() {
    try {
        await apiFetch('/api/calendar/cache/invalidate', { method: 'POST' });
    } catch {
        // Best-effort; no UI surfacing.
    }
    clearCalendarCache();
}

// ── internals ──────────────────────────────────────────────────────────────

async function _refresh(key, startIso, endIso, view, prefetch) {
    if (_inFlight.has(key)) return _inFlight.get(key);

    const promise = (async () => {
        const params = new URLSearchParams({
            start: startIso,
            end:   endIso,
            view,
            prefetch: prefetch ? 'true' : 'false',
        });
        try {
            const res = await authedFetch(`${BASE}/events?${params}`, {});
            // null means double-401 → logout already called
            if (!res) return { events: [], cache: 'miss' };
            if (!res.ok) {
                if (res.status === 412) {
                    // App Password missing or invalid — signal the settings UI.
                    window.dispatchEvent(new CustomEvent('caldav-setup-required'));
                    return { events: [], cache: 'miss' };
                }
                // Don't poison the cache on provider/server failures — the next
                // call should retry cleanly. Surface an empty result so the
                // weekly view degrades gracefully (existing blocks still show).
                if (res.status === 502 || res.status === 503 || res.status >= 500) {
                    return { events: [], cache: 'miss' };
                }
                throw new Error(`calendar events HTTP ${res.status}`);
            }
            const data = await res.json();
            const events = Array.isArray(data?.events) ? data.events : [];
            _cache.set(key, {
                events,
                fetchedAt: Date.now(),
                ttlMs:     TTL_MS_BY_VIEW[view] ?? TTL_MS_BY_VIEW.week,
                source:    data?.cache ?? 'miss',
            });
            return { events, cache: data?.cache ?? 'miss' };
        } finally {
            _inFlight.delete(key);
        }
    })();

    _inFlight.set(key, promise);
    return promise;
}
