/** Capa de datos del weekly tracker: llamadas REST a /api/weekly. */

import { startOfDay, getDay, subDays, addDays, format } from 'date-fns';
import { expandBlocks } from '../calendar/recurrence/rrule-expander.js';
import { CONFIG } from '../core/config.js';
import { getToken, logout } from '../auth/auth.js';

const WEEKLY_API = `${CONFIG.BACKEND_BASE_URL}/api/weekly`;

// Estado en memoria (última respuesta del backend).
let _cachedPreferences = null;
let _cachedBlocks      = [];
let _currentWeekStart  = null;

// ── HTTP helper ──────────────────────────────────────────────────────────────

async function _apiFetch(path, options = {}) {
    const token = getToken();
    const res = await fetch(`${WEEKLY_API}${path}`, {
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...options,
    });

    if (res.status === 401) { logout(); return null; }

    if (!res.ok) {
        let msg = `API ${res.status}`;
        try {
            const err = await res.json();
            if (err?.detail) msg = err.detail;
        } catch (_) { /* body no JSON */ }
        throw new Error(msg);
    }

    const text = await res.text();
    return text ? JSON.parse(text) : {};
}

// ── Preferences ──────────────────────────────────────────────────────────────

export async function fetchPreferences() {
    try {
        const p = await _apiFetch('/preferences');
        if (p) _cachedPreferences = p;
    } catch (e) {
        console.error('[weekly] fetchPreferences:', e);
    }
    return _cachedPreferences ?? { week_start_day: 1, week_end_day: 5 };
}

export function getPreferences() {
    return _cachedPreferences ?? { week_start_day: 1, week_end_day: 5 };
}

export async function savePreferences(prefs) {
    try {
        const saved = await _apiFetch('/preferences', {
            method: 'PUT',
            body: JSON.stringify(prefs),
        });
        if (saved) _cachedPreferences = saved;
        window.dispatchEvent(new CustomEvent('preferences-updated', { detail: _cachedPreferences }));
    } catch (e) {
        console.error('[weekly] savePreferences:', e);
        alert(`No se pudieron guardar las preferencias: ${e.message}`);
    }
}

// ── Blocks ───────────────────────────────────────────────────────────────────

export async function fetchBlocks(weekStartIsoDate) {
    _currentWeekStart = weekStartIsoDate;
    try {
        const list = await _apiFetch(`/blocks?week_start=${weekStartIsoDate}`);
        if (!Array.isArray(list)) { _cachedBlocks = []; return _cachedBlocks; }

        const normalized = list.map(_normalizeBlock);

        // Split master rrule blocks (template only) from concrete/virtual blocks
        const masters  = normalized.filter(b => b.is_master && b.rrule_string);
        const concrete = normalized.filter(b => !b.is_master);

        // Expand masters client-side for the displayed week
        const prefs    = getPreferences();
        const weekDays = getWeekDays(weekStartIsoDate, prefs);
        const virtual  = expandBlocks(masters, weekDays[0], weekDays[weekDays.length - 1]);

        _cachedBlocks = [...concrete, ...virtual.map(_normalizeBlock)];
    } catch (e) {
        console.error('[weekly] fetchBlocks:', e);
        _cachedBlocks = [];
    }
    return _cachedBlocks;
}

export function getBlocks() {
    return _cachedBlocks;
}

export function getCurrentWeekStart() {
    return _currentWeekStart;
}

export async function createBlock(block) {
    try {
        const saved = await _apiFetch('/blocks', {
            method: 'POST',
            body: JSON.stringify(block),
        });
        if (!saved) return null;
        const norm = _normalizeBlock(saved);
        _cachedBlocks.push(norm);
        return norm;
    } catch (e) {
        console.error('[weekly] createBlock:', e);
        alert(`No se pudo crear el bloque: ${e.message}`);
        return null;
    }
}

export async function updateBlock(blockId, updates, scope = null) {
    try {
        const body = scope ? { ...updates, scope } : updates;
        const saved = await _apiFetch(`/blocks/${blockId}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
        });
        if (!saved) return null;
        const norm = _normalizeBlock(saved);
        const idx = _cachedBlocks.findIndex(b => b.id === blockId);
        if (idx !== -1) _cachedBlocks[idx] = norm;
        return norm;
    } catch (e) {
        console.error('[weekly] updateBlock:', e);
        alert(`No se pudo actualizar el bloque: ${e.message}`);
        return null;
    }
}

export async function removeBlock(blockId, scope = null) {
    try {
        const path = scope ? `/blocks/${blockId}?scope=${scope}` : `/blocks/${blockId}`;
        await _apiFetch(path, { method: 'DELETE' });
        _cachedBlocks = _cachedBlocks.filter(b => b.id !== blockId);
        return true;
    } catch (e) {
        console.error('[weekly] removeBlock:', e);
        alert(`No se pudo eliminar el bloque: ${e.message}`);
        return false;
    }
}

function _normalizeBlock(b) {
    return {
        id:               String(b.id),
        week_start:       b.week_start,
        day:              b.day_of_week  ?? b.day,
        block_type:       b.block_type,
        task_id:          b.task_id          ?? null,
        activity_id:      b.activity_id      ?? null,
        title:            b.title            ?? '',
        color:            b.color            ?? null,
        start_time:       _trimTime(b.start_time),
        end_time:         _trimTime(b.end_time),
        notes:            b.notes            ?? null,
        priority:         b.priority         ?? null,
        column_status:    b.column_status    ?? null,
        item_type:        b.item_type        ?? null,
        is_virtual:       b.is_virtual       ?? false,
        is_master:        b.is_master        ?? false,
        series_id:        b.series_id        ?? null,
        recurrence:       b.recurrence       ?? null,
        recurrence_until: b.recurrence_until ?? null,
        // RRule fields
        rrule_string:     b.rrule_string     ?? null,
        dtstart:          b.dtstart          ?? null,
        exception_dates:  b.exception_dates  ?? [],
        parent_block_id:  b.parent_block_id  ?? null,
    };
}

function _trimTime(t) {
    if (!t) return '';
    // Backend devuelve "HH:MM:SS"; la UI trabaja en "HH:MM".
    return String(t).slice(0, 5);
}

// ── Helpers puros ────────────────────────────────────────────────────────────

export function getWeekDays(referenceDate, prefs) {
    const { week_start_day, week_end_day } = prefs;
    const date     = startOfDay(new Date(referenceDate));
    const daysBack = (getDay(date) - week_start_day + 7) % 7;
    let cur        = subDays(date, daysBack);
    const days     = [];
    for (let i = 0; i < 7; i++) {
        days.push(cur);
        if (getDay(cur) === week_end_day) break;
        cur = addDays(cur, 1);
    }
    return days;
}

export function weekStartIso(referenceDate, prefs) {
    return format(getWeekDays(referenceDate, prefs)[0], 'yyyy-MM-dd');
}

export function timeToMinutes(t) {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
}

export function blockDurationH(block) {
    const mins = timeToMinutes(block.end_time) - timeToMinutes(block.start_time);
    return +(mins / 60).toFixed(1);
}

export function dayHours(blocks, dayOfWeek) {
    return blocks
        .filter(b => b.day === dayOfWeek)
        .reduce((sum, b) => sum + blockDurationH(b), 0);
}

export function hasOverlap(blocks, newBlock, excludeId = null) {
    const ns = timeToMinutes(newBlock.start_time);
    const ne = timeToMinutes(newBlock.end_time);
    return blocks.some(b => {
        if (b.id === excludeId) return false;
        if (b.day !== newBlock.day) return false;
        const bs = timeToMinutes(b.start_time);
        const be = timeToMinutes(b.end_time);
        return ns < be && ne > bs;
    });
}
