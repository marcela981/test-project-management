/**
 * Read-only modal for Nextcloud calendar events.
 *
 * Calendar events come from an external system, so the user can't edit them
 * here. The modal shows enough context to decide what to do (title, time,
 * location, organizer, description) plus a deep link that opens the event
 * in Nextcloud's calendar UI for editing.
 *
 * The modal DOM is injected on first call to `openEventModal` and reused on
 * every subsequent call — no static HTML in `index.html` to maintain.
 */

import { format } from 'date-fns';
import { es } from 'date-fns/locale';

const MODAL_ID = 'weeklyEventModal';
let _injected = false;

/**
 * Display the event detail modal for `event` (CalendarEventOut shape).
 */
export function openEventModal(event) {
    _ensureInjected();
    const modal = document.getElementById(MODAL_ID);
    if (!modal || !event) return;

    modal.querySelector('.cal-event-title').textContent = event.title || 'Evento';
    modal.querySelector('.cal-event-when').textContent  = _formatWhen(event);

    _setRow(modal, '.cal-event-location-row', '.cal-event-location', event.location);
    _setRow(modal, '.cal-event-organizer-row', '.cal-event-organizer', event.organizer);
    _setRow(modal, '.cal-event-calendar-row', '.cal-event-calendar', event.calendar_name);
    _setRow(modal, '.cal-event-description-row', '.cal-event-description', event.description);

    const link = modal.querySelector('.cal-event-deep-link');
    if (link) {
        if (event.deep_link) {
            link.setAttribute('href', event.deep_link);
            link.style.display = '';
        } else {
            link.style.display = 'none';
        }
    }

    // Keep the color hint subtle — just the left border.
    const card = modal.querySelector('.cal-event-card');
    if (card) {
        card.style.borderLeftColor = event.color || 'var(--cal-event-color, #6366f1)';
    }

    modal.classList.add('active');
}

export function closeEventModal() {
    document.getElementById(MODAL_ID)?.classList.remove('active');
}

// ── internals ──────────────────────────────────────────────────────────────

function _ensureInjected() {
    if (_injected) return;
    const existing = document.getElementById(MODAL_ID);
    if (existing) {
        _injected = true;
        return;
    }
    const wrapper = document.createElement('div');
    wrapper.id        = MODAL_ID;
    wrapper.className = 'modal-overlay cal-event-modal';
    wrapper.innerHTML = `
        <div class="modal cal-event-card">
            <div class="modal-header">
                <h2 class="modal-title cal-event-title">Evento</h2>
                <button class="modal-close" type="button"
                        data-action="weekly-event-close" aria-label="Cerrar">&times;</button>
            </div>
            <div class="modal-body">
                <div class="cal-event-when"></div>
                <div class="cal-event-row cal-event-location-row" hidden>
                    <i class="fas fa-map-marker-alt"></i>
                    <span class="cal-event-location"></span>
                </div>
                <div class="cal-event-row cal-event-organizer-row" hidden>
                    <i class="fas fa-user"></i>
                    <span class="cal-event-organizer"></span>
                </div>
                <div class="cal-event-row cal-event-calendar-row" hidden>
                    <i class="fas fa-calendar-alt"></i>
                    <span class="cal-event-calendar"></span>
                </div>
                <div class="cal-event-row cal-event-description-row" hidden>
                    <i class="fas fa-align-left"></i>
                    <span class="cal-event-description"></span>
                </div>
            </div>
            <div class="modal-footer cal-event-footer">
                <a class="btn btn-secondary cal-event-deep-link"
                   target="_blank" rel="noopener noreferrer">
                    <i class="fas fa-external-link-alt"></i> Abrir en Nextcloud
                </a>
                <button class="btn btn-outline" type="button"
                        data-action="weekly-event-close">Cerrar</button>
            </div>
        </div>`;
    document.body.appendChild(wrapper);

    wrapper.addEventListener('click', e => {
        if (e.target === wrapper) closeEventModal();
        if (e.target.closest('[data-action="weekly-event-close"]')) closeEventModal();
    });

    _injected = true;
}

function _setRow(modal, rowSel, valueSel, value) {
    const row  = modal.querySelector(rowSel);
    const span = modal.querySelector(valueSel);
    if (!row || !span) return;
    if (value && String(value).trim()) {
        span.textContent = value;
        row.removeAttribute('hidden');
    } else {
        row.setAttribute('hidden', '');
    }
}

function _formatWhen(event) {
    const start = new Date(event.start_utc);
    const end   = new Date(event.end_utc);
    const sameDay =
        start.getFullYear() === end.getFullYear() &&
        start.getMonth()    === end.getMonth() &&
        start.getDate()     === end.getDate();

    const dateOpts   = { locale: es };
    const datePart   = format(start, "EEEE d 'de' MMMM yyyy", dateOpts);
    const startTime  = event.all_day ? 'Todo el día' : format(start, 'HH:mm');
    const endTime    = event.all_day ? '' : format(end, 'HH:mm');

    if (event.all_day) return `${_capitalize(datePart)} · Todo el día`;
    if (sameDay)       return `${_capitalize(datePart)} · ${startTime} – ${endTime}`;
    return `${_capitalize(datePart)} ${startTime} → ${_capitalize(format(end, "EEEE d 'de' MMMM yyyy", dateOpts))} ${endTime}`;
}

function _capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
