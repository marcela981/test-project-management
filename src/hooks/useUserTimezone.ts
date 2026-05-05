import { useState, useEffect } from 'react';
import { getUserTimezone, getUtcOffsetMinutes } from '../lib/time';

export interface TimezoneInfo {
    timezone: string;
    offsetMinutes: number;
    abbreviation: string;
}

/**
 * Compute timezone info for any IANA timezone string. Exported for testing.
 * offsetMinutes accounts for DST at the current instant.
 */
export function getTimezoneSnapshot(tz?: string): TimezoneInfo {
    const timezone = tz ?? getUserTimezone();
    const offsetMinutes = getUtcOffsetMinutes(timezone);
    const parts = new Intl.DateTimeFormat('en', {
        timeZoneName: 'short',
        timeZone: timezone,
    }).formatToParts(new Date());
    const abbreviation = parts.find(p => p.type === 'timeZoneName')?.value ?? '';
    return { timezone, offsetMinutes, abbreviation };
}

/**
 * Returns the user's detected browser timezone with offset and abbreviation.
 * Re-evaluates on visibility change (handles the rare case a user travels
 * and their device updates its timezone while the app is open).
 */
export function useUserTimezone(): TimezoneInfo {
    const [info, setInfo] = useState<TimezoneInfo>(() => getTimezoneSnapshot());

    useEffect(() => {
        function check() {
            setInfo(prev => {
                const next = getTimezoneSnapshot();
                return prev.timezone === next.timezone ? prev : next;
            });
        }

        const timer = setInterval(check, 60_000);
        document.addEventListener('visibilitychange', check);

        return () => {
            clearInterval(timer);
            document.removeEventListener('visibilitychange', check);
        };
    }, []);

    return info;
}
