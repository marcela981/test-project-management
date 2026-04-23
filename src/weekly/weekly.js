/** Vista Weekly Tracker: navegación, indicadores, columnas de días y bloques. */

import { STATE } from '../core/state.js';
import {
    fetchPreferences, getPreferences,
    fetchBlocks, getBlocks, updateBlock, removeBlock,
    getWeekDays, weekStartIso,
    timeToMinutes, blockDurationH, dayHours,
} from './weekly-data.js';
import { openBlockModal } from './weekly-modal.js';

const HOUR_START   = 6;
const HOUR_END     = 23;
const PX_PER_HOUR  = 60;
const AVAIL_START  = 7;
const AVAIL_END    = 16;

const DAY_NAMES   = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTH_NAMES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

let _refDate       = new Date();
let _container     = null;
let _dragBlockId   = null;
let _dragTaskId    = null;
let _weekStartIso  = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function renderWeekly(container) {
    _container = container;
    _render();

    if (!container._weeklyInit) {
        container._weeklyInit = true;
        _setupDragDrop();
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
        case 'weekly-remove-block': {
            const blockId = parseInt(el.dataset.blockId, 10);
            removeBlock(blockId).then(ok => { if (ok) _render(); });
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

        const view       = _container.querySelector('.weekly-view');
        const indicators = _container.querySelector('.weekly-indicators');
        const colHeader  = _container.querySelector('.weekly-col-header');
        if (!view) return;

        if (indicators) view.style.setProperty('--weekly-indicators-height', indicators.offsetHeight + 'px');
        if (colHeader)  view.style.setProperty('--weekly-col-header-height', colHeader.offsetHeight + 'px');
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
                ${colBlocks.map(_renderBlock).join('')}
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

function _renderBlock(block) {
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

    const styleBase = `top:${top}px;height:${height}px`;

    return `
        <div class="weekly-block ${blockClass}"
             style="${colorStyle}${styleBase}"
             draggable="true"
             data-block-id="${block.id}">
            <div class="weekly-block-title">${typeIcon}${_esc(title)}</div>
            ${height >= 40
                ? `<div class="weekly-block-time">${block.start_time}–${block.end_time} · ${durH}h</div>`
                : ''}
            <button class="weekly-block-remove"
                    data-action="weekly-remove-block"
                    data-block-id="${block.id}"
                    title="Eliminar bloque">×</button>
        </div>`;
}

// ── Drag & drop ──────────────────────────────────────────────────────────────

function _setupDragDrop() {
    if (!_container) return;

    _container.addEventListener('dragstart', e => {
        const blockEl  = e.target.closest('[data-block-id]');
        const urgentEl = e.target.closest('[data-urgent-task-id]');

        if (blockEl) {
            _dragBlockId = parseInt(blockEl.dataset.blockId, 10);
            _dragTaskId  = null;
            blockEl.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        } else if (urgentEl) {
            _dragTaskId  = urgentEl.dataset.urgentTaskId;
            _dragBlockId = null;
            urgentEl.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'copy';
        }
    }, true);

    _container.addEventListener('dragend', () => {
        _container.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
        _container.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
    }, true);

    _container.addEventListener('dragover', e => {
        const col = e.target.closest('.weekly-col-body');
        if (!col) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = _dragBlockId !== null ? 'move' : 'copy';
        _container.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
        col.classList.add('drop-target');
    });

    _container.addEventListener('dragleave', e => {
        const col = e.target.closest('.weekly-col-body');
        if (col && !col.contains(e.relatedTarget)) col.classList.remove('drop-target');
    });

    _container.addEventListener('drop', async e => {
        const col = e.target.closest('.weekly-col-body');
        if (!col) return;
        e.preventDefault();
        col.classList.remove('drop-target');
        const targetDay = parseInt(col.dataset.day, 10);

        if (_dragBlockId !== null) {
            const ok = await updateBlock(_dragBlockId, { day_of_week: targetDay });
            if (ok) _render();
        } else if (_dragTaskId !== null) {
            openBlockModal(targetDay, _weekStartIso, () => _render(), _dragTaskId);
        }
        _dragBlockId = null;
        _dragTaskId  = null;
    });
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
