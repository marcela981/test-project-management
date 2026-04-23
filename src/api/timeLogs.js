/** CRUD de time_logs con idempotencia, cola local y reintentos. */

import { CONFIG } from '../core/config.js';
import { getToken, logout } from '../auth/auth.js';
import { generateId } from '../shared/utils.js';
import { flushActiveTimers } from '../timer/timerFlush.js';

const PENDING_OPS_KEY = 'pendingTimeOps';
const RETRY_DELAYS = [500, 1500, 3000];

// ── Cola de operaciones pendientes (localStorage) ────────────────────────────

function getPendingOps() {
    try {
        const ops = localStorage.getItem(PENDING_OPS_KEY);
        return ops ? JSON.parse(ops) : [];
    } catch {
        return [];
    }
}

function savePendingOps(ops) {
    try { localStorage.setItem(PENDING_OPS_KEY, JSON.stringify(ops)); }
    catch { /* bloqueado */ }
}

function addPendingOp(op) {
    const ops = getPendingOps();
    ops.push({ ...op, enqueuedAt: Date.now() });
    savePendingOps(ops);
}

function removePendingOp(clientOpId) {
    savePendingOps(getPendingOps().filter(o => o.clientOpId !== clientOpId));
}

// ── Fetch con reintentos y manejo de 401 ─────────────────────────────────────

const wait = (ms) => new Promise(res => setTimeout(res, ms));

async function fetchWithRetry(url, options, clientOpId = null, retries = 3) {
    let attempt = 0;

    while (attempt <= retries) {
        try {
            const token = getToken();
            const headers = {
                'Content-Type': 'application/json',
                ...options.headers,
            };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const response = await fetch(url, { ...options, headers });

            if (response.status === 401) {
                console.warn('[timeLogs] 401 Unauthorized, re-authenticating...');
                flushActiveTimers();
                logout();
                return null;
            }

            if (response.status === 409) {
                // Conflicto de negocio (log duplicado); no reintentar.
                if (clientOpId) removePendingOp(clientOpId);
                const err = await response.json().catch(() => ({}));
                const e = new Error(err.detail || 'Conflict');
                e.code = 409;
                throw e;
            }

            if (response.status >= 500) throw new Error(`Server ${response.status}`);

            if (!response.ok) {
                if (clientOpId) removePendingOp(clientOpId);
                const err = await response.json().catch(() => ({}));
                throw new Error(err.detail || `Request failed ${response.status}`);
            }

            if (clientOpId) removePendingOp(clientOpId);
            const text = await response.text();
            return text ? JSON.parse(text) : {};

        } catch (error) {
            if (error.code === 409) throw error;
            if (attempt === retries) throw error;
            console.warn(`[timeLogs] Attempt ${attempt + 1}/${retries + 1} for ${url}: ${error.message}`);
            await wait(RETRY_DELAYS[attempt] ?? 3000);
            attempt++;
        }
    }
    return null;
}

// ── Helpers URL ──────────────────────────────────────────────────────────────

function entityLogsUrl(entityId, isActivity) {
    const entityPath = isActivity ? 'activities' : 'tareas';
    return `${CONFIG.BACKEND_URL}/${entityPath}/${entityId}/time-logs`;
}

function singleLogUrl(logId) {
    return `${CONFIG.BACKEND_URL}/time-logs/${logId}`;
}

// ── API pública ──────────────────────────────────────────────────────────────

export async function fetchTimeLogs(entityId, isActivity) {
    if (!CONFIG.BACKEND_URL) return [];
    try {
        const res = await fetchWithRetry(entityLogsUrl(entityId, isActivity), { method: 'GET' }, null, 1);
        return Array.isArray(res) ? res : [];
    } catch (e) {
        console.error('[timeLogs] Error fetching:', e);
        return [];
    }
}

export async function createTimeLog(entityId, isActivity, { logDate, seconds }) {
    if (!CONFIG.BACKEND_URL) return null;
    const clientOpId = generateId('op');
    const url = entityLogsUrl(entityId, isActivity);
    const body = { logDate, seconds, clientOpId };

    addPendingOp({ type: 'CREATE', url, body, clientOpId });

    return fetchWithRetry(url, {
        method: 'POST',
        body: JSON.stringify(body),
    }, clientOpId);
}

export async function updateTimeLog(logId, seconds) {
    if (!CONFIG.BACKEND_URL) return null;
    const clientOpId = generateId('op');
    const url = singleLogUrl(logId);
    const body = { seconds, clientOpId };

    addPendingOp({ type: 'UPDATE', url, body, clientOpId });

    return fetchWithRetry(url, {
        method: 'PATCH',
        body: JSON.stringify(body),
    }, clientOpId);
}

export async function deleteTimeLog(logId) {
    if (!CONFIG.BACKEND_URL) return null;
    const clientOpId = generateId('op');
    const url = `${singleLogUrl(logId)}?clientOpId=${clientOpId}`;

    addPendingOp({ type: 'DELETE', url, body: null, clientOpId });

    return fetchWithRetry(url, { method: 'DELETE' }, clientOpId);
}

/**
 * Reintentar operaciones que quedaron en cola (cierre abrupto / token expirado).
 * Llamar en el init de la app después de autenticar.
 */
export async function drainPendingTimeOps() {
    const ops = getPendingOps();
    if (!ops.length) return;

    console.info(`[timeLogs] Draining ${ops.length} pending ops...`);
    for (const op of ops) {
        try {
            await fetchWithRetry(op.url, {
                method: op.type === 'CREATE' ? 'POST'
                      : op.type === 'UPDATE' ? 'PATCH'
                      : 'DELETE',
                body: op.body ? JSON.stringify(op.body) : undefined,
            }, op.clientOpId, 1);
        } catch (e) {
            if (e.code === 409) {
                // El log ya existía: la operación original debió fallar
                // pero el servidor quedó consistente → limpiar.
                removePendingOp(op.clientOpId);
            } else {
                console.error(`[timeLogs] Drain failed for ${op.clientOpId}:`, e.message);
            }
        }
    }
}
