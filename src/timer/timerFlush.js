/** Flush active timers to backend via sendBeacon — safe for beforeunload and pre-logout. */

import { STATE }     from '../core/state.js';
import { CONFIG }    from '../core/config.js';
import { getToken }  from '../auth/auth.js';

function _isActivity(taskId) {
    return STATE.tasks.find(t => t.id === taskId)?.type === 'activity';
}

/**
 * Sends accumulated time for every active timer using navigator.sendBeacon.
 * sendBeacon survives page unloads and redirects; no async needed.
 * Token is passed as query param since sendBeacon cannot set custom headers.
 */
export function flushActiveTimers() {
    if (!CONFIG.BACKEND_URL || !navigator.sendBeacon) return;
    const token = getToken();
    if (!token) return;

    for (const [, timer] of Object.entries(STATE.timers)) {
        if (!timer) continue;
        const { taskId, subtaskId, startTime, sessionStart } = timer;
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        if (elapsed <= 0) continue;

        const task = STATE.tasks.find(t => t.id === taskId);
        const absoluteTime = (task?.timeSpent ?? 0) + elapsed;
        const path = _isActivity(taskId)
            ? `/activities/${taskId}/time`
            : `/tareas/${taskId}/time`;

        const url  = `${CONFIG.BACKEND_URL}${path}?token=${encodeURIComponent(token)}`;
        const body = new Blob([JSON.stringify({
            timeSpent:   elapsed,
            subtaskId:   subtaskId === 'none' ? null : subtaskId,
            feedback:    null,
            absoluteTime,
            startAt:     sessionStart ? new Date(sessionStart).toISOString() : null,
        })], { type: 'application/json' });

        navigator.sendBeacon(url, body);
    }
}
