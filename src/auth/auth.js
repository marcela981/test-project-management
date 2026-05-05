/** OAuth2 con Nextcloud: token en localStorage (persiste entre refreshes en iframes). */

import { CONFIG } from '../core/config.js';
import { pcClear } from '../core/persistent-cache.js';
import { clearCalendarCache } from '../calendar/data/calendar-events-api.js';

const TOKEN_KEY       = 'nc_access_token';
const REFRESH_KEY     = 'nc_refresh_token';
const EXPIRES_AT_KEY  = 'nc_expires_at';
const USER_KEY        = 'nc_user_info';
const LAST_ACTIVE_KEY = 'nc_last_active';
const INACTIVITY_MS   = 24 * 60 * 60 * 1000; // 24 horas

// Fallback en memoria para navegadores que bloquean localStorage en iframes (Safari ITP, etc.)
const _mem = {};

function _set(key, value) {
    try { localStorage.setItem(key, value); } catch { _mem[key] = value; }
}

function _get(key) {
    try {
        const v = localStorage.getItem(key);
        if (v !== null) return v;
    } catch { /* bloqueado */ }
    return _mem[key] ?? null;
}

function _remove(key) {
    try { localStorage.removeItem(key); } catch { /* bloqueado */ }
    delete _mem[key];
}

function _clearAllAuthKeys() {
    _remove(TOKEN_KEY);
    _remove(REFRESH_KEY);
    _remove(EXPIRES_AT_KEY);
    _remove(USER_KEY);
    _remove(LAST_ACTIVE_KEY);
}

// ---------------------------------------------------------------------------
// Token storage
// ---------------------------------------------------------------------------

function _saveTokens({ access_token, refresh_token, expires_in }) {
    _set(TOKEN_KEY, access_token);
    if (refresh_token) _set(REFRESH_KEY, refresh_token);
    if (expires_in)    _set(EXPIRES_AT_KEY, (Date.now() + (expires_in - 60) * 1000).toString());
}

export function getToken() {
    return _get(TOKEN_KEY);
}

export function getRefreshToken() {
    return _get(REFRESH_KEY);
}

// ---------------------------------------------------------------------------
// Refresh token flow (con lock para evitar refreshes concurrentes)
// ---------------------------------------------------------------------------

let _refreshInFlight = null;

export async function refreshAccessToken() {
    if (_refreshInFlight) return _refreshInFlight;

    _refreshInFlight = (async () => {
        const refreshToken = getRefreshToken();
        if (!refreshToken) throw new Error('no-refresh-token');

        const res = await fetch(`${CONFIG.BACKEND_BASE_URL}/auth/refresh`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ refresh_token: refreshToken }),
        });

        if (!res.ok) {
            _clearAllAuthKeys();
            throw new Error('refresh-failed');
        }

        const payload = await res.json();
        _saveTokens(payload);
        console.info('[auth] refreshed silently');
        return payload.access_token;
    })().finally(() => { _refreshInFlight = null; });

    return _refreshInFlight;
}

/**
 * If the access token expires within 60 s, proactively refreshes it before
 * the next request. Reduces 401s at token-expiry boundaries.
 */
export async function shouldRefreshSoon() {
    const expiresAt = parseInt(_get(EXPIRES_AT_KEY) ?? '0', 10);
    if (!expiresAt) return;
    if (Date.now() > expiresAt - 60_000) {
        await refreshAccessToken().catch(() => {});
    }
}

// ---------------------------------------------------------------------------
// Inactividad: el token se invalida localmente si no hay actividad en 24h
// ---------------------------------------------------------------------------

export function touchActivity() {
    _set(LAST_ACTIVE_KEY, Date.now().toString());
}

function _expireIfInactive() {
    const raw = _get(LAST_ACTIVE_KEY);
    if (!raw) return false; // sesión recién iniciada, no expirar
    if (Date.now() - parseInt(raw, 10) <= INACTIVITY_MS) return false;

    console.info('[auth] Sesión expirada por inactividad (24h).');
    _clearAllAuthKeys();
    return true;
}

function _installActivityTracking() {
    if (typeof window === 'undefined') return;

    let _lastWrite = 0;
    function _onActivity() {
        const now = Date.now();
        if (now - _lastWrite < 60_000) return; // throttle: máx 1 escritura/min
        _lastWrite = now;
        _set(LAST_ACTIVE_KEY, now.toString());
    }
    ['click', 'keydown', 'mousemove', 'scroll', 'touchstart'].forEach(ev =>
        window.addEventListener(ev, _onActivity, { passive: true })
    );

    // Cada 5 min: chequear inactividad y hacer refresh proactivo antes de que expire
    setInterval(() => {
        if (_expireIfInactive()) {
            if (!IS_DEV) window.location.href = _buildAuthUrl();
            return;
        }
        const expiresAt = parseInt(_get(EXPIRES_AT_KEY) ?? '0', 10);
        if (expiresAt && Date.now() > expiresAt - 120_000) {
            refreshAccessToken().catch(() => {
                console.warn('[auth] refresh failed, logging out.');
                if (!IS_DEV) window.location.href = _buildAuthUrl();
            });
        }
    }, 5 * 60 * 1000);
}

// ---------------------------------------------------------------------------

export function getCachedUser() {
    const raw = _get(USER_KEY);
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

function _saveUser(user) {
    _set(USER_KEY, JSON.stringify(user));
}

function _redirectUri() {
    return window.location.origin + '/app/';
}

function _buildAuthUrl() {
    const params = new URLSearchParams({
        response_type: 'code',
        client_id:     CONFIG.NEXTCLOUD_OAUTH_CLIENT_ID,
        redirect_uri:  _redirectUri(),
    });
    return `${CONFIG.NEXTCLOUD_URL}/index.php/apps/oauth2/authorize?${params}`;
}

async function _exchangeCode(code) {
    const res = await fetch(`${CONFIG.BACKEND_BASE_URL}/auth/callback`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code, redirect_uri: _redirectUri() }),
    });
    if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
    return res.json(); // {access_token, refresh_token, expires_in}
}

async function _fetchUserInfo(token) {
    const res = await fetch(`${CONFIG.BACKEND_BASE_URL}/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`User info failed: ${res.status}`);
    return res.json();
}

// Modo DEV: redirect_uri apunta a producción, así que no forzamos el flujo OAuth.
// Usar window.__setDevToken("token") para trabajar localmente con token real.
const IS_DEV = typeof import.meta !== 'undefined' && import.meta.env?.DEV === true;

function _installDevHelpers() {
    if (!IS_DEV || typeof window === 'undefined') return;
    window.__setDevToken = (token) => {
        if (!token) { _clearAllAuthKeys(); console.info('[auth] Token dev borrado.'); return; }
        _set(TOKEN_KEY, token);
        _remove(USER_KEY);
        console.info('[auth] Token dev guardado. Recarga la página.');
    };
    window.__clearDevAuth = () => { _clearAllAuthKeys(); console.info('[auth] Auth dev limpiada.'); };
}

export async function initAuth() {
    _installDevHelpers();

    if (!CONFIG.NEXTCLOUD_OAUTH_CLIENT_ID) {
        return null;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const code      = urlParams.get('code');

    if (code) {
        // Nuevo login: guardar todos los tokens y resetear el reloj de inactividad
        window.history.replaceState({}, '', window.location.pathname);
        const payload = await _exchangeCode(code);
        _saveTokens(payload);
        touchActivity();
    }

    // Verificar inactividad antes de usar el token almacenado
    if (_expireIfInactive()) {
        if (!IS_DEV) window.location.href = _buildAuthUrl();
        return null;
    }

    const token = getToken();
    if (!token) {
        if (IS_DEV) {
            console.warn(
                '[auth] Sin token en modo DEV. No se redirige al OAuth porque el redirect_uri\n' +
                'registrado apunta a producción. Opciones:\n' +
                '  1) Trabajar sin backend (modo offline).\n' +
                '  2) Pegar un token real: abre producción, copia localStorage.nc_access_token\n' +
                '     y ejecuta: __setDevToken("TU_TOKEN") en la consola.'
            );
            return null;
        }
        window.location.href = _buildAuthUrl();
        return null;
    }

    let user = getCachedUser();
    if (!user) {
        try {
            user = await _fetchUserInfo(token);
            const words   = (user.displayname || user.id || '').trim().split(/\s+/);
            user.initials = words.map(w => w[0]).join('').slice(0, 2).toUpperCase();
            _saveUser(user);
        } catch (err) {
            if (IS_DEV) {
                console.warn('[auth] Token dev inválido o backend inalcanzable:', err.message);
                _remove(TOKEN_KEY);
                return null;
            }
            // Ambos tokens fallaron: limpiar sesión y forzar re-login
            _clearAllAuthKeys();
            window.location.href = _buildAuthUrl();
            return null;
        }
    }

    _installActivityTracking();
    return user;
}

export function logout() {
    _clearAllAuthKeys();
    // Drop weekly IndexedDB so the next user doesn't see the previous one's data.
    // Fire-and-forget: the redirect below races the async clear, but per-user
    // keys (`weekly:*:${userId}`) already prevent leakage across accounts.
    pcClear('weekly:').catch(() => {});
    // Drop the in-memory calendar events cache (synchronous — runs before redirect).
    clearCalendarCache();
    if (IS_DEV) {
        console.warn('[auth] logout() en DEV: no se redirige al OAuth de producción. Recarga manualmente.');
        return;
    }
    window.location.href = _buildAuthUrl();
}
