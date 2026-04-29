import {
  addDays,
  addMonths,
  endOfISOWeek,
  endOfMonth,
  format,
  getISOWeek,
  getISOWeekYear,
  startOfDay,
  startOfISOWeek,
  startOfMonth,
} from 'date-fns';
import { es } from 'date-fns/locale';
import type { Period, PeriodAdapter, PeriodAdapterMap } from './types';

// ─── Shared helpers ───────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Capitalize every word boundary (handles "lunes 25 nov" → "Lunes 25 Nov") */
function titleCase(s: string): string {
  return s.replace(/\b[a-záéíóúüñ]/gi, c => c.toUpperCase());
}

function quarterStart(date: Date): Date {
  const m = Math.floor(date.getMonth() / 3) * 3;
  return new Date(date.getFullYear(), m, 1);
}

function semesterStart(date: Date): Date {
  const m = date.getMonth() < 6 ? 0 : 6;
  return new Date(date.getFullYear(), m, 1);
}

/** Parse "yyyy-MM-dd" input value. Uses noon to avoid DST/TZ day-boundary shifts. */
function parseDateInput(value: string): Date {
  return new Date(value + 'T12:00:00');
}

/** Parse "yyyy-MM" input value → first of that month at noon. */
function parseMonthInput(value: string): Date {
  const [y, m] = value.split('-').map(Number);
  return new Date(y, m - 1, 1, 12);
}

// ─── Day ─────────────────────────────────────────────────────────────────────

const dayAdapter: PeriodAdapter = {
  getLabel(date) {
    // "lunes 25 nov 2026" → "Lunes 25 Nov 2026"
    return titleCase(format(date, 'EEEE d MMM yyyy', { locale: es }));
  },
  getPrevious(date) { return addDays(date, -1); },
  getNext(date)     { return addDays(date, 1); },
  getRange(date) {
    const d = startOfDay(date);
    return { start: d, end: d };
  },
  getQueryParams(date) {
    return { date: format(startOfDay(date), 'yyyy-MM-dd') };
  },
  pickerInputType: 'date',
  getPickerValue(date) { return format(date, 'yyyy-MM-dd'); },
  parsePicked(value)   { return parseDateInput(value); },
};

// ─── Week (ISO 8601: Monday start, week 1 = first week with Thursday) ────────

const weekAdapter: PeriodAdapter = {
  getLabel(date) {
    const week = getISOWeek(date);
    const year = getISOWeekYear(date);
    return `Semana ${week}, ${year}`;
  },
  getPrevious(date) { return addDays(date, -7); },
  getNext(date)     { return addDays(date, 7); },
  getRange(date) {
    return {
      start: startOfISOWeek(date),   // Monday
      end:   endOfISOWeek(date),     // Sunday
    };
  },
  getQueryParams(date) {
    return { week_start: format(startOfISOWeek(date), 'yyyy-MM-dd') };
  },
  pickerInputType: 'date',
  getPickerValue(date) { return format(startOfISOWeek(date), 'yyyy-MM-dd'); },
  parsePicked(value)   { return startOfISOWeek(parseDateInput(value)); },
};

// ─── Month ───────────────────────────────────────────────────────────────────

const monthAdapter: PeriodAdapter = {
  getLabel(date) {
    // "noviembre 2026" → "Noviembre 2026"
    return capitalize(format(date, 'MMMM yyyy', { locale: es }));
  },
  getPrevious(date) { return addMonths(date, -1); },
  getNext(date)     { return addMonths(date, 1); },
  getRange(date) {
    return {
      start: startOfMonth(date),
      end:   endOfMonth(date),
    };
  },
  getQueryParams(date) {
    return {
      year:  String(date.getFullYear()),
      month: String(date.getMonth() + 1),
    };
  },
  pickerInputType: 'month',
  getPickerValue(date) { return format(date, 'yyyy-MM'); },
  parsePicked(value)   { return parseMonthInput(value); },
};

// ─── Quarter ─────────────────────────────────────────────────────────────────

const quarterAdapter: PeriodAdapter = {
  getLabel(date) {
    const qs = quarterStart(date);
    const q  = Math.floor(qs.getMonth() / 3) + 1;
    return `Q${q} ${qs.getFullYear()}`;
  },
  getPrevious(date) { return addMonths(date, -3); },
  getNext(date)     { return addMonths(date, 3); },
  getRange(date) {
    const qs = quarterStart(date);
    return {
      start: qs,
      end:   endOfMonth(addMonths(qs, 2)),
    };
  },
  getQueryParams(date) {
    const qs = quarterStart(date);
    const q  = Math.floor(qs.getMonth() / 3) + 1;
    return {
      year:    String(qs.getFullYear()),
      quarter: String(q),
    };
  },
  // User picks any month in the quarter; adapter normalizes to quarter start.
  pickerInputType: 'month',
  getPickerValue(date) { return format(quarterStart(date), 'yyyy-MM'); },
  parsePicked(value)   { return quarterStart(parseMonthInput(value)); },
};

// ─── Semester ────────────────────────────────────────────────────────────────

const semesterAdapter: PeriodAdapter = {
  getLabel(date) {
    const ss  = semesterStart(date);
    const sem = ss.getMonth() === 0 ? 1 : 2;
    return `H${sem} ${ss.getFullYear()}`;
  },
  getPrevious(date) { return addMonths(date, -6); },
  getNext(date)     { return addMonths(date, 6); },
  getRange(date) {
    const ss = semesterStart(date);
    return {
      start: ss,
      end:   endOfMonth(addMonths(ss, 5)),
    };
  },
  getQueryParams(date) {
    const ss  = semesterStart(date);
    const sem = ss.getMonth() === 0 ? 1 : 2;
    return {
      year:     String(ss.getFullYear()),
      semester: String(sem),
    };
  },
  pickerInputType: 'month',
  getPickerValue(date) { return format(semesterStart(date), 'yyyy-MM'); },
  parsePicked(value)   { return semesterStart(parseMonthInput(value)); },
};

// ─── Registry ────────────────────────────────────────────────────────────────

export const periodAdapters: PeriodAdapterMap = {
  day:      dayAdapter,
  week:     weekAdapter,
  month:    monthAdapter,
  quarter:  quarterAdapter,
  semester: semesterAdapter,
};
