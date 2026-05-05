import { describe, it, expect } from 'vitest';
import { getTimezoneSnapshot } from '../useUserTimezone.ts';

// Tests for the pure snapshot helper only — the full hook requires jsdom.

describe('getTimezoneSnapshot', () => {
    it('returns the passed timezone string', () => {
        const info = getTimezoneSnapshot('America/Bogota');
        expect(info.timezone).toBe('America/Bogota');
    });

    it('Bogotá offsetMinutes is -300 (UTC-5, no DST)', () => {
        expect(getTimezoneSnapshot('America/Bogota').offsetMinutes).toBe(-300);
    });

    it('UTC offsetMinutes is 0', () => {
        expect(getTimezoneSnapshot('UTC').offsetMinutes).toBe(0);
    });

    it('Tokyo offsetMinutes is +540 (UTC+9, no DST)', () => {
        expect(getTimezoneSnapshot('Asia/Tokyo').offsetMinutes).toBe(540);
    });

    it('abbreviation is a non-empty string', () => {
        const { abbreviation } = getTimezoneSnapshot('America/New_York');
        expect(typeof abbreviation).toBe('string');
        expect(abbreviation.length).toBeGreaterThan(0);
    });

    it('uses browser timezone when tz is omitted', () => {
        const info = getTimezoneSnapshot();
        expect(typeof info.timezone).toBe('string');
        expect(info.timezone.length).toBeGreaterThan(0);
    });

    it('returns same object shape for every call', () => {
        const info = getTimezoneSnapshot('Europe/Madrid');
        expect(info).toHaveProperty('timezone');
        expect(info).toHaveProperty('offsetMinutes');
        expect(info).toHaveProperty('abbreviation');
    });
});
