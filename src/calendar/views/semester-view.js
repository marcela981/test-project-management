/** Semester view: 6 mini-month calendars with aggregate load dots. */

import { startOfMonth, endOfMonth, addMonths } from 'date-fns';
import { fetchAggregate, buildAggMap } from '../data/aggregate-api.js';
import { renderMiniMonth, renderMiniMonthSkeleton } from '../shared/mini-calendar.js';

let _container = null;
let _date      = new Date();

// ---------------------------------------------------------------------------

export function renderSemesterView(container, refDate) {
    _container = container;
    if (refDate) _date = new Date(refDate);
    _renderSkeleton();
    _loadAndRender();
}

export function navigateSemesterNext()  { _date = addMonths(_date, 6); _renderSkeleton(); _loadAndRender(); }
export function navigateSemesterPrev()  { _date = addMonths(_date, -6); _renderSkeleton(); _loadAndRender(); }
export function navigateSemesterToday() { _date = new Date(); _renderSkeleton(); _loadAndRender(); }

// ---------------------------------------------------------------------------

function _semesterStart(d) {
    const m = d.getMonth() < 6 ? 0 : 6;
    return new Date(d.getFullYear(), m, 1);
}

function _renderSkeleton() {
    if (!_container) return;
    const ss     = _semesterStart(_date);
    const months = Array.from({ length: 6 }, (_, i) => addMonths(ss, i));

    _container.innerHTML = `
        <div class="multi-cal-view semester-view">
            ${_nav(ss)}
            <div class="multi-cal-grid cols-3">
                ${months.map(m => renderMiniMonthSkeleton(m.getFullYear(), m.getMonth())).join('')}
            </div>
        </div>`;
}

async function _loadAndRender() {
    const ss  = _semesterStart(_date);
    const end = endOfMonth(addMonths(ss, 5));
    const entries = await fetchAggregate(startOfMonth(ss), end);
    const aggMap  = buildAggMap(entries);

    if (!_container) return;
    const months = Array.from({ length: 6 }, (_, i) => addMonths(ss, i));

    _container.innerHTML = `
        <div class="multi-cal-view semester-view">
            ${_nav(ss)}
            <div class="multi-cal-grid cols-3">
                ${months.map(m => renderMiniMonth(m.getFullYear(), m.getMonth(), aggMap)).join('')}
            </div>
        </div>`;
}

function _nav(ss) {
    const sem = ss.getMonth() === 0 ? 1 : 2;
    return `<div class="cal-nav-bar">
        <button class="cal-nav-btn" data-action="semester-prev"><i class="fas fa-chevron-left"></i></button>
        <span class="cal-nav-title">S${sem} ${ss.getFullYear()}</span>
        <button class="cal-nav-btn" data-action="semester-today">Hoy</button>
        <button class="cal-nav-btn" data-action="semester-next"><i class="fas fa-chevron-right"></i></button>
    </div>`;
}
