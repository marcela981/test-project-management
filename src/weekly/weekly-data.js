/** Capa de datos del weekly tracker: llamadas REST a /api/weekly. */

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
        _cachedBlocks = Array.isArray(list) ? list.map(_normalizeBlock) : [];
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

export async function updateBlock(blockId, updates) {
    try {
        const saved = await _apiFetch(`/blocks/${blockId}`, {
            method: 'PATCH',
            body: JSON.stringify(updates),
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

export async function removeBlock(blockId) {
    try {
        await _apiFetch(`/blocks/${blockId}`, { method: 'DELETE' });
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
        id:            b.id,
        week_start:    b.week_start,
        day:           b.day_of_week,
        block_type:    b.block_type,
        task_id:       b.task_id ?? null,
        activity_id:   b.activity_id ?? null,
        title:         b.title ?? '',
        color:         b.color ?? null,
        start_time:    _trimTime(b.start_time),
        end_time:      _trimTime(b.end_time),
        notes:         b.notes ?? null,
        priority:      b.priority ?? null,
        column_status: b.column_status ?? null,
        item_type:     b.item_type ?? null,
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
    const date = new Date(referenceDate);
    date.setHours(0, 0, 0, 0);

    const daysBack = (date.getDay() - week_start_day + 7) % 7;
    const start = new Date(date);
    start.setDate(date.getDate() - daysBack);

    const days = [];
    const cur = new Date(start);
    for (let i = 0; i < 7; i++) {
        days.push(new Date(cur));
        if (cur.getDay() === week_end_day) break;
        cur.setDate(cur.getDate() + 1);
    }
    return days;
}

export function weekStartIso(referenceDate, prefs) {
    const d = getWeekDays(referenceDate, prefs)[0];
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
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
