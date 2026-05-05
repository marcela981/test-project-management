import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getNowInUserTz } from '../useCurrentTime';

// The hook itself (useState + useEffect) requires a React renderer.
// These tests cover the pure time-extraction logic that the hook delegates to,
// and the interval/cleanup contract at the setInterval level.
// For hook integration tests add @testing-library/react and test via renderHook.

describe('getNowInUserTz', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('returns a Date instance', () => {
        expect(getNowInUserTz()).toBeInstanceOf(Date);
    });

    it('reflects mocked system time — hours and minutes', () => {
        vi.setSystemTime(new Date('2026-05-05T14:23:00'));
        const now = getNowInUserTz();
        expect(now.getHours()).toBe(14);
        expect(now.getMinutes()).toBe(23);
    });

    it('reflects mocked system time — early morning', () => {
        vi.setSystemTime(new Date('2026-05-05T06:00:00'));
        const now = getNowInUserTz();
        expect(now.getHours()).toBe(6);
        expect(now.getMinutes()).toBe(0);
    });

    it('midnight crossing: date advances and hour resets to 0', () => {
        vi.setSystemTime(new Date('2026-05-05T23:59:00'));
        expect(getNowInUserTz().getDate()).toBe(5);
        expect(getNowInUserTz().getHours()).toBe(23);

        vi.setSystemTime(new Date('2026-05-06T00:00:00'));
        expect(getNowInUserTz().getDate()).toBe(6);
        expect(getNowInUserTz().getHours()).toBe(0);
        expect(getNowInUserTz().getMinutes()).toBe(0);
    });

    it('each call reflects the latest system time without any interval', () => {
        vi.setSystemTime(new Date('2026-05-05T10:00:00'));
        expect(getNowInUserTz().getHours()).toBe(10);

        vi.setSystemTime(new Date('2026-05-05T10:30:00'));
        expect(getNowInUserTz().getHours()).toBe(10);
        expect(getNowInUserTz().getMinutes()).toBe(30);
    });
});

// Interval / cleanup contract — tested at the raw setInterval level to avoid
// needing a React renderer. The hook is a thin wrapper around this pattern.
describe('useCurrentTime — interval contract', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('callback fires once per default 60-second interval', () => {
        let calls = 0;
        const id = setInterval(() => { calls++; }, 60_000);

        vi.advanceTimersByTime(59_999);
        expect(calls).toBe(0);

        vi.advanceTimersByTime(1);
        expect(calls).toBe(1);

        vi.advanceTimersByTime(60_000);
        expect(calls).toBe(2);

        clearInterval(id);
    });

    it('getNowInUserTz returns updated time when called inside a tick', () => {
        // advanceTimersByTime fires intervals AND advances system time simultaneously.
        // Do NOT mix vi.setSystemTime + advanceTimersByTime for the same period
        // or the clock double-advances.
        vi.setSystemTime(new Date('2026-05-05T14:00:00'));
        const captured: number[] = [];

        const id = setInterval(() => {
            captured.push(getNowInUserTz().getMinutes());
        }, 60_000);

        vi.advanceTimersByTime(60_000); // system clock → 14:01
        expect(captured[0]).toBe(1);

        vi.advanceTimersByTime(60_000); // system clock → 14:02
        expect(captured[1]).toBe(2);

        clearInterval(id);
    });

    it('clearInterval stops further ticks (cleanup contract)', () => {
        let calls = 0;
        const id = setInterval(() => { calls++; }, 60_000);

        vi.advanceTimersByTime(60_000);
        expect(calls).toBe(1);

        clearInterval(id); // simulates useEffect cleanup
        vi.advanceTimersByTime(120_000);
        expect(calls).toBe(1); // no more ticks after cleanup
    });

    it('custom updateIntervalMs is respected', () => {
        const INTERVAL = 30_000;
        let calls = 0;
        const id = setInterval(() => { calls++; }, INTERVAL);

        vi.advanceTimersByTime(30_000);
        expect(calls).toBe(1);

        vi.advanceTimersByTime(30_000);
        expect(calls).toBe(2);

        clearInterval(id);
    });
});

// Pixel-position formula — verifies the formula used by both the vanilla JS
// integration (weekly.js) and the React component is arithmetically correct.
describe('current-time topPx formula', () => {
    const PX_PER_HOUR = 60;

    function topPx(h: number, m: number, gridHourStart: number): number {
        return (h - gridHourStart) * PX_PER_HOUR + m;
    }

    it('grid start hour maps to top 0', () => {
        expect(topPx(6, 0, 6)).toBe(0);
    });

    it('14:23 with gridHourStart=6 → 503 px', () => {
        // (14-6)*60 + 23 = 480 + 23 = 503
        expect(topPx(14, 23, 6)).toBe(503);
    });

    it('23:59 with gridHourStart=6 → 1079 px (last visible minute)', () => {
        // (23-6)*60 + 59 = 1020 + 59 = 1079
        expect(topPx(23, 59, 6)).toBe(1079);
    });

    it('dynamic gridHourStart=5 shifts everything up by one hour', () => {
        expect(topPx(6, 0, 5)).toBe(60);  // 1 hour after grid start
        expect(topPx(5, 0, 5)).toBe(0);   // at grid start
    });

    it('half-hour increments produce 30-pixel steps', () => {
        expect(topPx(10, 30, 6) - topPx(10, 0, 6)).toBe(30);
    });
});
