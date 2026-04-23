/** OAuth2 con Nextcloud: token en localStorage (persiste entre refreshes en iframes). */

import { CONFIG } from '../core/config.js';

const TOKEN_KEY       = 'nc_access_token';
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

// ---------------------------------------------------------------------------
// Inactividad: el token se invalida localmente si no hay actividad en 24h
// ---------------------------------------------------------------------------

/** Registra actividad del usuario (llamar desde listeners de ventana). */
export function touchActivity() {
    _set(LAST_ACTIVE_KEY, Date.now().toString());
}

/** Devuelve true y limpia la sesión si han pasado más de 24h sin actividad. */
function _expireIfInactive() {
    const raw = _get(LAST_ACTIVE_KEY);
    if (!raw) return false; // sesión recién iniciada, no expirar
    if (Date.now() - parseInt(raw, 10) <= INACTIVITY_MS) return false;

    console.info('[auth] Sesión expirada por inactividad (24h).');
    _remove(TOKEN_KEY);
    _remove(USER_KEY);
    _remove(LAST_ACTIVE_KEY);
    return true;
}

/** Instala listeners de actividad de ventana y un chequeo periódico. */
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

    // Chequeo periódico: si la pestaña queda abierta sin actividad
    setInterval(() => {
        if (_expireIfInactive() && !IS_DEV) window.location.href = _buildAuthUrl();
    }, 5 * 60 * 1000); // cada 5 minutos
}

// ---------------------------------------------------------------------------

export function getToken() {
    return _get(TOKEN_KEY);
}

function _saveToken(token) {
    _set(TOKEN_KEY, token);
}

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
    const { access_token } = await res.json();
    return access_token;
}

async function _fetchUserInfo(token) {
    const res = await fetch(`${CONFIG.BACKEND_BASE_URL}/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`User info failed: ${res.status}`);
    return res.json();
}

// Modo DEV: en Vite dev server no queremos forzar el redirect OAuth porque el
// redirect_uri registrado apunta a producción (portal.gcf.group/app/). En su
// lugar se expone `window.__setDevToken(token)` para pegar un token real
// obtenido en producción y así trabajar localmente contra el backend real.
const IS_DEV = typeof import.meta !== 'undefined' && import.meta.env?.DEV === true;

function _installDevHelpers() {
    if (!IS_DEV || typeof window === 'undefined') return;
    window.__setDevToken = (token) => {
        if (!token) { _remove(TOKEN_KEY); _remove(USER_KEY); console.info('[auth] Token dev borrado.'); return; }
        _set(TOKEN_KEY, token);
        _remove(USER_KEY);
        console.info('[auth] Token dev guardado. Recarga la página.');
    };
    window.__clearDevAuth = () => { _remove(TOKEN_KEY); _remove(USER_KEY); console.info('[auth] Auth dev limpiada.'); };
}

export async function initAuth() {
    _installDevHelpers();

    if (!CONFIG.NEXTCLOUD_OAUTH_CLIENT_ID) {
        return null;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const code      = urlParams.get('code');

    if (code) {
        // Nuevo login: resetear el reloj de inactividad
        window.history.replaceState({}, '', window.location.pathname);
        const token = await _exchangeCode(code);
        _saveToken(token);
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
            throw err;
        }
    }

    _installActivityTracking();
    return user;
}

export function logout() {
    _remove(TOKEN_KEY);
    _remove(USER_KEY);
    _remove(LAST_ACTIVE_KEY);
    if (IS_DEV) {
        console.warn('[auth] logout() en DEV: no se redirige al OAuth de producción. Recarga manualmente.');
        return;
    }
    window.location.href = _buildAuthUrl();
}
