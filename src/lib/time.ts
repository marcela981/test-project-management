import { toZonedTime, fromZonedTime, formatInTimeZone, getTimezoneOffset } from 'date-fns-tz';

export function getUserTimezone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Convert a UTC ISO 8601 string (with Z suffix) to a Date whose UTC wall-clock
 * values represent local time in the user's timezone. Use this Date with
 * date-fns format() or spread into local-aware calculations.
 *
 * @param tz - IANA timezone override; defaults to browser timezone. Pass for testing.
 */
export function utcToUserLocal(utcIso: string, tz?: string): Date {
    return toZonedTime(new Date(utcIso), tz ?? getUserTimezone());
}

/**
 * Format a UTC ISO 8601 string using a date-fns format pattern, displayed in
 * the user's local timezone.
 *
 * @param tz - IANA timezone override; defaults to browser timezone. Pass for testing.
 */
export function formatInUserTz(utcIso: string, formatStr: string, tz?: string): string {
    return formatInTimeZone(new Date(utcIso), tz ?? getUserTimezone(), formatStr);
}

/**
 * Convert a local Date (as returned by utcToUserLocal) back to a UTC ISO 8601
 * string for submission to the backend.
 *
 * @param tz - IANA timezone override; defaults to browser timezone. Pass for testing.
 */
export function userLocalToUtcIso(localDate: Date, tz?: string): string {
    return fromZonedTime(localDate, tz ?? getUserTimezone()).toISOString();
}

/**
 * Return the UTC offset in minutes for a given IANA timezone at the current
 * instant, accounting for DST. Negative = west of UTC (e.g. Bogotá = -300).
 */
export function getUtcOffsetMinutes(tz?: string): number {
    const timezone = tz ?? getUserTimezone();
    return getTimezoneOffset(timezone, new Date()) / 60_000;
}
