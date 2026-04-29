import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { periodAdapters } from './periodAdapters';
import type { Period, PeriodRange } from './types';

export interface UsePeriodNavigationResult {
  date: Date;
  label: string;
  range: PeriodRange;
  queryParams: Record<string, string>;
  pickerValue: string;
  goNext: () => void;
  goPrev: () => void;
  goToday: () => void;
  goToDate: (date: Date) => void;
  /** Pass directly to <input onChange> — parses and normalizes the picker value */
  onPickerChange: (value: string) => void;
}

export function usePeriodNavigation(
  period: Period,
  initialDate?: Date,
): UsePeriodNavigationResult {
  const [date, setDate] = useState<Date>(() => initialDate ?? new Date());
  const adapter = periodAdapters[period];

  const label       = useMemo(() => adapter.getLabel(date),       [adapter, date]);
  const range       = useMemo(() => adapter.getRange(date),       [adapter, date]);
  const queryParams = useMemo(() => adapter.getQueryParams(date), [adapter, date]);
  const pickerValue = useMemo(() => adapter.getPickerValue(date), [adapter, date]);

  const goNext  = useCallback(() => setDate(d => adapter.getNext(d)),     [adapter]);
  const goPrev  = useCallback(() => setDate(d => adapter.getPrevious(d)), [adapter]);
  const goToday = useCallback(() => setDate(new Date()),                   []);
  const goToDate = useCallback((d: Date) => setDate(d),                   []);

  const onPickerChange = useCallback(
    (value: string) => { if (value) setDate(adapter.parsePicked(value)); },
    [adapter],
  );

  return { date, label, range, queryParams, pickerValue, goNext, goPrev, goToday, goToDate, onPickerChange };
}

/**
 * Fires onChange whenever the navigation date or period changes,
 * including on initial mount. Uses a ref so that an unstable onChange
 * identity never causes extra effect re-runs.
 */
export function usePeriodNavigationWithCallback(
  period: Period,
  onChange: (range: PeriodRange, queryParams: Record<string, string>) => void,
  initialDate?: Date,
): UsePeriodNavigationResult {
  const nav = usePeriodNavigation(period, initialDate);

  // Keeps onChange current without adding it to the effect's deps.
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => { onChangeRef.current = onChange; });

  useEffect(() => {
    onChangeRef.current(nav.range, nav.queryParams);
  // nav.date is a new reference on every navigation call → correct dep.
  // period is included so that switching periods also fires the callback.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.date, period]);

  return nav;
}
