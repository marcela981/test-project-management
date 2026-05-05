/** Cliente HTTP para exportación de reportes de rendimiento. */

import { CONFIG } from '../core/config.js';
import { getToken, refreshAccessToken, logout } from '../auth/auth.js';
import { flushActiveTimers } from '../timer/timerFlush.js';

const EXPORT_URL = `${CONFIG.BACKEND_BASE_URL}/api/v1/reports/performance/export`;

/**
 * POST al endpoint de exportación y retorna { blob, filename }.
 * Maneja refresh silencioso de token (mismo patrón que api.js / timeLogs.js).
 *
 * @param {object} request   - Body de la petición (filtros, rango de fechas, etc.)
 * @param {AbortSignal} [signal] - Para cancelar la descarga vía AbortController
 * @returns {Promise<{ blob: Blob, filename: string }>}
 */
export async function exportPerformanceReport(request, signal) {
    const doFetch = (token) => fetch(EXPORT_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(request),
        signal,
    });

    let res = await doFetch(getToken());

    if (res.status === 401) {
        try {
            const newToken = await refreshAccessToken();
            res = await doFetch(newToken);
        } catch {
            flushActiveTimers();
            logout();
            throw new Error('Session expired — please log in again.');
        }

        if (res.status === 401) {
            flushActiveTimers();
            logout();
            throw new Error('Session expired — please log in again.');
        }
    }

    if (!res.ok) {
        let message = `Error ${res.status}`;
        try {
            const body = await res.json();
            message = body.detail ?? body.message ?? message;
        } catch { /* keep default */ }
        const err = new Error(message);
        err.status = res.status;
        throw err;
    }

    const blob = await res.blob();

    const disposition = res.headers.get('Content-Disposition') ?? '';
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match?.[1] ?? `gcf-performance-${Date.now()}.xlsx`;

    return { blob, filename };
}

/**
 * Dispara la descarga del blob en el browser sin navegar fuera de la SPA.
 *
 * @param {Blob}   blob
 * @param {string} filename
 */
export function triggerBrowserDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
