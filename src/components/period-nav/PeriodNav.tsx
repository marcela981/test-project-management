import React from 'react';
import './PeriodNav.css';
import { periodAdapters } from './periodAdapters';
import type { Period, PeriodRange } from './types';
import { usePeriodNavigation } from './usePeriodNavigation';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PeriodNavProps {
  period: Period;
  initialDate?: Date;
  className?: string;
  /**
   * Called on mount and on every navigation with the period's date range
   * and query params, so the parent can trigger data fetching.
   */
  onChange?: (range: PeriodRange, queryParams: Record<string, string>) => void;
}

// ─── Aria labels per period ───────────────────────────────────────────────────

const ARIA: Record<Period, { prev: string; next: string; today: string }> = {
  day:      { prev: 'Día anterior',       next: 'Día siguiente',       today: 'Hoy' },
  week:     { prev: 'Semana anterior',    next: 'Semana siguiente',    today: 'Hoy' },
  month:    { prev: 'Mes anterior',       next: 'Mes siguiente',       today: 'Mes actual' },
  quarter:  { prev: 'Trimestre anterior', next: 'Trimestre siguiente', today: 'Trimestre actual' },
  semester: { prev: 'Semestre anterior',  next: 'Semestre siguiente',  today: 'Semestre actual' },
};

// ─── Component ───────────────────────────────────────────────────────────────

export function PeriodNav({ period, initialDate, className = '', onChange }: PeriodNavProps) {
  const nav = usePeriodNavigation(period, initialDate);
  const { date, label, range, queryParams, pickerValue, goNext, goPrev, goToday, onPickerChange } = nav;

  // Keep a stable ref so the effect never re-runs just because the parent
  // passed a new onChange function reference.
  const onChangeRef = React.useRef(onChange);
  React.useLayoutEffect(() => { onChangeRef.current = onChange; });

  // Fire on mount and whenever the navigation date or period changes.
  React.useEffect(() => {
    onChangeRef.current?.(range, queryParams);
    // date is a new object reference on every navigation call.
    // period is included so that switching periods also fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, period]);

  const adapter = periodAdapters[period];
  const aria    = ARIA[period];

  return (
    <nav className={`period-nav${className ? ` ${className}` : ''}`} aria-label="Navegación de período">
      <button
        type="button"
        className="period-nav__btn"
        onClick={goPrev}
        aria-label={aria.prev}
        title={aria.prev}
      >
        <i className="fas fa-chevron-left" aria-hidden="true" />
      </button>

      {/*
        The <label> wraps a visually transparent <input> that is positioned
        over the visible text. Clicking anywhere on the label opens the
        browser's native date/month picker without any JS showPicker() call.
      */}
      <label className="period-nav__label-wrapper" title="Seleccionar fecha">
        <span className="period-nav__label-text" aria-live="polite">
          {label}
        </span>
        <input
          type={adapter.pickerInputType}
          value={pickerValue}
          onChange={e => onPickerChange(e.target.value)}
          className="period-nav__picker-input"
          aria-label="Seleccionar fecha"
        />
      </label>

      <button
        type="button"
        className="period-nav__btn period-nav__today"
        onClick={goToday}
        title={aria.today}
      >
        {aria.today}
      </button>

      <button
        type="button"
        className="period-nav__btn"
        onClick={goNext}
        aria-label={aria.next}
        title={aria.next}
      >
        <i className="fas fa-chevron-right" aria-hidden="true" />
      </button>
    </nav>
  );
}
