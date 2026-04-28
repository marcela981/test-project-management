/** Vista Weekly Tracker: navegación, indicadores, columnas de días y bloques. */

import { STATE } from '../core/state.js';
import {
    fetchPreferences, getPreferences,
    fetchBlocks, getBlocks, updateBlock, removeBlock,
    getWeekDays, weekStartIso,
    timeToMinutes, blockDurationH, dayHours,
} from './weekly-data.js';
import { computeBlockLayout } from './weekly-layout.js';
import { openBlockModal, askScope } from './weekly-modal.js';

const HOUR_START   = 6;
const HOUR_END     = 23;
const PX_PER_HOUR  = 60;
const AVAIL_START  = 7;
const AVAIL_END    = 16;
const SNAP_MINUTES = 15;

const DAY_NAMES   = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTH_NAMES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

let _refDate           = new Date();
let _container         = null;
let _dragBlockId       = null;
let _dragTaskId        = null;
let _dragBlockDuration = 0;
let _weekStartIso      = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function renderWeekly(container) {
    _container = container;
    _render();

    if (!container._weeklyInit) {
        container._weeklyInit = true;
        _setupDragDrop();
        _setupResize();
        _setupDblClick();
        window.addEventListener('preferences-updated', () => _render());
        window.addEventListener('resize', _updateStickyMetrics);
    }
}

export function handleWeeklyClick(action, el) {
    switch (action) {
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
    }
    return false;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

async function _render() {
    if (!_container) return;

    await fetchPreferences();
    const prefs = getPreferences();
    const days  = getWeekDays(_refDate, prefs);
    _weekStartIso = weekStartIso(_refDate, prefs);

    await fetchBlocks(_weekStartIso);
    const blocks = getBlocks();
    const today  = _today();

    _container.innerHTML = `
        <div class="weekly-view">
            ${_renderNav(days)}
            <div class="weekly-scroll">
                ${_renderIndicators(days, blocks)}
                ${_renderWeekProgress(days)}
                <div class="weekly-grid">
                    ${_renderTimeAxis()}
                    <div class="weekly-columns" id="weeklyColumns">
                        ${days.map(d => _renderColumn(d, blocks, today)).join('')}
                    </div>
                </div>
            </div>
        </div>`;

    _updateStickyMetrics();
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

    return `
        <div class="weekly-nav">
            <button class="weekly-nav-btn" data-action="weekly-prev" title="Semana anterior">
                <i class="fas fa-chevron-left"></i>
            </button>
            <span class="weekly-nav-range">${range}</span>
            <button class="weekly-nav-btn" data-action="weekly-next" title="Semana siguiente">
                <i class="fas fa-chevron-right"></i>
            </button>
            <button class="weekly-nav-btn weekly-nav-today" data-action="weekly-today">Hoy</button>
        </div>`;
}

// ── Time axis ────────────────────────────────────────────────────────────────

function _renderTimeAxis() {
    const labels = [];
    for (let h = HOUR_START; h <= HOUR_END; h++) {
        const label = h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;
        labels.push(`<div class="weekly-hour-label">${label}</div>`);
    }
    return `<div class="weekly-time-axis"><div class="weekly-time-axis-spacer"></div>${labels.join('')}</div>`;
}

// ── Day column ───────────────────────────────────────────────────────────────

function _renderColumn(date, blocks, today) {
    const dn         = date.getDay();
    const isToday    = date.getTime() === today.getTime();
    const colBlocks  = blocks.filter(b => b.day === dn && _blockVisible(b));
    const hasBlocks  = colBlocks.length > 0;
    const h          = dayHours(colBlocks, dn);
    const loadPct    = Math.min(100, Math.round((h / 8) * 100));
    const overloaded = h > 10 ? 'overloaded' : '';
    const layout     = computeBlockLayout(colBlocks);

    const totalSlots = HOUR_END - HOUR_START + 1;
    const hourLines  = Array.from({ length: totalSlots }, (_, i) =>
        `<div class="weekly-hour-line" style="top:${i * PX_PER_HOUR}px"></div>`
    ).join('');

    const availTop    = (AVAIL_START - HOUR_START) * PX_PER_HOUR;
    const availHeight = (AVAIL_END   - AVAIL_START) * PX_PER_HOUR;

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
            <div class="weekly-col-body${hasBlocks ? '' : ' no-blocks'}" data-day="${dn}">
                <div class="weekly-availability-zone"
                     style="top:${availTop}px;height:${availHeight}px"></div>
                ${hourLines}
                ${!hasBlocks ? '<div class="weekly-no-blocks-text"><i class="fas fa-calendar-plus"></i><br>Sin bloques planeados</div>' : ''}
                ${colBlocks.map(b => _renderBlock(b, layout.get(b.id))).join('')}
            </div>
            <div class="weekly-col-footer">
                <button class="weekly-add-btn"
                        data-action="weekly-add-block"
                        data-day="${dn}"
                        title="Agregar bloque">+</button>
            </div>
        </div>`;
}

// ── Block ────────────────────────────────────────────────────────────────────

function _renderBlock(block, blockLayout = { column: 0, totalColumns: 1 }) {
    const { column, totalColumns } = blockLayout;
    const top        = timeToMinutes(block.start_time) - HOUR_START * 60;
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

    const styleBase = `top:${top}px;height:${height}px;${posStyle}`;

    return `
        <div class="weekly-block ${blockClass}"
             style="${colorStyle}${styleBase}"
             draggable="true"
             data-action="weekly-edit-block"
             data-block-id="${block.id}">
            <div class="weekly-block-resize weekly-block-resize-top"></div>
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
            let newStartM  = HOUR_START * 60 + snapMins;
            let newEndM    = newStartM + _dragBlockDuration;

            // Clamp so the block fits within the visible range
            if (newEndM > HOUR_END * 60 + 59) {
                newEndM   = HOUR_END * 60 + 59;
                newStartM = newEndM - _dragBlockDuration;
            }
            if (newStartM < HOUR_START * 60) {
                newStartM = HOUR_START * 60;
                newEndM   = Math.min(newStartM + _dragBlockDuration, HOUR_END * 60 + 59);
            }

            const saved = await updateBlock(_dragBlockId, {
                day_of_week: targetDay,
                start_time:  _minsToTime(newStartM),
                end_time:    _minsToTime(newEndM),
            });
            if (saved) _render();
        } else if (_dragTaskId !== null) {
            const snapMins = _snapToGrid(e.clientY - rect.top);
            const startM   = Math.max(HOUR_START * 60, HOUR_START * 60 + snapMins);
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

    let _resize        = null;
    let _resizeDidMove = false;

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

    window.addEventListener('pointermove', e => {
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
            const clampedStart = Math.min(Math.max(snapped, HOUR_START * 60), origEndMin - SNAP_MINUTES);
            blockEl.style.top    = (clampedStart - HOUR_START * 60) / 60 * PX_PER_HOUR + 'px';
            blockEl.style.height = (origEndMin - clampedStart) / 60 * PX_PER_HOUR + 'px';
        }
    });

    const _commitResize = async () => {
        if (!_resize) return;
        const { blockId, origStartMin, origEndMin, blockEl } = _resize;
        _resize = null;
        blockEl.draggable = true;

        if (!_resizeDidMove) return;

        // Suppress the click that fires after pointerup to prevent opening edit modal.
        window.addEventListener('click', ev => ev.stopPropagation(), { once: true, capture: true });

        const newTop    = parseFloat(blockEl.style.top);
        const newHeight = parseFloat(blockEl.style.height);
        const newStartM = Math.round(HOUR_START * 60 + newTop    / PX_PER_HOUR * 60);
        const newEndM   = Math.round(newStartM        + newHeight / PX_PER_HOUR * 60);

        const saved = await updateBlock(blockId, {
            start_time: _minsToTime(newStartM),
            end_time:   _minsToTime(newEndM),
        });

        if (!saved) {
            // Revert DOM to the original position on PATCH failure.
            blockEl.style.top    = (origStartMin - HOUR_START * 60) / 60 * PX_PER_HOUR + 'px';
            blockEl.style.height = (origEndMin   - origStartMin)    / 60 * PX_PER_HOUR + 'px';
        } else {
            _render();
        }
    };

    window.addEventListener('pointerup', _commitResize);

    window.addEventListener('pointercancel', () => {
        if (!_resize) return;
        const { origStartMin, origEndMin, blockEl } = _resize;
        _resize = null;
        blockEl.draggable = true;
        blockEl.style.top    = (origStartMin - HOUR_START * 60) / 60 * PX_PER_HOUR + 'px';
        blockEl.style.height = (origEndMin   - origStartMin)    / 60 * PX_PER_HOUR + 'px';
    });
}

// ── Double-click to create ────────────────────────────────────────────────────

function _setupDblClick() {
    if (!_container) return;
    _container.addEventListener('dblclick', e => {
        // Let existing-block double-clicks fall through (single-click already edits)
        if (e.target.closest('.weekly-block')) return;

        const col = e.target.closest('.weekly-col-body');
        if (!col) return;

        const day      = parseInt(col.dataset.day, 10);
        const rect     = col.getBoundingClientRect();
        const snapMins = _snapToGrid(e.clientY - rect.top);

        const startMins = Math.min(
            HOUR_START * 60 + snapMins,
            HOUR_END   * 60 - 1,
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
