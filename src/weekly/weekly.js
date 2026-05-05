/** Vista Weekly Tracker: navegación, indicadores, columnas de días y bloques. */

import { STATE } from '../core/state.js';
import {
    getPrefsOnce, getPreferences,
    fetchBlocks, getBlocks, updateBlock, removeBlock, invalidateBlocksCache, isBlocksCacheWarm,
    getBlocksRefreshPromise,
    getWeekDays, weekStartIso,
    timeToMinutes, blockDurationH, dayHours,
} from './weekly-data.js';
import { computeBlockLayout } from './weekly-layout.js';
import { openBlockModal, askScope } from './weekly-modal.js';
import { renderPeriodNav } from '../calendar/shared/period-nav.js';
import { fetchBusinessHours, getBusinessHoursForDate, formatLocalHour } from './business-hours.js';
import { fetchCalendarEvents, getCalendarEvents } from '../calendar/data/calendar-events-api.js';
import { bucketEventsByDay, renderEventTrack } from './weekly-events-render.js';
import { openEventModal, closeEventModal } from './weekly-event-modal.js';

const HOUR_START   = 6;
const HOUR_END     = 23;
const PX_PER_HOUR  = 60;
const SNAP_MINUTES = 15;

const DAY_NAMES   = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTH_NAMES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

let _refDate           = new Date();
let _container         = null;
let _toolbarHtml       = '';
let _dragBlockId       = null;
let _dragTaskId        = null;
let _dragBlockDuration = 0;
let _weekStartIso      = null;
let _gridHourStart     = HOUR_START; // derived each render from actual block data

// ── Resize gesture state (lifted to module scope, Fase 5 Antipatrón 4) ───────
// Window-level pointer listeners must be attached only once per page load,
// otherwise they accumulate every time the user re-enters the weekly view.
// Lifting `_resize`/`_resizeDidMove` here lets the listeners share state
// across renders without re-binding on each call to _setupResize().
let _resize         = null;
let _resizeDidMove  = false;
let _windowListenersInit = false;

// Last seen week boundaries — used by _onPreferencesUpdated to decide whether
// the change actually invalidates the current week's block cache.
let _lastWeekStartDay = null;
let _lastWeekEndDay   = null;

// Track whether the Weekly view has mounted at least once so we know when to
// pass `prefetch: true` to the calendar events client. Subsequent navigations
// (next week / prev week) reuse the existing prefetch, never re-trigger it.
let _calendarPrefetchDone = false;

// Current-time indicator — one setInterval at most; replaced on each _render().
let _timeLineTimer = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function renderWeekly(container, toolbarHtml = '') {
    _container   = container;
    _toolbarHtml = toolbarHtml;

    // Snapshot the active week boundaries the first time we render so the
    // preferences-updated handler can tell what actually changed.
    if (_lastWeekStartDay === null) {
        const prefs = getPreferences();
        _lastWeekStartDay = prefs.week_start_day;
        _lastWeekEndDay   = prefs.week_end_day;
    }

    _render();

    // Container-scoped listeners — re-bind whenever the calendar router
    // replaces innerHTML and gives us a fresh container element.
    if (!container._weeklyInit) {
        container._weeklyInit = true;
        _setupDragDrop();
        _setupResize();
        _setupDblClick();
    }

    // Window-scoped listeners — bind ONCE per page load. The DOM-level guard
    // (`container._weeklyInit`) doesn't survive an innerHTML replace, which is
    // why the previous implementation leaked one listener per visit.
    if (!_windowListenersInit) {
        _windowListenersInit = true;
        window.addEventListener('preferences-updated', _onPreferencesUpdated);
        window.addEventListener('resize',              _updateStickyMetrics);
        window.addEventListener('pointermove',         _onResizePointerMove);
        window.addEventListener('pointerup',           _onResizePointerUp);
        window.addEventListener('pointercancel',       _onResizePointerCancel);
    }
}

// ── preferences-updated handler (Fase 5 Antipatrón 1) ────────────────────────

async function _onPreferencesUpdated(e) {
    const newPrefs = (e?.detail && typeof e.detail === 'object') ? e.detail : getPreferences();
    const wsd      = newPrefs.week_start_day;
    const wed      = newPrefs.week_end_day;
    const boundsChanged = (
        wsd !== _lastWeekStartDay || wed !== _lastWeekEndDay
    );
    _lastWeekStartDay = wsd;
    _lastWeekEndDay   = wed;
    // If only non-structural prefs changed (e.g. calendar_view) the cached
    // blocks for the current _weekStartIso are still valid — _render() will
    // pick them up from the in-memory mirror without any /blocks request.
    // If the bounds shifted, drop the entry so the next fetchBlocks falls
    // back to the IDB → network path.
    if (boundsChanged) await invalidateBlocksCache(_weekStartIso);
    _render();
}

export function handleWeeklyClick(action, el) {
    switch (action) {
        case 'weekly-event-detail': {
            // Read-only modal: find the event in the cache by id, render details.
            const eventId = el.dataset.eventId;
            const prefs   = getPreferences();
            const days    = getWeekDays(_refDate, prefs);
            const events  = getCalendarEvents(days[0], days[days.length - 1], 'week');
            const event   = events.find(ev => ev.id === eventId);
            if (event) openEventModal(event);
            return true;
        }
        case 'weekly-event-close':
            closeEventModal();
            return true;
        case 'weekly-prev':
            _refDate.setDate(_refDate.getDate() - 7);
            _render();
            return true;
        case 'weekly-next':
            _refDate.setDate(_refDate.getDate() + 7);
            _render();
            return true;
        case 'weekly-today':
            _refDate = new Date();
            _render();
            return true;
        case 'weekly-add-block': {
            const day = parseInt(el.dataset.day, 10);
            openBlockModal(day, _weekStartIso, () => _render());
            return true;
        }
        case 'weekly-edit-block': {
            const blockId = el.dataset.blockId;
            const block   = getBlocks().find(b => b.id === blockId);
            console.debug('[weekly:edit]', { blockId: el.dataset.blockId, foundBlock: !!block, blockSnapshot: block });
            if (block) openBlockModal(
                { mode: 'edit', day: block.day, weekStartIso: _weekStartIso, block },
                () => _render()
            );
            return true;
        }
        case 'weekly-remove-block': {
            const blockId = el.dataset.blockId;
            const block   = getBlocks().find(b => b.id === blockId);
            if (block?.series_id || block?.is_virtual) {
                askScope().then(scope => {
                    if (scope === null) return;
                    removeBlock(blockId, scope).then(ok => { if (ok) _render(); });
                });
            } else {
                removeBlock(blockId).then(ok => { if (ok) _render(); });
            }
            return true;
        }
        case 'weekly-open-log': {
            const sourceRef  = el.dataset.sourceRef;
            const sourceType = el.dataset.sourceType;
            if (sourceRef) {
                window.dispatchEvent(new CustomEvent('weekly:open-source-item', {
                    detail: { id: sourceRef, sourceType },
                }));
            }
            return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

async function _render() {
    if (!_container) return;

    // Performance instrumentation (Fase 0). Cheap, runs in prod.
    performance.mark('weekly:render:start');

    // Compute week boundaries with currently cached prefs (may update below)
    const prefsNow     = getPreferences();
    const daysEst      = getWeekDays(_refDate, prefsNow);
    _weekStartIso      = weekStartIso(_refDate, prefsNow);

    // Show skeleton immediately when there's no cached data for this week
    if (!isBlocksCacheWarm(_weekStartIso)) {
        _container.innerHTML = _renderSkeleton(daysEst);
    }

    const [, bizConfig] = await Promise.all([
        getPrefsOnce(),
        fetchBusinessHours(),
        fetchBlocks(_weekStartIso),
    ]);

    performance.mark('weekly:prefs:done');
    performance.mark('weekly:blocks:done');

    // Recalculate with up-to-date prefs (week_start_day may have changed)
    const prefs = getPreferences();
    const days  = getWeekDays(_refDate, prefs);
    _weekStartIso = weekStartIso(_refDate, prefs);

    const blocks = getBlocks();
    const today  = _today();

    // Derive effective grid start from the earliest block across the whole week
    {
        const minStart = blocks.reduce((m, b) => {
            const s = timeToMinutes(b.start_time);
            return s < m ? s : m;
        }, HOUR_START * 60);
        _gridHourStart = Math.floor(minStart / 60);
    }

    const bizHours = getBusinessHoursForDate(bizConfig, _weekStartIso);

    // Calendar events: kick off the fetch before painting and use whatever
    // is cached for the initial paint (SWR — cache hit returns instantly).
    // Only the FIRST mount asks the backend to also prefetch the next week.
    const rangeStart = days[0];
    const rangeEnd   = days[days.length - 1];
    const eventsPromise = fetchCalendarEvents(
        rangeStart, rangeEnd, 'week',
        { prefetch: !_calendarPrefetchDone },
    );
    _calendarPrefetchDone = true;
    const cachedEvents  = getCalendarEvents(rangeStart, rangeEnd, 'week');
    const eventsByDay   = bucketEventsByDay(cachedEvents, days);

    _container.innerHTML = `
        <div class="weekly-view">
            ${_renderNav(days)}
            <div class="weekly-scroll">
                ${_renderIndicators(days, blocks)}
                ${_renderWeekProgress(days)}
                ${_renderBusinessHoursLabel(bizHours)}
                <div class="weekly-grid">
                    ${_renderTimeAxis()}
                    <div class="weekly-columns" id="weeklyColumns">
                        ${days.map(d => _renderColumn(d, blocks, today, bizHours, eventsByDay.get(d.getDay()) ?? [])).join('')}
                    </div>
                </div>
            </div>
        </div>`;

    // If the events fetch resolves with a different result than the cache
    // hit we used for the initial paint, repaint quietly. We compare lengths
    // as a cheap signal — exact diffing isn't worth it for this pane.
    const myWeek = _weekStartIso;
    eventsPromise
        .then(({ events }) => {
            if (_weekStartIso !== myWeek) return;             // user navigated away
            if (events.length === cachedEvents.length) return; // nothing to repaint
            _render();
        })
        .catch(() => {/* network failure shouldn't poison the UI */});

    performance.mark('weekly:dom:done');
    _logRenderPerf();

    _updateStickyMetrics();
    _mountCurrentTimeLine(days);

    // Fase 3 — show "actualizando…" while a SWR revalidation is in flight,
    // and re-render once it resolves so the user sees fresh data.
    _hookCacheBadge();

    // Fase 3 — pre-warm IndexedDB for adjacent weeks during the idle window so
    // navigation feels instantaneous. Fire-and-forget, never blocks paint.
    if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(() => _prefetchAdjacentWeeks(), { timeout: 2000 });
    } else {
        setTimeout(_prefetchAdjacentWeeks, 100);
    }
}

function _renderSkeleton(days) {
    const prefs   = getPreferences();
    const navDays = days ?? getWeekDays(_refDate, prefs);
    const nav     = _renderNav(navDays);
    const skeletonHeights = [60, 90, 45];
    const skeletonTops    = [60, 180, 320];
    const cols = navDays.map(d => {
        const dn      = d.getDay();
        const blocks  = skeletonHeights.map((h, j) => `
            <div class="weekly-block weekly-block--skeleton"
                 style="top:${skeletonTops[j]}px;height:${h}px"></div>`).join('');
        return `
            <div class="weekly-col weekly-col--skeleton" data-day="${dn}">
                <div class="weekly-col-header">
                    <div class="weekly-col-day-name">${DAY_NAMES[dn]}</div>
                    <div class="weekly-col-date">${d.getDate()} ${MONTH_NAMES[d.getMonth()]}</div>
                </div>
                <div class="weekly-col-body" data-day="${dn}">${blocks}</div>
            </div>`;
    }).join('');
    const html = `
        <div class="weekly-view">
            ${nav}
            <div class="weekly-scroll">
                <div class="weekly-grid">
                    ${_renderTimeAxis()}
                    <div class="weekly-columns" id="weeklyColumns">${cols}</div>
                </div>
            </div>
        </div>`;
    performance.mark('weekly:skeleton:painted');
    try {
        performance.measure('weekly:time-to-skeleton', 'weekly:render:start', 'weekly:skeleton:painted');
    } catch { /* mark missing → ignore */ }
    return html;
}

// ── Performance instrumentation (Fase 0) ──────────────────────────────────────

function _logRenderPerf() {
    try {
        performance.measure('weekly:time-to-prefs', 'weekly:render:start', 'weekly:prefs:done');
        performance.measure('weekly:time-to-dom',   'weekly:prefs:done',   'weekly:dom:done');
        performance.measure('weekly:total',         'weekly:render:start', 'weekly:dom:done');
    } catch { /* missing marks → skip */ }

    const last = name => {
        const list = performance.getEntriesByName(name, 'measure');
        const m    = list[list.length - 1];
        return m ? +m.duration.toFixed(2) : null;
    };
    console.debug('[perf:weekly]', {
        'time-to-skeleton': last('weekly:time-to-skeleton'),
        'time-to-prefs':    last('weekly:time-to-prefs'),
        'time-to-dom':      last('weekly:time-to-dom'),
        'total':            last('weekly:total'),
    });
}

// ── Cache "actualizando…" indicator (Fase 3) ──────────────────────────────────

let _hookedRefresh = null;

function _hookCacheBadge() {
    const myWeek  = _weekStartIso;
    const refresh = getBlocksRefreshPromise(myWeek);
    if (!refresh) {
        _setCacheIndicator(false);
        return;
    }
    _setCacheIndicator(true);
    if (_hookedRefresh === refresh) return;
    _hookedRefresh = refresh;
    refresh.finally(() => {
        if (_hookedRefresh === refresh) _hookedRefresh = null;
        // User may have navigated to a different week while we were waiting.
        if (_weekStartIso !== myWeek) return;
        _setCacheIndicator(false);
        _render(); // repaint with fresh data (no flicker: same DOM if unchanged)
    });
}

function _setCacheIndicator(show) {
    if (!_container) return;
    const existing = _container.querySelector('#weekly-cache-indicator');
    if (show) {
        if (existing) return;
        const nav = _container.querySelector('.cal-period-nav');
        if (!nav) return;
        const badge = document.createElement('span');
        badge.id          = 'weekly-cache-indicator';
        badge.className   = 'weekly-cache-badge';
        badge.textContent = 'actualizando…';
        nav.appendChild(badge);
    } else {
        existing?.remove();
    }
}

// ── Adjacent-week prefetch (Fase 3) ───────────────────────────────────────────

function _prefetchAdjacentWeeks() {
    const prefs = getPreferences();
    if (!prefs) return;
    const offsets = [-7, 7, 14];
    for (const off of offsets) {
        const ref = new Date(_refDate);
        ref.setDate(ref.getDate() + off);
        const iso = weekStartIso(ref, prefs);
        if (isBlocksCacheWarm(iso)) continue;
        // Fire-and-forget: fetchBlocks already handles IDB → mem → network.
        fetchBlocks(iso).catch(() => {});
    }
}

// Mide el chrome fijo de la página (.header + .app-nav) y la altura real
// de indicators / col-header para que los `sticky` queden perfectamente
// alineados en cualquier viewport.
function _updateStickyMetrics() {
    requestAnimationFrame(() => {
        if (!_container) return;

        const pageHeader = document.querySelector('.header');
        const appNav     = document.querySelector('.app-nav');
        const chrome     = (pageHeader?.offsetHeight ?? 0) + (appNav?.offsetHeight ?? 0);
        document.documentElement.style.setProperty('--weekly-page-chrome', chrome + 'px');

        const view      = _container.querySelector('.weekly-view');
        const colHeader = _container.querySelector('.weekly-col-header');
        if (!view) return;

        if (colHeader) view.style.setProperty('--weekly-col-header-height', colHeader.offsetHeight + 'px');
    });
}

// ── Indicators ──────────────────────────────────────────────────────────────

function _renderIndicators(days, blocks) {
    const dayNums    = days.map(d => d.getDay());
    const visBlocks  = blocks.filter(_blockVisible);

    // Card 1 – días sin planificar
    const unplanned      = dayNums.filter(dn => !visBlocks.some(b => b.day === dn));
    const unplannedNames = unplanned.map(dn => DAY_NAMES[dn]).join(', ');
    const upColor        = unplanned.length === 0 ? 'green' : 'yellow';

    // Card 2 – tareas urgentes sin asignar esta semana (desde STATE.tasks)
    const assignedIds = new Set(
        visBlocks.map(b => b.task_id ?? b.activity_id).filter(Boolean).map(String)
    );
    const urgent = STATE.tasks.filter(t =>
        !_taskIsCompleted(t)
        && (t.priority === 'high' || t.priority === 'urgent')
        && !assignedIds.has(String(t.id))
    );
    const visible3  = urgent.slice(0, 3);
    const moreCount = urgent.length - visible3.length;

    // Card 3 – carga semanal
    const totalH  = dayNums.reduce((s, dn) => s + dayHours(visBlocks, dn), 0);
    const maxH    = days.length * 8;
    const loadPct = Math.min(100, Math.round((totalH / maxH) * 100));

    const dayDots = days.map(d => {
        const dn  = d.getDay();
        const h   = dayHours(visBlocks, dn);
        const cls = h > 10 ? 'red' : h >= 6 ? 'green' : 'gray';
        return `<div class="weekly-day-dot ${cls}" title="${DAY_NAMES[dn]}: ${h}h">${DAY_NAMES[dn]}</div>`;
    }).join('');

    return `
        <div class="weekly-indicators">
            <div class="weekly-indicator-card">
                <div class="weekly-indicator-title">Días sin planificar</div>
                <div class="weekly-indicator-value ${upColor}">${unplanned.length}</div>
                <div class="weekly-indicator-sub">
                    ${unplanned.length === 0 ? 'Todos planificados ✓' : unplannedNames}
                </div>
            </div>

            <div class="weekly-indicator-card">
                <div class="weekly-indicator-title">Tareas urgentes sin asignar</div>
                <ul class="weekly-urgent-list">
                    ${visible3.map(t => `
                        <li class="weekly-urgent-item"
                            draggable="true"
                            data-urgent-task-id="${t.id}">
                            <span class="priority-dot ${t.priority}"></span>
                            <span>${_esc(t.title ?? '')}</span>
                        </li>`).join('')}
                    ${moreCount > 0
                        ? `<li class="weekly-indicator-sub" style="padding:.25rem .5rem">+${moreCount} más...</li>`
                        : ''}
                    ${urgent.length === 0
                        ? `<li class="weekly-indicator-sub" style="padding:.25rem .5rem;color:var(--color-success)">Sin urgentes pendientes ✓</li>`
                        : ''}
                </ul>
            </div>

            <div class="weekly-indicator-card">
                <div class="weekly-indicator-title">Carga semanal</div>
                <div class="weekly-indicator-value" style="font-size:1.25rem">
                    ${totalH.toFixed(1)}h
                    <span style="font-size:.875rem;font-weight:400;color:var(--color-text-secondary)">/ ${maxH}h</span>
                </div>
                <div class="weekly-load-bar-outer">
                    <div class="weekly-load-bar-inner" style="width:${loadPct}%"></div>
                </div>
                <div class="weekly-day-dots">${dayDots}</div>
            </div>
        </div>`;
}

// ── Week navigator ───────────────────────────────────────────────────────────

function _renderNav(days) {
    const f     = days[0];
    const l     = days[days.length - 1];
    const fmt   = d => `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
    const range = f.getFullYear() === l.getFullYear()
        ? `${fmt(f)} – ${fmt(l)} ${l.getFullYear()}`
        : `${fmt(f)} ${f.getFullYear()} – ${fmt(l)} ${l.getFullYear()}`;

    const viewsHtml = _toolbarHtml
        ? `<div class="cal-period-nav-views" role="toolbar" aria-label="Vista del calendario">${_toolbarHtml}</div>`
        : '';

    const tzBadge = _renderTzBadge();

    return renderPeriodNav({ label: range, actionPrefix: 'weekly', extraContent: viewsHtml + tzBadge });
}

function _renderTzBadge() {
    const tz        = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const offsetMin = -new Date().getTimezoneOffset();
    const sign      = offsetMin >= 0 ? '+' : '-';
    const absH      = Math.floor(Math.abs(offsetMin) / 60);
    const absM      = Math.abs(offsetMin) % 60;
    const offsetStr = absM
        ? `UTC${sign}${absH}:${String(absM).padStart(2, '0')}`
        : `UTC${sign}${absH}`;
    return `<span class="weekly-tz-badge"
                  title="Los logs se guardan en UTC y se muestran en tu hora local">${tz} (${offsetStr})</span>`;
}

// ── Time axis ────────────────────────────────────────────────────────────────

function _renderTimeAxis() {
    const labels = [];
    for (let h = _gridHourStart; h <= HOUR_END; h++) {
        const label = h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;
        labels.push(`<div class="weekly-hour-label">${label}</div>`);
    }
    return `<div class="weekly-time-axis"><div class="weekly-time-axis-spacer"></div>${labels.join('')}</div>`;
}

// ── Day column ───────────────────────────────────────────────────────────────

function _renderColumn(date, blocks, today, bizHours, events = []) {
    const dn         = date.getDay();
    const isToday    = date.getTime() === today.getTime();
    const colBlocks  = blocks.filter(b => b.day === dn && _blockVisible(b));
    const hasBlocks  = colBlocks.length > 0;
    const h          = dayHours(colBlocks, dn);
    const loadPct    = Math.min(100, Math.round((h / 8) * 100));
    const overloaded = h > 10 ? 'overloaded' : '';

    // Split by type and compute layouts independently so planned and log
    // blocks never steal columns from each other.
    const plannedBlocks = colBlocks.filter(b => !b.is_log);
    const logBlocks     = colBlocks.filter(b =>  b.is_log);
    const plannedLayout = computeBlockLayout(plannedBlocks);
    const logLayout     = computeBlockLayout(logBlocks);

    // Detect perfect matches (same title + exact time range → "Cumplido")
    const matchedLogIds     = new Set();
    const matchedPlannedIds = new Set();
    for (const log of logBlocks) {
        const match = plannedBlocks.find(p =>
            p.start_time === log.start_time &&
            p.end_time   === log.end_time   &&
            p.title      === log.title
        );
        if (match) {
            matchedLogIds.add(log.id);
            matchedPlannedIds.add(match.id);
        }
    }

    const totalSlots = HOUR_END - _gridHourStart + 1;
    const gridHeight = totalSlots * PX_PER_HOUR;
    const hourLines  = Array.from({ length: totalSlots }, (_, i) =>
        `<div class="weekly-hour-line" style="top:${i * PX_PER_HOUR}px"></div>`
    ).join('');

    // Business hours zone — clamped to visible range; cross-midnight → show start→HOUR_END
    let availZoneHtml = '';
    if (bizHours) {
        const { localStartHour, localEndHour } = bizHours;
        const startH = Math.max(_gridHourStart, Math.min(HOUR_END, localStartHour));
        const endH   = localEndHour < localStartHour
            ? HOUR_END
            : Math.max(_gridHourStart, Math.min(HOUR_END, localEndHour));
        if (endH > startH) {
            const availTop    = (startH - _gridHourStart) * PX_PER_HOUR;
            const availHeight = (endH   - startH)         * PX_PER_HOUR;
            availZoneHtml = `<div class="weekly-availability-zone"
                 style="top:${availTop}px;height:${availHeight}px"></div>`;
        }
    }

    const eventTrackHtml = renderEventTrack(events, date);
    const hasEventsClass = events.length > 0 ? ' has-events' : '';

    // When only one track type has blocks it expands to full column width.
    const plannedFull = logBlocks.length     === 0 ? ' weekly-blocks-track--full' : '';
    const logFull     = plannedBlocks.length === 0 ? ' weekly-blocks-track--full' : '';

    return `
        <div class="weekly-col" data-day="${dn}">
            <div class="weekly-col-header${isToday ? ' today' : ''}">
                <div class="weekly-col-day-name">${DAY_NAMES[dn]}</div>
                <div class="weekly-col-date">${date.getDate()} ${MONTH_NAMES[date.getMonth()]}</div>
                <div class="weekly-col-load-bar">
                    <div class="weekly-col-load-bar-fill ${overloaded}" style="width:${loadPct}%"
                         title="${h.toFixed(1)}h / 8h"></div>
                </div>
            </div>
            <div class="weekly-col-body${hasBlocks ? '' : ' no-blocks'}${hasEventsClass}"
                 data-day="${dn}"
                 style="min-height:${gridHeight}px">
                ${availZoneHtml}
                ${hourLines}
                ${eventTrackHtml}
                ${!hasBlocks ? '<div class="weekly-no-blocks-text"><i class="fas fa-calendar-plus"></i><br>Sin bloques planeados</div>' : ''}
                <div class="weekly-blocks-track weekly-blocks-track--planned${plannedFull}" data-day="${dn}">
                    ${plannedBlocks.map(b => _renderBlock(b, plannedLayout.get(b.id), { isMatch: matchedPlannedIds.has(b.id) })).join('')}
                </div>
                <div class="weekly-blocks-track weekly-blocks-track--log${logFull}" data-day="${dn}">
                    ${logBlocks.map(b => _renderLogBlock(b, logLayout.get(b.id), { isMatch: matchedLogIds.has(b.id) })).join('')}
                </div>
            </div>
            <div class="weekly-col-footer">
                <button class="weekly-add-btn"
                        data-action="weekly-add-block"
                        data-day="${dn}"
                        title="Agregar bloque">+</button>
            </div>
        </div>`;
}

// ── Business hours label ─────────────────────────────────────────────────────

function _renderBusinessHoursLabel(bizHours) {
    if (!bizHours) return '';
    const { localStartHour, localEndHour, userTz, businessTz } = bizHours;
    if (userTz === businessTz) return '';
    const startFmt = formatLocalHour(localStartHour);
    const endFmt   = formatLocalHour(localEndHour);
    return `
        <div class="weekly-biz-hours-label">
            Horario laboral: 8am–5pm NY
            <span class="weekly-biz-hours-local">(tu zona: ${startFmt}–${endFmt})</span>
        </div>`;
}

// ── Block ────────────────────────────────────────────────────────────────────

function _renderLogBlock(block, blockLayout = { column: 0, totalColumns: 1 }, opts = {}) {
    const { column, totalColumns } = blockLayout;
    const top    = Math.max(0, timeToMinutes(block.start_time) - _gridHourStart * 60);
    const height = Math.max(24, timeToMinutes(block.end_time) - timeToMinutes(block.start_time));
    const durH   = blockDurationH(block);
    const title  = block.title || 'Log';
    const isTask = block.block_type === 'task';
    const sourceRef  = isTask ? block.task_id : block.activity_id;
    const sourceType = block.source ?? block.block_type;

    const priorityCls = `priority-${block.priority ?? 'medium'}`;
    const posStyle    = totalColumns === 1
        ? 'left:4px;right:4px;'
        : `left:calc(${(column / totalColumns * 100).toFixed(2)}% + 2px);width:calc(${(100 / totalColumns).toFixed(2)}% - 4px);right:auto;`;

    const isMatch    = opts.isMatch ?? false;
    const badgeLabel = isMatch ? 'Cumplido' : 'Ejecutado';
    const badgeCls   = isMatch ? 'weekly-block-badge--fulfilled' : 'weekly-block-badge--log';
    const matchCls   = isMatch ? ' weekly-block--fulfilled' : '';

    return `
        <div class="weekly-block weekly-block--log task-block ${priorityCls}${matchCls}"
             style="top:${top}px;height:${height}px;${posStyle}"
             data-action="weekly-open-log"
             data-block-id="${block.id}"
             data-source-ref="${_esc(sourceRef ?? '')}"
             data-source-type="${_esc(sourceType)}"
             title="Log de tiempo: ${_esc(title)}">
            ${height >= 32 ? `<span class="weekly-block-badge ${badgeCls}">${badgeLabel}</span>` : ''}
            <div class="weekly-block-title">
                <i class="fas fa-clock" style="font-size:.5625rem;margin-right:2px;opacity:.6"></i>${_esc(title)}
            </div>
            ${height >= 40
                ? `<div class="weekly-block-time">${block.start_time}–${block.end_time} · ${durH}h</div>`
                : ''}
        </div>`;
}

function _renderBlock(block, blockLayout = { column: 0, totalColumns: 1 }, opts = {}) {
    if (block.is_log) return _renderLogBlock(block, blockLayout, opts);
    const { column, totalColumns } = blockLayout;
    const top        = Math.max(0, timeToMinutes(block.start_time) - _gridHourStart * 60);
    const height     = Math.max(24, timeToMinutes(block.end_time) - timeToMinutes(block.start_time));
    const durH       = blockDurationH(block);
    const isPersonal = block.block_type === 'personal';

    let priorityCls = '';
    let typeIcon    = '';
    let blockClass  = '';
    let colorStyle  = '';
    const title     = block.title || 'Bloque';

    if (isPersonal) {
        blockClass = 'personal-block';
        colorStyle = block.color ? `background:${block.color};` : '';
    } else {
        priorityCls = `priority-${block.priority ?? 'medium'}`;
        blockClass  = `task-block ${priorityCls}`;
        if (block.block_type === 'activity' || block.item_type) {
            typeIcon = '<i class="fas fa-bolt" style="font-size:.5625rem;margin-right:2px;opacity:.7"></i>';
        }
    }

    const recurIcon = (block.recurrence === 'weekly' || block.series_id)
        ? '<i class="fas fa-repeat" style="font-size:.5625rem;margin-right:2px;opacity:.7"></i>'
        : '';

    const posStyle = totalColumns === 1
        ? 'left:4px;right:4px;'
        : `left:calc(${(column / totalColumns * 100).toFixed(2)}% + 2px);width:calc(${(100 / totalColumns).toFixed(2)}% - 4px);right:auto;`;

    const isMatch  = opts.isMatch ?? false;
    const matchCls = isMatch ? ' weekly-block--fulfilled-shadow' : '';

    const styleBase = `top:${top}px;height:${height}px;${posStyle}`;

    return `
        <div class="weekly-block ${blockClass}${matchCls}"
             style="${colorStyle}${styleBase}"
             draggable="true"
             data-action="weekly-edit-block"
             data-block-id="${block.id}">
            <div class="weekly-block-resize weekly-block-resize-top"></div>
            ${height >= 32 && !isPersonal ? '<span class="weekly-block-badge weekly-block-badge--planned">Planeado</span>' : ''}
            <div class="weekly-block-title">${typeIcon}${recurIcon}${_esc(title)}</div>
            ${height >= 40
                ? `<div class="weekly-block-time">${block.start_time}–${block.end_time} · ${durH}h</div>`
                : ''}
            <button class="weekly-block-remove"
                    data-action="weekly-remove-block"
                    data-block-id="${block.id}"
                    title="Eliminar bloque">×</button>
            <div class="weekly-block-resize weekly-block-resize-bottom"></div>
        </div>`;
}

// ── Drag & drop ──────────────────────────────────────────────────────────────

function _setupDragDrop() {
    if (!_container) return;

    // Intercept remove-button clicks so they don't bubble up and trigger
    // the weekly-edit-block action on the parent .weekly-block element.
    _container.addEventListener('click', e => {
        const rm = e.target.closest('.weekly-block-remove');
        if (!rm) return;
        e.stopPropagation();
        const blockId = rm.dataset.blockId;
        const block   = getBlocks().find(b => b.id === blockId);
        if (block?.series_id || block?.is_virtual) {
            askScope().then(scope => {
                if (scope === null) return;
                removeBlock(blockId, scope).then(ok => { if (ok) _render(); });
            });
        } else {
            removeBlock(blockId).then(ok => { if (ok) _render(); });
        }
    });

    _container.addEventListener('dragstart', e => {
        const blockEl  = e.target.closest('[data-block-id]');
        const urgentEl = e.target.closest('[data-urgent-task-id]');

        if (blockEl) {
            _dragBlockId = blockEl.dataset.blockId;
            _dragTaskId  = null;
            blockEl.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            const block = getBlocks().find(b => b.id === _dragBlockId);
            _dragBlockDuration = block
                ? timeToMinutes(block.end_time) - timeToMinutes(block.start_time)
                : 60;
        } else if (urgentEl) {
            _dragTaskId        = urgentEl.dataset.urgentTaskId;
            _dragBlockId       = null;
            _dragBlockDuration = 0;
            urgentEl.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'copy';
        }
    }, true);

    _container.addEventListener('dragend', () => {
        _container.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
        _container.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
        _container.querySelectorAll('.weekly-drop-hint').forEach(h => h.remove());
        _dragBlockDuration = 0;
    }, true);

    _container.addEventListener('dragover', e => {
        const col = e.target.closest('.weekly-col-body');
        if (!col) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = _dragBlockId !== null ? 'move' : 'copy';
        _container.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
        col.classList.add('drop-target');
        if (_dragBlockId !== null) _updateDropHint(col, e.clientY);
    });

    _container.addEventListener('dragleave', e => {
        const col = e.target.closest('.weekly-col-body');
        if (col && !col.contains(e.relatedTarget)) {
            col.classList.remove('drop-target');
            col.querySelector('.weekly-drop-hint')?.remove();
        }
    });

    _container.addEventListener('drop', async e => {
        const col = e.target.closest('.weekly-col-body');
        if (!col) return;
        e.preventDefault();
        col.classList.remove('drop-target');
        col.querySelector('.weekly-drop-hint')?.remove();

        const targetDay = parseInt(col.dataset.day, 10);
        const rect      = col.getBoundingClientRect();

        if (_dragBlockId !== null) {
            const snapMins = _snapToGrid(e.clientY - rect.top);
            let newStartM  = _gridHourStart * 60 + snapMins;
            let newEndM    = newStartM + _dragBlockDuration;

            // Clamp so the block fits within the visible range
            if (newEndM > HOUR_END * 60 + 59) {
                newEndM   = HOUR_END * 60 + 59;
                newStartM = newEndM - _dragBlockDuration;
            }
            if (newStartM < _gridHourStart * 60) {
                newStartM = _gridHourStart * 60;
                newEndM   = Math.min(newStartM + _dragBlockDuration, HOUR_END * 60 + 59);
            }

            console.debug('[weekly:drop]', { blockId: _dragBlockId, day: targetDay,
                newStart: newStartM, newEnd: newEndM });
            const saved = await updateBlock(_dragBlockId, {
                day_of_week: targetDay,
                start_time:  _minsToTime(newStartM),
                end_time:    _minsToTime(newEndM),
            });
            if (saved) _render();
        } else if (_dragTaskId !== null) {
            const snapMins = _snapToGrid(e.clientY - rect.top);
            const startM   = Math.max(_gridHourStart * 60, _gridHourStart * 60 + snapMins);
            const endM     = Math.min(startM + 60, HOUR_END * 60 + 59);

            openBlockModal({
                mode:              'create',
                day:               targetDay,
                weekStartIso:      _weekStartIso,
                preselectedTaskId: _dragTaskId,
                startTime:         _minsToTime(startM),
                endTime:           _minsToTime(endM),
            }, () => _render());
        }
        _dragBlockId       = null;
        _dragTaskId        = null;
        _dragBlockDuration = 0;
    });
}

// ── Resize ───────────────────────────────────────────────────────────────────

function _setupResize() {
    if (!_container) return;

    // Absorb clicks on resize handles so they don't bubble to the edit action.
    _container.addEventListener('click', e => {
        if (e.target.closest('.weekly-block-resize')) e.stopPropagation();
    });

    _container.addEventListener('pointerdown', e => {
        const handle = e.target.closest('.weekly-block-resize');
        if (!handle) return;

        e.stopPropagation();
        e.preventDefault(); // prevent mousedown → dragstart chain

        const blockEl = handle.closest('.weekly-block');
        if (!blockEl) return;

        const blockId = blockEl.dataset.blockId;
        const block   = getBlocks().find(b => b.id === blockId);
        if (!block) return;

        const edge = handle.classList.contains('weekly-block-resize-top') ? 'top' : 'bottom';
        handle.setPointerCapture(e.pointerId);
        blockEl.draggable = false; // disable native drag while resizing

        _resize = {
            blockId,
            edge,
            startY:       e.clientY,
            origStartMin: timeToMinutes(block.start_time),
            origEndMin:   timeToMinutes(block.end_time),
            blockEl,
        };
        _resizeDidMove = false;
    });
}

// Window-level pointer handlers used by the resize gesture.
// Defined as named module functions so renderWeekly() can attach them once
// (Fase 5 Antipatrón 4) and they share state via the module-scoped `_resize`.

function _onResizePointerMove(e) {
    if (!_resize) return;
    _resizeDidMove = true;

    const { edge, startY, origStartMin, origEndMin, blockEl } = _resize;
    const deltaY = e.clientY - startY;

    if (edge === 'bottom') {
        const snapped    = Math.round((origEndMin + deltaY / PX_PER_HOUR * 60) / SNAP_MINUTES) * SNAP_MINUTES;
        const clampedEnd = Math.min(Math.max(snapped, origStartMin + SNAP_MINUTES), HOUR_END * 60 + 59);
        blockEl.style.height = (clampedEnd - origStartMin) / 60 * PX_PER_HOUR + 'px';
    } else {
        const snapped      = Math.round((origStartMin + deltaY / PX_PER_HOUR * 60) / SNAP_MINUTES) * SNAP_MINUTES;
        const clampedStart = Math.min(Math.max(snapped, _gridHourStart * 60), origEndMin - SNAP_MINUTES);
        blockEl.style.top    = (clampedStart - _gridHourStart * 60) / 60 * PX_PER_HOUR + 'px';
        blockEl.style.height = (origEndMin - clampedStart) / 60 * PX_PER_HOUR + 'px';
    }
}

async function _onResizePointerUp() {
    if (!_resize) return;
    const { blockId, origStartMin, origEndMin, blockEl } = _resize;
    _resize = null;
    blockEl.draggable = true;

    if (!_resizeDidMove) return;

    // Suppress the click that fires after pointerup to prevent opening edit modal.
    window.addEventListener('click', ev => ev.stopPropagation(), { once: true, capture: true });

    const newTop    = parseFloat(blockEl.style.top);
    const newHeight = parseFloat(blockEl.style.height);
    const newStartM = Math.round(_gridHourStart * 60 + newTop    / PX_PER_HOUR * 60);
    const newEndM   = Math.round(newStartM        + newHeight / PX_PER_HOUR * 60);

    const saved = await updateBlock(blockId, {
        start_time: _minsToTime(newStartM),
        end_time:   _minsToTime(newEndM),
    });

    if (!saved) {
        // Revert DOM to the original position on PATCH failure.
        blockEl.style.top    = (origStartMin - _gridHourStart * 60) / 60 * PX_PER_HOUR + 'px';
        blockEl.style.height = (origEndMin   - origStartMin)        / 60 * PX_PER_HOUR + 'px';
    } else {
        _render();
    }
}

function _onResizePointerCancel() {
    if (!_resize) return;
    const { origStartMin, origEndMin, blockEl } = _resize;
    _resize = null;
    blockEl.draggable = true;
    blockEl.style.top    = (origStartMin - _gridHourStart * 60) / 60 * PX_PER_HOUR + 'px';
    blockEl.style.height = (origEndMin   - origStartMin)        / 60 * PX_PER_HOUR + 'px';
}

// ── Double-click to create ────────────────────────────────────────────────────

function _setupDblClick() {
    if (!_container) return;
    _container.addEventListener('dblclick', e => {
        // Let existing-block double-clicks fall through (single-click already edits)
        if (e.target.closest('.weekly-block')) return;
        // Calendar events are read-only; never start a "create block" gesture
        // from inside an event chip.
        if (e.target.closest('.weekly-event')) return;

        const col = e.target.closest('.weekly-col-body');
        if (!col) return;

        const day      = parseInt(col.dataset.day, 10);
        const rect     = col.getBoundingClientRect();
        const snapMins = _snapToGrid(e.clientY - rect.top);

        const startMins = Math.min(
            _gridHourStart * 60 + snapMins,
            HOUR_END       * 60 - 1,
        );
        const endMins = Math.min(startMins + 60, HOUR_END * 60 + 59);

        openBlockModal({
            mode:         'create',
            day,
            weekStartIso: _weekStartIso,
            startTime:    _minsToTime(startMins),
            endTime:      _minsToTime(endMins),
        }, () => _render());
    });
}

// ── Drag & resize helpers ─────────────────────────────────────────────────────

function _snapToGrid(offsetPx) {
    return Math.round(offsetPx / PX_PER_HOUR * 60 / SNAP_MINUTES) * SNAP_MINUTES;
}

function _minsToTime(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function _updateDropHint(col, clientY) {
    const rect      = col.getBoundingClientRect();
    const snapMins  = _snapToGrid(clientY - rect.top);
    const hintTopPx = snapMins / 60 * PX_PER_HOUR;

    let hint = col.querySelector('.weekly-drop-hint');
    if (!hint) {
        hint = document.createElement('div');
        hint.className = 'weekly-drop-hint';
        col.appendChild(hint);
    }
    hint.style.top = hintTopPx + 'px';
}

// ── Week progress ─────────────────────────────────────────────────────────────

function _renderWeekProgress(days) {
    const now       = Date.now();
    const weekStart = new Date(days[0]);               weekStart.setHours(0, 0, 0, 0);
    const weekEnd   = new Date(days[days.length - 1]); weekEnd.setHours(23, 59, 59, 999);
    // pct ∈ [0, 100]: fraction of the work week elapsed
    const pct     = Math.min(100, Math.max(0,
        ((now - weekStart.getTime()) / (weekEnd.getTime() - weekStart.getTime())) * 100
    ));
    const rounded = Math.round(pct);

    const todayMs  = _today().getTime();
    const todayDay = days.find(d => d.getTime() === todayMs);
    const label    = todayDay ? DAY_NAMES[todayDay.getDay()]
                   : pct >= 100 ? 'Completada' : 'Próxima';

    return `
        <div class="weekly-week-progress">
            <span class="weekly-week-progress-label">${label} · ${rounded}%</span>
            <div class="weekly-week-progress-bar">
                <div class="weekly-week-progress-fill" style="width:${rounded}%"></div>
            </div>
        </div>`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _blockVisible(block) {
    if (block.is_log) return true;  // pre-filtered by the /unified backend service
    // El backend ya filtra tareas completadas/eliminadas. En personales siempre visible.
    if (block.block_type === 'personal') return true;

    const id = block.task_id ?? block.activity_id;
    if (!id) return true;
    const task = STATE.tasks.find(t => String(t.id) === String(id));
    if (!task) return true; // si no está en el board local, mostramos lo que vino del backend
    return !_taskIsCompleted(task);
}

function _taskIsCompleted(task) {
    if (task.type === 'activity') return (task.progress ?? 0) >= 100;
    return task.column === 'completed';
}

function _today() {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
}

function _esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Current-time indicator ────────────────────────────────────────────────────

/**
 * Mounts a red horizontal line inside today's column body and updates it every
 * 60 seconds. Handles three edge cases automatically on each tick:
 *   - Midnight crossing: _today() re-evaluated, line jumps to the new day's column.
 *   - Week navigation: _render() clears _timeLineTimer before calling this again.
 *   - Outside grid hours: line is removed when current hour < _gridHourStart.
 *
 * Formula (mirrors block positioning in _renderBlock / _renderLogBlock):
 *   topPx = (currentHour - _gridHourStart) * PX_PER_HOUR + currentMinute
 * With PX_PER_HOUR = 60, 1 minute = 1 pixel.
 */
function _mountCurrentTimeLine(days) {
    if (_timeLineTimer) {
        clearInterval(_timeLineTimer);
        _timeLineTimer = null;
    }

    const update = () => {
        if (!_container) return;

        // Remove any existing indicator (handles midnight column-switch cleanly)
        _container.querySelectorAll('.weekly-current-time').forEach(el => el.remove());

        const today     = _today();
        const todayDate = days.find(d => d.getTime() === today.getTime());
        if (!todayDate) return; // visible week doesn't include today

        const now = new Date();
        const h   = now.getHours();
        const m   = now.getMinutes();

        if (h < _gridHourStart) return; // before grid start (e.g. 5 am when grid starts at 6)

        const topPx     = (h - _gridHourStart) * PX_PER_HOUR + m;
        const timeLabel = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

        const colBody = _container.querySelector(`.weekly-col-body[data-day="${todayDate.getDay()}"]`);
        if (!colBody) return;

        const el = document.createElement('div');
        el.className  = 'weekly-current-time';
        el.style.top  = topPx + 'px';
        el.innerHTML  = `
            <div class="weekly-current-time-dot"></div>
            <div class="weekly-current-time-line"></div>
            <span class="weekly-current-time-label">${timeLabel}</span>`;
        colBody.appendChild(el);
    };

    update(); // paint immediately on render
    _timeLineTimer = setInterval(update, 60_000);
}
