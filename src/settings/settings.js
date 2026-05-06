/** Panel lateral de configuración global. */

import { getPrefsOnce, getPreferences, savePreferences } from '../weekly/weekly-data.js';
import { setViewSync } from '../calendar/calendar-state.js';
import { getCachedUser } from '../auth/auth.js';
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import DownloadMetricsModal from '../admin/components/DownloadMetricsModal.jsx';
import { injectCalDAVSection } from './caldav-setup.js';

const _PRIVILEGED = new Set(['admin', 'leader', 'supervisor']);
let _metricsModalContainer  = null;
let _metricsModalRoot       = null;
let _reportsSectionInjected = false;

function _renderMetricsModal(isOpen) {
    _metricsModalRoot.render(
        h(DownloadMetricsModal, { isOpen, onClose: () => _renderMetricsModal(false) })
    );
}

function _openMetricsModal() {
    if (!_metricsModalContainer) {
        _metricsModalContainer = document.createElement('div');
        document.body.appendChild(_metricsModalContainer);
        _metricsModalRoot = createRoot(_metricsModalContainer);
    }
    _renderMetricsModal(true);
}

function _injectReportsSection() {
    if (_reportsSectionInjected) return;
    const user = getCachedUser();
    if (!user || !_PRIVILEGED.has(user.role)) return;

    const body = document.querySelector('#settingsPanel .settings-body');
    if (!body) return;

    const section = document.createElement('div');
    section.innerHTML = `
        <div class="settings-section-title" style="margin-top:1rem">Reportes</div>
        <button class="btn btn-primary" id="btnSettingsDownloadMetrics" style="width:100%">
            <i class="fas fa-file-excel"></i> Descargar Métricas
        </button>
    `;
    body.appendChild(section);
    document.getElementById('btnSettingsDownloadMetrics').addEventListener('click', _openMetricsModal);
    _reportsSectionInjected = true;
}

export async function openSettings() {
    document.getElementById('settingsPanel').classList.add('open');
    document.getElementById('settingsOverlay').classList.add('open');
    _injectReportsSection();
    await injectCalDAVSection();
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
    await getPrefsOnce();
    const prefs = getPreferences();
    document.getElementById('settingWeekStart').value = prefs.week_start_day;
    document.getElementById('settingWeekEnd').value   = prefs.week_end_day;
    const viewEl = document.getElementById('settingCalendarView');
    if (viewEl && prefs.calendar_view) viewEl.value = prefs.calendar_view;
}
