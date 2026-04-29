/** Single-day timeline view — reuses weekly-data public API. */

import { format, isToday } from 'date-fns';
import { fetchPreferences, getPreferences, fetchBlocks, getBlocks, timeToMinutes } from '../../weekly/weekly-data.js';
import { renderPeriodNav } from '../shared/period-nav.js';
import { computeBlockLayout } from '../../weekly/weekly-layout.js';
import { openBlockModal } from '../../weekly/weekly-modal.js';

const HOUR_START   = 6;
const HOUR_END     = 23;
const PX_PER_HOUR  = 72;
const SNAP_MINUTES = 15;

const MONTH_NAMES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const DAY_NAMES   = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

let _container   = null;
let _date        = new Date();
let _toolbarHtml = '';

// ---------------------------------------------------------------------------

export function renderDayView(container, refDate, toolbarHtml = '') {
    _container   = container;
    _toolbarHtml = toolbarHtml;
    if (refDate) _date = new Date(refDate);
    _render();

    if (!container._dayViewInit) {
        container._dayViewInit = true;
        container.addEventListener('dblclick', _onDblClick);
        window.addEventListener('preferences-updated', () => _render());
    }
}

export function navigateDayNext() { _date.setDate(_date.getDate() + 1); _render(); }
export function navigateDayPrev() { _date.setDate(_date.getDate() - 1); _render(); }
export function navigateDayToday() { _date = new Date(); _render(); }

// ---------------------------------------------------------------------------

async function _render() {
    if (!_container) return;

    await fetchPreferences();
    const prefs      = getPreferences();
    const iso        = format(_date, 'yyyy-MM-dd');
    const weekIso    = _weekStartIso(_date, prefs);
    await fetchBlocks(weekIso);

    const dayOfWeek  = _date.getDay();
    const blocks     = getBlocks().filter(b => b.day === dayOfWeek);
    const layout     = computeBlockLayout(blocks);
    const todayFlag  = isToday(_date);
    const label      = `${DAY_NAMES[dayOfWeek]}, ${_date.getDate()} ${MONTH_NAMES[_date.getMonth()]} ${_date.getFullYear()}`;

    _container.innerHTML = `
        <div class="day-view">
            ${renderPeriodNav({ label, actionPrefix: 'day', extraContent: _toolbarHtml ? `<div class="cal-period-nav-views" role="toolbar" aria-label="Vista del calendario">${_toolbarHtml}</div>` : '' })}
            <div class="day-view-scroll">
                <div class="day-time-axis">
                    ${_timeAxis()}
                </div>
                <div class="day-col-body" data-day="${dayOfWeek}" data-iso="${iso}" style="position:relative; height:${(HOUR_END - HOUR_START + 1) * PX_PER_HOUR}px">
                    ${_currentTimeLine(todayFlag)}
                    ${blocks.map(b => _renderBlock(b, layout)).join('')}
                </div>
            </div>
        </div>`;

    _scheduleTimeLine();
}

function _timeAxis() {
    let html = '';
    for (let h = HOUR_START; h <= HOUR_END; h++) {
        html += `<div class="day-time-slot" style="height:${PX_PER_HOUR}px">${String(h).padStart(2,'0')}:00</div>`;
    }
    return html;
}

function _currentTimeLine(show) {
    if (!show) return '';
    const now  = new Date();
    const mins = now.getHours() * 60 + now.getMinutes() - HOUR_START * 60;
    if (mins < 0) return '';
    const top  = (mins / 60) * PX_PER_HOUR;
    return `<div class="day-now-line" style="top:${top}px"></div>`;
}

function _renderBlock(block, layout) {
    const startMins  = timeToMinutes(block.start_time) - HOUR_START * 60;
    const endMins    = timeToMinutes(block.end_time)   - HOUR_START * 60;
    const top        = (startMins / 60) * PX_PER_HOUR;
    const height     = Math.max(((endMins - startMins) / 60) * PX_PER_HOUR, 20);
    const { column = 0, totalColumns = 1 } = layout.get(block.id) ?? {};
    const width      = 100 / totalColumns;
    const left       = width * column;

    return `<div class="day-block" style="top:${top}px;height:${height}px;left:${left}%;width:${width}%;background:${block.color || 'var(--color-primary)'}"
                data-action="weekly-edit-block" data-block-id="${block.id}">
        <div class="day-block-title">${_esc(block.title)}</div>
        <div class="day-block-time">${block.start_time}–${block.end_time}</div>
    </div>`;
}

function _onDblClick(e) {
    if (e.target.closest('.day-block')) return;
    const col = e.target.closest('.day-col-body');
    if (!col) return;
    const rect     = col.getBoundingClientRect();
    const rawMins  = ((e.clientY - rect.top) / PX_PER_HOUR) * 60;
    const snapMins = Math.round(rawMins / SNAP_MINUTES) * SNAP_MINUTES;
    const startM   = Math.max(0, Math.min(snapMins + HOUR_START * 60, HOUR_END * 60 - 1));
    const endM     = Math.min(startM + 60, (HOUR_END + 1) * 60 - 1);
    const dayOfWeek = parseInt(col.dataset.day, 10);
    const weekIso  = _weekStartIso(_date, getPreferences());
    openBlockModal({ mode: 'create', day: dayOfWeek, weekStartIso: weekIso, startTime: _minsToTime(startM), endTime: _minsToTime(endM) }, () => _render());
}

function _scheduleTimeLine() {
    const line = _container?.querySelector('.day-now-line');
    if (!line) return;
    setTimeout(() => {
        const now  = new Date();
        const mins = now.getHours() * 60 + now.getMinutes() - HOUR_START * 60;
        line.style.top = `${(mins / 60) * PX_PER_HOUR}px`;
        _scheduleTimeLine();
    }, 30_000);
}

function _weekStartIso(date, prefs) {
    const { week_start_day = 1 } = prefs ?? {};
    const d = new Date(date);
    const diff = (d.getDay() - week_start_day + 7) % 7;
    d.setDate(d.getDate() - diff);
    return format(d, 'yyyy-MM-dd');
}

function _minsToTime(m) {
    return `${String(Math.floor(m / 60)).padStart(2,'0')}:${String(m % 60).padStart(2,'0')}`;
}

function _esc(s) {
    return (s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
