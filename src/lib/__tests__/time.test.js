import { describe, it, expect } from 'vitest';
import { formatInTimeZone } from 'date-fns-tz';
import { getUserTimezone, utcToUserLocal, formatInUserTz, userLocalToUtcIso, getUtcOffsetMinutes } from '../time.ts';

// ── getUserTimezone ───────────────────────────────────────────────────────────

describe('getUserTimezone', () => {
    it('returns a non-empty string', () => {
        const tz = getUserTimezone();
        expect(typeof tz).toBe('string');
        expect(tz.length).toBeGreaterThan(0);
    });
});

// ── formatInUserTz ────────────────────────────────────────────────────────────

describe('formatInUserTz', () => {
    it('UTC noon is 12:00 in UTC timezone', () => {
        expect(formatInUserTz('2026-05-05T12:00:00Z', 'HH:mm', 'UTC')).toBe('12:00');
    });

    it('UTC noon is 08:00 in New York EDT (UTC-4) — May 2026', () => {
        expect(formatInUserTz('2026-05-05T12:00:00Z', 'HH:mm', 'America/New_York')).toBe('08:00');
    });

    it('UTC 14:00 is 09:00 in Bogotá (UTC-5)', () => {
        expect(formatInUserTz('2026-05-05T14:00:00Z', 'HH:mm', 'America/Bogota')).toBe('09:00');
    });

    it('formats date part in UTC', () => {
        expect(formatInUserTz('2026-05-05T12:00:00Z', 'yyyy-MM-dd', 'UTC')).toBe('2026-05-05');
    });

    it('cross-midnight: UTC date differs from Bogotá local date', () => {
        // 2026-05-06T02:00:00Z = 21:00 on May 5 in Bogotá (UTC-5)
        expect(formatInUserTz('2026-05-06T02:00:00Z', 'yyyy-MM-dd', 'America/Bogota')).toBe('2026-05-05');
        expect(formatInUserTz('2026-05-06T02:00:00Z', 'HH:mm',      'America/Bogota')).toBe('21:00');
    });

    it('midnight-crossing boundary: clamp logic check', () => {
        // A log starting at 23:30 Bogota time + 90 min ends at 01:00 next day
        const startIso = '2026-05-06T04:30:00Z';  // 23:30 Bogota (UTC-5)
        const endMs    = new Date(startIso).getTime() + 90 * 60_000;
        const endIso   = new Date(endMs).toISOString();

        const startDay = formatInUserTz(startIso, 'yyyy-MM-dd', 'America/Bogota');
        const endDay   = formatInUserTz(endIso,   'yyyy-MM-dd', 'America/Bogota');

        expect(startDay).toBe('2026-05-05');
        expect(endDay).toBe('2026-05-06');
        expect(endDay > startDay).toBe(true);  // triggers midnight-clamp
    });
});

// ── utcToUserLocal ────────────────────────────────────────────────────────────

describe('utcToUserLocal', () => {
    it('returns a valid Date', () => {
        const d = utcToUserLocal('2026-05-05T12:00:00Z', 'UTC');
        expect(d).toBeInstanceOf(Date);
        expect(isNaN(d.getTime())).toBe(false);
    });

    it('Date can be formatted in target timezone via formatInTimeZone', () => {
        // toZonedTime returns a Date; pass it to formatInTimeZone to get local wall clock
        const d = utcToUserLocal('2026-05-05T14:00:00Z', 'America/Bogota'); // UTC-5 → 09:00
        expect(formatInTimeZone(d, 'America/Bogota', 'HH:mm')).toBe('09:00');
    });
});

// ── userLocalToUtcIso ─────────────────────────────────────────────────────────

describe('userLocalToUtcIso', () => {
    it('round-trips through utcToUserLocal', () => {
        const utcIso = '2026-05-05T14:00:00.000Z';
        const local  = utcToUserLocal(utcIso, 'America/Bogota');
        const back   = userLocalToUtcIso(local, 'America/Bogota');
        expect(back).toBe(utcIso);
    });
});

// ── getUtcOffsetMinutes ───────────────────────────────────────────────────────

describe('getUtcOffsetMinutes', () => {
    it('Bogotá is UTC-5 (-300 min)', () => {
        expect(getUtcOffsetMinutes('America/Bogota')).toBe(-300);
    });

    it('UTC is 0', () => {
        expect(getUtcOffsetMinutes('UTC')).toBe(0);
    });

    it('Tokyo is UTC+9 (540 min)', () => {
        expect(getUtcOffsetMinutes('Asia/Tokyo')).toBe(540);
    });
});
