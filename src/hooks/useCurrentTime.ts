import { useState, useEffect } from 'react';

/**
 * Returns the current Date in the user's local timezone.
 * Browser Date already reflects the system (user) timezone — no extra
 * date-fns-tz conversion needed for wall-clock reads.
 * Exported separately so tests can mock it via vi.setSystemTime().
 */
export function getNowInUserTz(): Date {
    return new Date();
}

/**
 * Returns a Date representing the current time in the user's timezone,
 * refreshed every updateIntervalMs milliseconds (default: 60 s).
 * Sub-minute precision is intentionally omitted — the weekly grid snaps
 * to 15-minute slots, so a 60-second refresh is the right granularity.
 */
export function useCurrentTime(updateIntervalMs = 60_000): Date {
    const [now, setNow] = useState<Date>(getNowInUserTz);

    useEffect(() => {
        const id = setInterval(() => setNow(getNowInUserTz()), updateIntervalMs);
        return () => clearInterval(id);
    }, [updateIntervalMs]);

    return now;
}
