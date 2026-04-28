/**
 * Shared calendar state: current view type and reference date.
 * Persisted to localStorage immediately; synced to user_preferences on change.
 */

import {
    addDays, subDays, addMonths, subMonths, addYears, subYears,
} from 'date-fns';
import { getPreferences, savePreferences } from '../weekly/weekly-data.js';

export const VIEWS = ['day', 'week', 'month', 'quarter', 'semester', 'annual'];

const VIEW_STEPS = {
    day:      { add: (d, n) => addDays(d, n),    sub: (d, n) => subDays(d, n) },
    week:     { add: (d, n) => addDays(d, n * 7), sub: (d, n) => subDays(d, n * 7) },
    month:    { add: (d, n) => addMonths(d, n),  sub: (d, n) => subMonths(d, n) },
    quarter:  { add: (d, n) => addMonths(d, n * 3), sub: (d, n) => subMonths(d, n * 3) },
    semester: { add: (d, n) => addMonths(d, n * 6), sub: (d, n) => subMonths(d, n * 6) },
    annual:   { add: (d, n) => addYears(d, n),   sub: (d, n) => subYears(d, n) },
};

let _view = localStorage.getItem('cal_view') ?? 'week';
let _date = new Date();

if (!VIEWS.includes(_view)) _view = 'week';

export function getView()          { return _view; }
export function getCalendarDate()  { return new Date(_date); }

export function setViewSync(view) {
    if (!VIEWS.includes(view)) return;
    _view = view;
    localStorage.setItem('cal_view', view);
    const prefs = getPreferences();
    savePreferences({ ...prefs, calendar_view: view }).catch(() => {});
}

export function navigateNext() {
    _date = (VIEW_STEPS[_view] ?? VIEW_STEPS.week).add(_date, 1);
}

export function navigatePrev() {
    _date = (VIEW_STEPS[_view] ?? VIEW_STEPS.week).sub(_date, 1);
}

export function navigateToday() {
    _date = new Date();
}

export function initFromPrefs(prefs) {
    if (prefs?.calendar_view && VIEWS.includes(prefs.calendar_view)) {
        _view = prefs.calendar_view;
        localStorage.setItem('cal_view', _view);
    }
}
