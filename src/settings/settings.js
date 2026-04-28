/** Panel lateral de configuración global. */

import { fetchPreferences, savePreferences } from '../weekly/weekly-data.js';
import { setViewSync } from '../calendar/calendar-state.js';

export async function openSettings() {
    document.getElementById('settingsPanel').classList.add('open');
    document.getElementById('settingsOverlay').classList.add('open');
    await _loadIntoForm();
}

export function closeSettings() {
    document.getElementById('settingsPanel').classList.remove('open');
    document.getElementById('settingsOverlay').classList.remove('open');
}

export async function saveSettings() {
    const startDay     = parseInt(document.getElementById('settingWeekStart').value, 10);
    const endDay       = parseInt(document.getElementById('settingWeekEnd').value, 10);
    const calendarView = document.getElementById('settingCalendarView')?.value ?? undefined;
    if (calendarView) setViewSync(calendarView);
    await savePreferences({ week_start_day: startDay, week_end_day: endDay, calendar_view: calendarView });
    closeSettings();
}

async function _loadIntoForm() {
    const prefs = await fetchPreferences();
    document.getElementById('settingWeekStart').value = prefs.week_start_day;
    document.getElementById('settingWeekEnd').value   = prefs.week_end_day;
    const viewEl = document.getElementById('settingCalendarView');
    if (viewEl && prefs.calendar_view) viewEl.value = prefs.calendar_view;
}
