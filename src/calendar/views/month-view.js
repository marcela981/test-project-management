/** Month view: 7×N grid with per-day aggregate badges. */

import { format, isToday, isSameMonth, startOfMonth, endOfMonth } from 'date-fns';
import { getMonthGrid } from '../shared/month-grid.js';
import { fetchAggregate, buildAggMap } from '../data/aggregate-api.js';

const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const DAY_HDRS    = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];

let _container = null;
let _date      = new Date();

// ---------------------------------------------------------------------------

export function renderMonthView(container, refDate) {
    _container = container;
    if (refDate) _date = new Date(refDate);
    _renderSkeleton();
    _loadAndRender();
}

export function navigateMonthNext()  { _date = new Date(_date.getFullYear(), _date.getMonth() + 1, 1); _renderSkeleton(); _loadAndRender(); }
export function navigateMonthPrev()  { _date = new Date(_date.getFullYear(), _date.getMonth() - 1, 1); _renderSkeleton(); _loadAndRender(); }
export function navigateMonthToday() { _date = new Date(); _renderSkeleton(); _loadAndRender(); }

// ---------------------------------------------------------------------------

function _renderSkeleton() {
    if (!_container) return;
    const y = _date.getFullYear(), m = _date.getMonth();
    _container.innerHTML = `
        <div class="month-view">
            ${_nav(y, m)}
            <div class="month-grid-wrap">
                ${DAY_HDRS.map(h => `<div class="month-hdr">${h}</div>`).join('')}
                <div class="month-loading">Cargando…</div>
            </div>
        </div>`;
}

async function _loadAndRender() {
    const y = _date.getFullYear(), m = _date.getMonth();
    const from = startOfMonth(new Date(y, m, 1));
    const to   = endOfMonth(from);
    const entries = await fetchAggregate(from, to);
    const aggMap  = buildAggMap(entries);
    _renderFull(y, m, aggMap);
}

function _renderFull(y, m, aggMap) {
    if (!_container) return;
    const grid      = getMonthGrid(y, m, 1);
    const monthDate = new Date(y, m, 1);

    const cells = grid.flatMap(week =>
        week.map(day => {
            const iso     = format(day, 'yyyy-MM-dd');
            const entry   = aggMap.get(iso);
            const inMonth = isSameMonth(day, monthDate);
            const today   = isToday(day);
            const load    = entry?.totalHours ?? 0;
            const tasks   = entry?.taskCount  ?? 0;
            const loadCls = load >= 8 ? 'hi' : load >= 4 ? 'mid' : load > 0 ? 'lo' : '';

            return `<div class="month-cell${!inMonth ? ' out' : ''}${today ? ' today' : ''}" data-iso="${iso}">
                <span class="month-cell-num">${day.getDate()}</span>
                ${tasks > 0 ? `<span class="month-badge ${loadCls}">${tasks} bloque${tasks > 1 ? 's' : ''}</span>` : ''}
            </div>`;
        })
    ).join('');

    _container.innerHTML = `
        <div class="month-view">
            ${_nav(y, m)}
            <div class="month-grid-wrap">
                ${DAY_HDRS.map(h => `<div class="month-hdr">${h}</div>`).join('')}
                ${cells}
            </div>
        </div>`;
}

function _nav(y, m) {
    return `<div class="cal-nav-bar">
        <button class="cal-nav-btn" data-action="month-prev"><i class="fas fa-chevron-left"></i></button>
        <span class="cal-nav-title">${MONTH_NAMES[m]} ${y}</span>
        <button class="cal-nav-btn" data-action="month-today">Hoy</button>
        <button class="cal-nav-btn" data-action="month-next"><i class="fas fa-chevron-right"></i></button>
    </div>`;
}
