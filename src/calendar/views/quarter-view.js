/** Quarter view: 3 mini-month calendars with aggregate load dots. */

import { startOfMonth, endOfMonth, addMonths } from 'date-fns';
import { fetchAggregate, buildAggMap } from '../data/aggregate-api.js';
import { renderMiniMonth, renderMiniMonthSkeleton } from '../shared/mini-calendar.js';
import { renderPeriodNav } from '../shared/period-nav.js';

let _container   = null;
let _date        = new Date();
let _toolbarHtml = '';

// ---------------------------------------------------------------------------

export function renderQuarterView(container, refDate, toolbarHtml = '') {
    _container   = container;
    _toolbarHtml = toolbarHtml;
    if (refDate) _date = new Date(refDate);
    _renderSkeleton();
    _loadAndRender();
}

export function navigateQuarterNext()  { _date = addMonths(_date, 3); _renderSkeleton(); _loadAndRender(); }
export function navigateQuarterPrev()  { _date = addMonths(_date, -3); _renderSkeleton(); _loadAndRender(); }
export function navigateQuarterToday() { _date = new Date(); _renderSkeleton(); _loadAndRender(); }

// ---------------------------------------------------------------------------

function _quarterStart(d) {
    const m = Math.floor(d.getMonth() / 3) * 3;
    return new Date(d.getFullYear(), m, 1);
}

function _renderSkeleton() {
    if (!_container) return;
    const qs     = _quarterStart(_date);
    const months = [qs, addMonths(qs, 1), addMonths(qs, 2)];

    _container.innerHTML = `
        <div class="multi-cal-view quarter-view">
            ${_nav(qs)}
            <div class="multi-cal-grid cols-3">
                ${months.map(m => renderMiniMonthSkeleton(m.getFullYear(), m.getMonth())).join('')}
            </div>
        </div>`;
}

async function _loadAndRender() {
    const qs  = _quarterStart(_date);
    const end = endOfMonth(addMonths(qs, 2));
    const entries = await fetchAggregate(startOfMonth(qs), end);
    const aggMap  = buildAggMap(entries);

    if (!_container) return;
    const months = [qs, addMonths(qs, 1), addMonths(qs, 2)];

    _container.innerHTML = `
        <div class="multi-cal-view quarter-view">
            ${_nav(qs)}
            <div class="multi-cal-grid cols-3">
                ${months.map(m => renderMiniMonth(m.getFullYear(), m.getMonth(), aggMap)).join('')}
            </div>
        </div>`;
}

function _nav(qs) {
    const q = Math.floor(qs.getMonth() / 3) + 1;
    const viewsHtml = _toolbarHtml
        ? `<div class="cal-period-nav-views" role="toolbar" aria-label="Vista del calendario">${_toolbarHtml}</div>`
        : '';
    return renderPeriodNav({ label: `Q${q} ${qs.getFullYear()}`, actionPrefix: 'quarter', extraContent: viewsHtml });
}
