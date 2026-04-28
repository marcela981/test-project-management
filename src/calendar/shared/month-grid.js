/**
 * Pure, memoized month-grid utility.
 * getMonthGrid(year, month, weekStartsOn?) → frozen array of frozen 7-date weeks.
 * Result is immutable — safe to share across renders without copying.
 */

import { startOfWeek, endOfWeek, endOfMonth, addDays } from 'date-fns';

const _cache = new Map();

/**
 * @param {number} year
 * @param {number} month  - 0-based (Jan=0)
 * @param {number} weekStartsOn - 0=Sun, 1=Mon (default 1)
 * @returns {ReadonlyArray<ReadonlyArray<Date>>}
 */
export function getMonthGrid(year, month, weekStartsOn = 1) {
    const key = `${year}-${month}-${weekStartsOn}`;
    if (_cache.has(key)) return _cache.get(key);

    const monthStart = new Date(year, month, 1);
    const gridStart  = startOfWeek(monthStart, { weekStartsOn });
    const gridEnd    = endOfWeek(endOfMonth(monthStart), { weekStartsOn });

    const weeks = [];
    let cur = gridStart;
    while (cur <= gridEnd) {
        weeks.push(Object.freeze(Array.from({ length: 7 }, (_, i) => addDays(cur, i))));
        cur = addDays(cur, 7);
    }

    const result = Object.freeze(weeks);
    _cache.set(key, result);
    return result;
}
