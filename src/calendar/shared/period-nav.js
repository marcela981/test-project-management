export function renderPeriodNav({ label, actionPrefix, showToday = true, extraContent = '' }) {
    return `
        <nav class="cal-period-nav" aria-label="Navegación">
            <div class="cal-period-nav-date-group">
                <button class="cal-period-nav-btn" data-action="${actionPrefix}-prev" aria-label="Anterior" title="Anterior">
                    <i class="fas fa-chevron-left" aria-hidden="true"></i>
                </button>
                <span class="cal-period-nav-range" aria-live="polite">${label}</span>
                <button class="cal-period-nav-btn" data-action="${actionPrefix}-next" aria-label="Siguiente" title="Siguiente">
                    <i class="fas fa-chevron-right" aria-hidden="true"></i>
                </button>
                ${showToday ? `<button class="cal-period-nav-btn cal-period-nav-today" data-action="${actionPrefix}-today">Hoy</button>` : ''}
            </div>
            ${extraContent}
        </nav>`;
}
