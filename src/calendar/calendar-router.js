/**
 * Calendar router: manages the view selector toolbar and dispatches
 * render calls to the correct view module.
 */

import { getView, setViewSync, getCalendarDate, navigateNext, navigatePrev, navigateToday, initFromPrefs, VIEWS } from './calendar-state.js';
import { fetchPreferences, getPreferences }  from '../weekly/weekly-data.js';

import { renderWeekView, handleWeeklyClick } from './views/week-view.js';
import { renderDayView, navigateDayNext, navigateDayPrev, navigateDayToday }             from './views/day-view.js';
import { renderMonthView, navigateMonthNext, navigateMonthPrev, navigateMonthToday }     from './views/month-view.js';
import { renderQuarterView, navigateQuarterNext, navigateQuarterPrev, navigateQuarterToday } from './views/quarter-view.js';
import { renderSemesterView, navigateSemesterNext, navigateSemesterPrev, navigateSemesterToday } from './views/semester-view.js';
import { renderAnnualView, navigateAnnualNext, navigateAnnualPrev, navigateAnnualToday } from './views/annual-view.js';

const VIEW_LABELS = { day: 'Día', week: 'Semana', month: 'Mes', quarter: 'Trimestre', semester: 'Semestre', annual: 'Anual' };

let _container = null;

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

export async function renderCalendar(container) {
    _container = container;

    await fetchPreferences();
    const prefs = getPreferences();
    initFromPrefs(prefs);

    _renderContainer();
}

/** Central click handler — called from app.js event delegation. */
export function handleCalendarClick(action, el) {
    switch (action) {
        case 'calendar-set-view':
            setViewSync(el.dataset.view);
            _renderContainer();
            return true;

        // Week-view delegates to its own handler
        default:
            if (getView() === 'week' && action.startsWith('weekly-')) {
                return handleWeeklyClick(action, el);
            }
            return _handleNav(action);
    }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function _renderContainer() {
    if (!_container) return;

    const view   = getView();
    const refDate = getCalendarDate();

    _container.innerHTML = `
        <div class="calendar-shell">
            ${_toolbar(view)}
            <div class="calendar-view-host" id="calViewHost"></div>
        </div>`;

    const host = _container.querySelector('#calViewHost');
    _renderView(view, host, refDate);
}

function _toolbar(activeView) {
    const tabs = VIEWS.map(v =>
        `<button class="cal-view-tab${v === activeView ? ' active' : ''}" data-action="calendar-set-view" data-view="${v}">
            ${VIEW_LABELS[v]}
        </button>`
    ).join('');
    return `<div class="cal-view-toolbar">${tabs}</div>`;
}

function _renderView(view, host, refDate) {
    switch (view) {
        case 'day':      renderDayView(host, refDate);      break;
        case 'week':     renderWeekView(host);              break;
        case 'month':    renderMonthView(host, refDate);    break;
        case 'quarter':  renderQuarterView(host, refDate);  break;
        case 'semester': renderSemesterView(host, refDate); break;
        case 'annual':   renderAnnualView(host, refDate);   break;
        default:         renderWeekView(host);
    }
}

function _handleNav(action) {
    const view = getView();

    switch (action) {
        // Day
        case 'day-prev':  navigateDayPrev();  return true;
        case 'day-next':  navigateDayNext();  return true;
        case 'day-today': navigateDayToday(); return true;

        // Month
        case 'month-prev':  navigateMonthPrev();  return true;
        case 'month-next':  navigateMonthNext();  return true;
        case 'month-today': navigateMonthToday(); return true;

        // Quarter
        case 'quarter-prev':  navigateQuarterPrev();  return true;
        case 'quarter-next':  navigateQuarterNext();  return true;
        case 'quarter-today': navigateQuarterToday(); return true;

        // Semester
        case 'semester-prev':  navigateSemesterPrev();  return true;
        case 'semester-next':  navigateSemesterNext();  return true;
        case 'semester-today': navigateSemesterToday(); return true;

        // Annual
        case 'annual-prev':  navigateAnnualPrev();  return true;
        case 'annual-next':  navigateAnnualNext();  return true;
        case 'annual-today': navigateAnnualToday(); return true;

        // Generic weekly prev/next/today delegate to the shared state
        case 'weekly-prev':  navigatePrev(); _renderContainer(); return true;
        case 'weekly-next':  navigateNext(); _renderContainer(); return true;
        case 'weekly-today': navigateToday(); _renderContainer(); return true;
    }
    return false;
}
