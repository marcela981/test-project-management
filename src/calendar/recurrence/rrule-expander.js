/**
 * Client-side RRule expansion for master recurring blocks.
 *
 * Architecture decision: server returns master blocks (is_master=true) with
 * rrule_string; client expands to virtual occurrences per week range.
 * Rationale: <500 rules/user makes client expansion fast and avoids server
 * materialisation overhead (see Phase 3 spec).
 */

import { RRule, RRuleSet } from 'rrule';

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Expand master blocks into virtual occurrences within [rangeStart, rangeEnd].
 *
 * @param {Array<Object>} masterBlocks  - blocks with is_master=true and rrule_string
 * @param {Date}          rangeStart    - first day of the range (local midnight)
 * @param {Date}          rangeEnd      - last day of the range (local midnight)
 * @returns {Array<Object>} virtual block instances for the range
 */
export function expandBlocks(masterBlocks, rangeStart, rangeEnd) {
    if (!masterBlocks.length) return [];

    const utcStart = _utcMidnight(rangeStart);
    const utcEnd   = _utcMidnight(rangeEnd);
    const result   = [];

    for (const master of masterBlocks) {
        if (!master.rrule_string) continue;
        try {
            result.push(..._expandOne(master, utcStart, utcEnd));
        } catch (err) {
            console.error('[rrule-expander] failed to expand', master.id, err);
        }
    }
    return result;
}

/**
 * Convert modal form state to an RFC 5545 RRULE string, or null if freq='none'.
 *
 * @param {{ freq: string, interval?: number, unit?: string, days?: string[], until?: string }} state
 * @returns {string|null}
 *
 * Examples:
 *   formStateToRRule({ freq: 'weekly' })                          → 'FREQ=WEEKLY'
 *   formStateToRRule({ freq: 'custom', unit: 'weekly', interval: 2, days: ['MO','FR'] })
 *     → 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR'
 *   formStateToRRule({ freq: 'daily', until: '2026-12-31' })
 *     → 'FREQ=DAILY;UNTIL=20261231T000000Z'
 */
export function formStateToRRule({ freq, interval = 1, unit = 'weekly', days = [], until = '' }) {
    if (!freq || freq === 'none') return null;

    const effectiveFreq = freq === 'custom' ? unit : freq;
    const freqMap = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' };
    const freqStr = freqMap[effectiveFreq] ?? 'WEEKLY';

    const parts = [`FREQ=${freqStr}`];
    if (Number(interval) > 1) parts.push(`INTERVAL=${Number(interval)}`);
    if (freqStr === 'WEEKLY' && days.length > 0) parts.push(`BYDAY=${days.join(',')}`);
    if (until) parts.push(`UNTIL=${until.replace(/-/g, '')}T000000Z`);

    return parts.join(';');
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _expandOne(master, utcStart, utcEnd) {
    const dtstart     = _resolveDtstart(master);
    const rruleOpts   = { ...RRule.parseString(master.rrule_string), dtstart };
    const exceptions  = new Set(master.exception_dates ?? []);

    const set = new RRuleSet();
    set.rrule(new RRule(rruleOpts));
    for (const exDateStr of exceptions) {
        set.exdate(_utcMidnightFromIso(exDateStr));
    }

    const occurrences = set.between(utcStart, utcEnd, true);
    return occurrences.map(occ => {
        const occIso = _isoFromUtc(occ);
        return {
            ...master,
            id:         `${master.id}:${occIso}`,
            is_virtual: true,
            is_master:  false,
            day:        occ.getUTCDay(),
        };
    });
}

function _resolveDtstart(master) {
    if (master.dtstart) return _utcMidnight(new Date(master.dtstart));
    // Derive from week_start + day_of_week when dtstart not stored
    const [y, m, d] = master.week_start.split('-').map(Number);
    const weekDate  = new Date(Date.UTC(y, m - 1, d));
    const offset    = (master.day - weekDate.getUTCDay() + 7) % 7;
    return new Date(weekDate.getTime() + offset * 86_400_000);
}

function _utcMidnight(date) {
    return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

function _utcMidnightFromIso(isoStr) {
    const [y, m, d] = isoStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
}

function _isoFromUtc(date) {
    return date.toISOString().slice(0, 10);
}
