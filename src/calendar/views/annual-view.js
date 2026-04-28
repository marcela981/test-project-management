/**
 * Annual view: 12 mini-month calendars.
 * IntersectionObserver loads aggregate data per row of months as they enter
 * the viewport, keeping initial render under 100 ms.
 * performance.mark/measure tracks render time.
 */

import { startOfMonth, endOfMonth, addMonths, format } from 'date-fns';
import { fetchAggregate, buildAggMap } from '../data/aggregate-api.js';
import { renderMiniMonth, renderMiniMonthSkeleton } from '../shared/mini-calendar.js';

let _container = null;
let _year      = new Date().getFullYear();
let _observer  = null;

// ---------------------------------------------------------------------------

export function renderAnnualView(container, refDate) {
    _container = container;
    if (refDate) _year = new Date(refDate).getFullYear();
    _render();
}

export function navigateAnnualNext()  { _year++; _render(); }
export function navigateAnnualPrev()  { _year--; _render(); }
export function navigateAnnualToday() { _year = new Date().getFullYear(); _render(); }

// ---------------------------------------------------------------------------

function _render() {
    performance.mark('annual-render-start');

    if (_observer) { _observer.disconnect(); _observer = null; }
    if (!_container) return;

    const months = Array.from({ length: 12 }, (_, i) => ({ year: _year, month: i }));

    _container.innerHTML = `
        <div class="multi-cal-view annual-view">
            ${_nav()}
            <div class="multi-cal-grid cols-3" id="annualGrid">
                ${months.map(({ year, month }) =>
                    `<div class="annual-month-placeholder" data-year="${year}" data-month="${month}">
                        ${renderMiniMonthSkeleton(year, month)}
                    </div>`
                ).join('')}
            </div>
        </div>`;

    performance.mark('annual-render-dom');
    performance.measure('annual-dom-build', 'annual-render-start', 'annual-render-dom');

    _setupObserver();
}

function _setupObserver() {
    const grid = _container?.querySelector('#annualGrid');
    if (!grid) return;

    const pending = new Set();

    _observer = new IntersectionObserver(entries => {
        const toLoad = entries
            .filter(e => e.isIntersecting)
            .map(e => e.target);

        if (!toLoad.length) return;

        toLoad.forEach(el => {
            _observer.unobserve(el);
            pending.add(el);
        });

        _loadRow(Array.from(pending));
        pending.clear();

    }, { root: null, rootMargin: '200px', threshold: 0 });

    grid.querySelectorAll('.annual-month-placeholder').forEach(el => _observer.observe(el));
}

async function _loadRow(placeholders) {
    if (!placeholders.length) return;

    const years  = placeholders.map(p => parseInt(p.dataset.year,  10));
    const months = placeholders.map(p => parseInt(p.dataset.month, 10));

    const from = startOfMonth(new Date(Math.min(...years),  Math.min(...months), 1));
    const to   = endOfMonth(  new Date(Math.max(...years),  Math.max(...months), 1));

    const entries = await fetchAggregate(from, to);
    const aggMap  = buildAggMap(entries);

    placeholders.forEach(el => {
        const y = parseInt(el.dataset.year,  10);
        const m = parseInt(el.dataset.month, 10);
        el.innerHTML = renderMiniMonth(y, m, aggMap);
    });

    performance.mark('annual-render-end');
    performance.measure('annual-total', 'annual-render-start', 'annual-render-end');
}

function _nav() {
    return `<div class="cal-nav-bar">
        <button class="cal-nav-btn" data-action="annual-prev"><i class="fas fa-chevron-left"></i></button>
        <span class="cal-nav-title">${_year}</span>
        <button class="cal-nav-btn" data-action="annual-today">Hoy</button>
        <button class="cal-nav-btn" data-action="annual-next"><i class="fas fa-chevron-right"></i></button>
    </div>`;
}
