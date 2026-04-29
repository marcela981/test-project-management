/**
 * Shared mini-calendar renderer for quarter / semester views.
 * Stateless: takes year, month, aggMap and returns an HTML string.
 */

import { format, isSameMonth, isToday } from 'date-fns';
import { getMonthGrid } from './month-grid.js';

const MONTH_NAMES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const DAY_LABELS  = ['L','M','X','J','V','S','D'];

/**
 * @param {number} year
 * @param {number} month       - 0-based
 * @param {Map}    aggMap      - Map<'yyyy-MM-dd', {taskCount, totalHours}>
 * @param {number} weekStartsOn
 * @returns {string} HTML
 */
export function renderMiniMonth(year, month, aggMap, weekStartsOn = 1) {
    const grid        = getMonthGrid(year, month, weekStartsOn);
    const monthDate   = new Date(year, month, 1);
    const dayLabels   = _rotatedDayLabels(weekStartsOn);

    const cells = grid.map(week =>
        week.map(day => {
            const iso      = format(day, 'yyyy-MM-dd');
            const entry    = aggMap.get(iso);
            const inMonth  = isSameMonth(day, monthDate);
            const today    = isToday(day);
            const hasTasks = entry?.taskCount > 0;
            const load     = entry?.totalHours ?? 0;
            const loadCls  = load >= 8 ? 'hi' : load >= 4 ? 'mid' : load > 0 ? 'lo' : '';

            return `<div class="mini-cal-day${!inMonth ? ' out' : ''}${today ? ' today' : ''}${hasTasks ? ' has-tasks' : ''}" title="${iso}: ${load}h">
                <span class="mini-cal-num">${day.getDate()}</span>
                ${loadCls ? `<span class="mini-cal-dot ${loadCls}"></span>` : ''}
            </div>`;
        }).join('')
    ).join('');

    return `
        <div class="mini-cal-card" data-month-card data-month="${month}" data-year="${year}">
            <div class="mini-cal-title">${MONTH_NAMES[month]} ${year}</div>
            <div class="mini-cal-grid">
                ${dayLabels.map(l => `<div class="mini-cal-hdr">${l}</div>`).join('')}
                <div class="mini-cal-sentinel"></div>
                ${cells}
            </div>
        </div>`;
}

/** Skeleton card (before aggregate data loads). */
export function renderMiniMonthSkeleton(year, month) {
    return `
        <div class="mini-cal-card" data-month-card data-month="${month}" data-year="${year}">
            <div class="mini-cal-title">${MONTH_NAMES[month]} ${year}</div>
            <div class="mini-cal-grid mini-cal-skeleton">
                <div class="mini-cal-sentinel"></div>
            </div>
        </div>`;
}

function _rotatedDayLabels(weekStartsOn) {
    return weekStartsOn === 0
        ? ['D','L','M','X','J','V','S']
        : DAY_LABELS;
}
