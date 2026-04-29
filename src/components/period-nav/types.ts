export type Period = 'day' | 'week' | 'month' | 'quarter' | 'semester';

export interface PeriodRange {
  start: Date;
  end: Date;
}

export interface PeriodAdapter {
  /** Human-readable label, e.g. "Semana 47, 2026" / "Noviembre 2026" */
  getLabel(date: Date): string;
  getPrevious(date: Date): Date;
  getNext(date: Date): Date;
  /** Inclusive start/end for backend queries */
  getRange(date: Date): PeriodRange;
  /** Exact query-string params for the endpoint */
  getQueryParams(date: Date): Record<string, string>;
  /** HTML input type for the contextual date picker */
  pickerInputType: 'date' | 'month';
  /** Serialize the current date for the picker <input> value attribute */
  getPickerValue(date: Date): string;
  /** Parse the picker value string and normalize to the period's anchor date */
  parsePicked(value: string): Date;
}

export type PeriodAdapterMap = Record<Period, PeriodAdapter>;
