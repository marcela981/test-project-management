/** Capa de datos del weekly tracker: llamadas REST a /api/weekly. */

import { startOfDay, getDay, subDays, addDays, format } from 'date-fns';
import { formatInUserTz } from '../lib/time';
import { expandBlocks } from '../calendar/recurrence/rrule-expander.js';
import { getCachedUser } from '../auth/auth.js';
import { pcGet, pcSet, pcDelete } from '../core/persistent-cache.js';
import { apiFetch } from '../api/http.js';

// Estado en memoria (última respuesta del backend).
let _cachedPreferences = null;
let _currentWeekStart  = null;

// In-memory mirror of the IndexedDB cache so synchronous helpers like
// `getBlocks()` and `isBlocksCacheWarm()` keep working without async access.
const _memBlocks = new Map(); // weekStartIso → { blocks: [], fetchedAt: number }

const BLOCKS_FRESH_MS = 30_000;          // beyond this we revalidate in the background
const BLOCKS_TTL_MS   = 30_000;          // IDB lifetime (matches existing behaviour)
const PREFS_TTL_MS    = 5 * 60_000;      // 5 min — same as PREFS_CACHE_TTL_MS in weekly.js

// Dedup of in-flight network revalidations (one per week).
const _inFlightBlocks = new Map();
let   _inFlightPrefs  = null;

// Session-scoped singleton promise for fetchPreferences (see getPrefsOnce).
let _prefsPromise = null;

// ── Cache key helpers ────────────────────────────────────────────────────────

function _userId() {
    try {
        const u = getCachedUser?.();
        return u?.id ?? 'anon';
    } catch { return 'anon'; }
}

function _blocksKey(weekIso) { return `weekly:blocks:${_userId()}:${weekIso}`; }
function _prefsKey()         { return `weekly:prefs:${_userId()}`; }

// ── Preferences ──────────────────────────────────────────────────────────────

async function _fetchPrefsFromNetwork() {
    if (_inFlightPrefs) return _inFlightPrefs;
    _inFlightPrefs = (async () => {
        try {
            const p = await apiFetch('/api/weekly/preferences');
            if (p) {
                _cachedPreferences = p;
                pcSet(_prefsKey(), p, PREFS_TTL_MS).catch(() => {});
            }
        } catch (e) {
            console.error('[weekly] fetchPreferences:', e);
        } finally {
            _inFlightPrefs = null;
        }
        return _cachedPreferences ?? { week_start_day: 1, week_end_day: 5 };
    })();
    return _inFlightPrefs;
}

export async function fetchPreferences() {
    if (_cachedPreferences) return _cachedPreferences;

    const idbHit = await pcGet(_prefsKey());
    if (idbHit) {
        _cachedPreferences = idbHit;
        _fetchPrefsFromNetwork().catch(() => {}); // SWR
        return idbHit;
    }

    return await _fetchPrefsFromNetwork();
}

/**
 * Session-scoped singleton: ensures fetchPreferences() runs at most once per
 * page load even when invoked from multiple call sites (calendar-router,
 * weekly view, etc). Subsequent calls reuse the resolved promise instantly.
 */
export function getPrefsOnce() {
    if (!_prefsPromise) _prefsPromise = fetchPreferences();
    return _prefsPromise;
}

export function getPreferences() {
    return _cachedPreferences ?? { week_start_day: 1, week_end_day: 5 };
}

export async function savePreferences(prefs) {
    try {
        const saved = await apiFetch('/api/weekly/preferences', {
            method: 'PUT',
            body: JSON.stringify(prefs),
        });
        if (saved) {
            _cachedPreferences = saved;
            // Reset session singleton so future getPrefsOnce calls reflect the
            // fresh value (the resolved promise above still holds the old one).
            _prefsPromise = Promise.resolve(saved);
            pcSet(_prefsKey(), saved, PREFS_TTL_MS).catch(() => {});
        }
        window.dispatchEvent(new CustomEvent('preferences-updated', { detail: _cachedPreferences }));
    } catch (e) {
        console.error('[weekly] savePreferences:', e);
        alert(`No se pudieron guardar las preferencias: ${e.message}`);
    }
}

// ── Blocks ───────────────────────────────────────────────────────────────────

async function _fetchBlocksFromNetwork(weekStartIsoDate) {
    // Fetch manual/recurrence blocks and time-log entries in parallel.
    const [list, unifiedList] = await Promise.all([
        apiFetch(`/api/weekly/blocks?week_start=${weekStartIsoDate}`),
        apiFetch(`/api/weekly/unified?week_start=${weekStartIsoDate}&_t=${Date.now()}`).catch(err => { console.error('[weekly] /unified failed:', err); return []; }),
    ]);
    if (!Array.isArray(list)) return [];

    const normalized = list.map(_normalizeBlock);

    // Split master rrule blocks (template only) from concrete/virtual blocks
    const masters  = normalized.filter(b => b.is_master && b.rrule_string);
    const concrete = normalized.filter(b => !b.is_master);

    // Expand masters client-side for the displayed week.
    // Parse weekStartIsoDate as LOCAL midnight (not UTC) to avoid a one-day
    // shift in UTC-N timezones where new Date("YYYY-MM-DD") → UTC midnight.
    const prefs    = getPreferences();
    const [_y, _m, _d] = weekStartIsoDate.split('-').map(Number);
    const weekDays = getWeekDays(new Date(_y, _m - 1, _d), prefs);
    const virtual  = expandBlocks(masters, weekDays[0], weekDays[weekDays.length - 1]);

    // Merge time-log blocks from /unified (source=task|activity only;
    // source=manual would duplicate what /blocks already returns).
    const logBlocks = Array.isArray(unifiedList)
        ? unifiedList
            .filter(b => b.source === 'task' || b.source === 'activity')
            .map(b => _normalizeLogBlock(b, weekStartIsoDate))
        : [];

    // DEBUG — remove before merge (enable with ?debug=weekly in URL)
    if (_debugWeekly()) {
        console.log('[weekly-data] fetchBlocks incoming:', list.length, '| masters:', masters.length, '| concrete:', concrete.length, '| virtual:', virtual.length, '| logs:', logBlocks.length);
        if (masters.length > 0) console.log('[weekly-data]   first master to expand:', JSON.stringify(masters[0]));
        if (virtual.length > 0) {
            const v = virtual[0];
            console.log('[weekly-data]   first virtual generated:', { id: v.id, day: v.day, start_time: v.start_time, week_start: v.week_start });
        }
    }

    return [...concrete, ...virtual.map(_normalizeBlock), ...logBlocks];
}

function _refreshBlocks(weekStartIsoDate) {
    if (_inFlightBlocks.has(weekStartIsoDate)) {
        return _inFlightBlocks.get(weekStartIsoDate);
    }
    const p = (async () => {
        try {
            const result = await _fetchBlocksFromNetwork(weekStartIsoDate);
            const entry  = { blocks: result, fetchedAt: Date.now() };
            _memBlocks.set(weekStartIsoDate, entry);
            pcSet(_blocksKey(weekStartIsoDate), entry, BLOCKS_TTL_MS).catch(() => {});
            return result;
        } catch (e) {
            console.error('[weekly] fetchBlocks:', e);
            const entry = { blocks: [], fetchedAt: Date.now() };
            _memBlocks.set(weekStartIsoDate, entry);
            return [];
        } finally {
            _inFlightBlocks.delete(weekStartIsoDate);
        }
    })();
    _inFlightBlocks.set(weekStartIsoDate, p);
    return p;
}

export async function fetchBlocks(weekStartIsoDate) {
    _currentWeekStart = weekStartIsoDate;

    // 1) In-memory mirror (same session, possibly stale → SWR)
    const mem = _memBlocks.get(weekStartIsoDate);
    if (mem) {
        if ((Date.now() - mem.fetchedAt) >= BLOCKS_FRESH_MS) {
            _refreshBlocks(weekStartIsoDate).catch(() => {});
        }
        return mem.blocks;
    }

    // 2) IndexedDB (cross-session warm load) — return cached, revalidate in bg
    const idbHit = await pcGet(_blocksKey(weekStartIsoDate));
    if (idbHit?.blocks) {
        _memBlocks.set(weekStartIsoDate, idbHit);
        _refreshBlocks(weekStartIsoDate).catch(() => {});
        return idbHit.blocks;
    }

    // 3) Cold — block on the network
    return await _refreshBlocks(weekStartIsoDate);
}

export function getBlocks() {
    return _memBlocks.get(_currentWeekStart)?.blocks ?? [];
}

export async function invalidateBlocksCache(weekStartIsoDate) {
    _memBlocks.delete(weekStartIsoDate);
    await pcDelete(_blocksKey(weekStartIsoDate));
}

async function _upsertBlockInCache(weekIso, savedBlock) {
    const entry = _memBlocks.get(weekIso);
    if (!entry) return;
    const idx = entry.blocks.findIndex(b => b.id === savedBlock.id);
    const newBlocks = idx >= 0
        ? entry.blocks.map((b, i) => (i === idx ? savedBlock : b))
        : [...entry.blocks, savedBlock];
    const newEntry = { blocks: newBlocks, fetchedAt: Date.now() };
    _memBlocks.set(weekIso, newEntry);
    await pcSet(_blocksKey(weekIso), newEntry, BLOCKS_TTL_MS);
}

async function _removeBlockInCache(weekIso, blockId, scope) {
    if (scope === 'all' || scope === 'future') {
        await invalidateBlocksCache(weekIso);
        return;
    }
    const entry = _memBlocks.get(weekIso);
    if (!entry) return;
    const newBlocks = entry.blocks.filter(b => b.id !== String(blockId));
    const newEntry = { blocks: newBlocks, fetchedAt: Date.now() };
    _memBlocks.set(weekIso, newEntry);
    await pcSet(_blocksKey(weekIso), newEntry, BLOCKS_TTL_MS);
}

export function isBlocksCacheWarm(weekStartIsoDate) {
    const cached = _memBlocks.get(weekStartIsoDate);
    return !!(cached && (Date.now() - cached.fetchedAt) < BLOCKS_FRESH_MS);
}

export function getCurrentWeekStart() {
    return _currentWeekStart;
}

/** Returns the in-flight background refresh promise for `weekIso`, or null. */
export function getBlocksRefreshPromise(weekIso) {
    return _inFlightBlocks.get(weekIso) ?? null;
}

/**
 * Pre-load the in-memory preferences cache from a value already read from
 * IndexedDB elsewhere (e.g. app bootstrap). Avoids a redundant IDB roundtrip
 * when the caller already has the data in hand.
 */
export function primePrefsCache(prefs) {
    if (!prefs || typeof prefs !== 'object') return;
    _cachedPreferences = prefs;
    if (!_prefsPromise) _prefsPromise = Promise.resolve(prefs);
}

/**
 * Pre-load the in-memory blocks mirror with an entry already read from IDB.
 * The entry shape must be `{ blocks, fetchedAt }`. Sets `_currentWeekStart`
 * so `getBlocks()` returns this entry immediately.
 */
export function primeBlocksCache(weekIso, entry) {
    if (!weekIso || !entry || !Array.isArray(entry.blocks)) return;
    _memBlocks.set(weekIso, entry);
    _currentWeekStart = weekIso;
}

export async function createBlock(block) {
    try {
        const saved = await apiFetch('/api/weekly/blocks', {
            method: 'POST',
            body: JSON.stringify(block),
        });
        if (!saved) return null;
        const normalized = _normalizeBlock(saved);
        await _upsertBlockInCache(_currentWeekStart, normalized);
        return normalized;
    } catch (e) {
        console.error('[weekly] createBlock:', e);
        alert(`No se pudo crear el bloque: ${e.message}`);
        return null;
    }
}

export async function updateBlock(blockId, updates, scope = null) {
    try {
        const body = scope ? { ...updates, scope } : updates;
        const saved = await apiFetch(`/api/weekly/blocks/${blockId}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
        });
        if (!saved) return null;
        const normalized = _normalizeBlock(saved);
        if (scope === 'all') {
            await invalidateBlocksCache(_currentWeekStart);
        } else {
            await _upsertBlockInCache(_currentWeekStart, normalized);
        }
        return normalized;
    } catch (e) {
        console.error('[weekly:update] failed', { blockId, updates, error: e });
        console.error('[weekly] updateBlock:', e);
        alert(`No se pudo actualizar el bloque: ${e.message}`);
        return null;
    }
}

export async function removeBlock(blockId, scope = null) {
    try {
        const path = scope ? `/api/weekly/blocks/${blockId}?scope=${scope}` : `/api/weekly/blocks/${blockId}`;
        await apiFetch(path, { method: 'DELETE' });
        await _removeBlockInCache(_currentWeekStart, blockId, scope);
        return true;
    } catch (e) {
        console.error('[weekly] removeBlock:', e);
        alert(`No se pudo eliminar el bloque: ${e.message}`);
        return false;
    }
}

// Converts a WeeklyBlockUnified entry (source=task|activity) to the display shape.
// start_at is a UTC ISO 8601 string with Z suffix; converted to user's local timezone.
function _normalizeLogBlock(b, weekStartIsoDate) {
    let startTime = formatInUserTz(b.start_at, 'HH:mm');
    const localDate = formatInUserTz(b.start_at, 'yyyy-MM-dd');
    if (startTime < '06:00') {
        console.warn('[weekly] log block before 06:00 (possible start_at NULL fallback):', b.id, b.start_at);
        startTime = '06:00';
    }

    // Compute end by adding duration, then clamp if it crosses midnight in user's TZ.
    const endMs    = new Date(b.start_at).getTime() + b.duration_minutes * 60_000;
    const endIso   = new Date(endMs).toISOString();
    const endDay   = formatInUserTz(endIso, 'yyyy-MM-dd');
    const endTime  = endDay > localDate ? '23:59' : formatInUserTz(endIso, 'HH:mm');

    const isTask = b.source === 'task';
    return {
        id:               b.id,
        week_start:       weekStartIsoDate,
        day:              new Date(b.start_at).getDay(),  // local day of week (0=Sun)
        block_type:       isTask ? 'task' : 'activity',
        task_id:          isTask ? b.source_ref_id : null,
        activity_id:      isTask ? null : b.source_ref_id,
        title:            b.title,
        color:            b.color ?? null,
        start_time:       startTime,
        end_time:         endTime,
        notes:            null,
        priority:         b.metadata?.priority ?? null,
        column_status:    b.metadata?.column_status ?? null,
        item_type:        b.metadata?.activity_type ?? null,
        is_virtual:       false,
        is_master:        false,
        series_id:        null,
        recurrence:       null,
        recurrence_until: null,
        rrule_string:     null,
        dtstart:          null,
        exception_dates:  [],
        parent_block_id:  null,
        source:           b.source,
        is_log:           true,
    };
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

function _debugWeekly() {
    try {
        return new URLSearchParams(window.location.search).get('debug') === 'weekly';
    } catch { return false; }
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
