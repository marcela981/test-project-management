/** Persistencia en localStorage (clave dashboard_tasks_v2). */

import { STATE } from './state.js';

const STORAGE_KEY = 'dashboard_tasks_v2';

export function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE.tasks));
}

export function load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
        STATE.tasks = JSON.parse(raw);
    } catch {
        STATE.tasks = [];
    }
}

export function clear() {
    localStorage.removeItem(STORAGE_KEY);
    STATE.tasks = [];
}

const TIMER_KEY = 'dashboard_timers_v1';

export function saveTimers() {
    const toSave = {};
    for (const [type, timer] of Object.entries(STATE.timers)) {
        if (timer) {
            const { intervalId, ...data } = timer; // intervalId no es serializable
            toSave[type] = data;
        }
    }
    localStorage.setItem(TIMER_KEY, JSON.stringify(toSave));
}

export function loadTimerData() {
    const raw = localStorage.getItem(TIMER_KEY);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        localStorage.removeItem(TIMER_KEY);
        return null;
    }
}
