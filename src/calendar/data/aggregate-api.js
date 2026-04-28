import { format } from 'date-fns';
import { CONFIG } from '../../core/config.js';
import { getToken } from '../../auth/auth.js';

const BASE = `${CONFIG.BACKEND_BASE_URL}/api/weekly`;

/**
 * Fetch aggregate block metrics per day.
 * @param {Date} from
 * @param {Date} to
 * @returns {Promise<Array<{date:string, taskCount:number, totalHours:number, completionRate:number}>>}
 */
export async function fetchAggregate(from, to) {
    const token  = getToken();
    const params = new URLSearchParams({
        from: format(from, 'yyyy-MM-dd'),
        to:   format(to,   'yyyy-MM-dd'),
        granularity: 'day',
    });
    try {
        const res = await fetch(`${BASE}/aggregate?${params}`, {
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
        });
        if (!res.ok) return [];
        return await res.json();
    } catch (_) {
        return [];
    }
}

/** Build a Map<'yyyy-MM-dd', entry> from the aggregate response. */
export function buildAggMap(entries) {
    return new Map(entries.map(e => [e.date, e]));
}
