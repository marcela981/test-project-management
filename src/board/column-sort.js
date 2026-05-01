/** Sort configurable por columna del Board; persistencia en localStorage. */

// ── Comparators puros (exportados para tests) ─────────────────────────────────

export function compareByTitle(a, b) {
    return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
}

export function compareByCreatedAt(a, b) {
    return new Date(a.createdAt || a.startDate || 0).getTime()
         - new Date(b.createdAt || b.startDate || 0).getTime();
}

export function compareByDeadline(a, b) {
    const da = a.deadline ? new Date(a.deadline + 'T00:00:00').getTime() : null;
    const db = b.deadline ? new Date(b.deadline + 'T00:00:00').getTime() : null;
    if (da === null && db === null) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
}

export function compareByCompletedAt(a, b) {
    const resolve = item =>
        item.completedAt ? new Date(item.completedAt).getTime()
        : item.updatedAt  ? new Date(item.updatedAt).getTime()
        : item.createdAt  ? new Date(item.createdAt).getTime()
        : null;
    const ta = resolve(a);
    const tb = resolve(b);
    if (ta === null && tb === null) return 0;
    if (ta === null) return 1;
    if (tb === null) return -1;
    return ta - tb;
}

// ── Configuración ─────────────────────────────────────────────────────────────

export const SORT_DEFAULTS = {
    'actively-working':           { criterion: 'created_at', direction: 'asc' },
    'activities':                 { criterion: 'created_at', direction: 'asc' },
    'actively-working-completed': { criterion: 'completed_at', direction: 'desc' },
    'activities-completed':       { criterion: 'completed_at', direction: 'desc' },
};

export const CRITERIA_ACTIVE    = ['title', 'created_at', 'deadline'];
export const CRITERIA_COMPLETED = ['title', 'created_at', 'deadline', 'completed_at'];

const _COMPARATORS = {
    title:        compareByTitle,
    created_at:   compareByCreatedAt,
    deadline:     compareByDeadline,
    completed_at: compareByCompletedAt,
};

// ── localStorage ──────────────────────────────────────────────────────────────

function _userId() {
    try {
        const raw = localStorage.getItem('nc_user_info');
        return raw ? (JSON.parse(raw).id ?? 'anon') : 'anon';
    } catch { return 'anon'; }
}

export function getSort(columnKey) {
    try {
        const raw = localStorage.getItem(`board:sort:${columnKey}:${_userId()}`);
        if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return { ...(SORT_DEFAULTS[columnKey] ?? { criterion: 'created_at', direction: 'asc' }) };
}

export function setSort(columnKey, sort) {
    try {
        localStorage.setItem(`board:sort:${columnKey}:${_userId()}`, JSON.stringify(sort));
    } catch { /* ignore */ }
}

export function resetSort(columnKey) {
    try {
        localStorage.removeItem(`board:sort:${columnKey}:${_userId()}`);
    } catch { /* ignore */ }
}

export function isDefaultSort(columnKey, sort) {
    const def = SORT_DEFAULTS[columnKey] ?? { criterion: 'created_at', direction: 'asc' };
    return sort.criterion === def.criterion && sort.direction === def.direction;
}

// ── Aplicar sort ──────────────────────────────────────────────────────────────

export function sortItems(items, columnKey) {
    const sort = getSort(columnKey);
    const cmp  = _COMPARATORS[sort.criterion];
    if (!cmp) return items;

    const dir = sort.direction === 'desc' ? -1 : 1;

    return Array.from(items).sort((a, b) => {
        // deadline null siempre al final, independientemente de la dirección
        if (sort.criterion === 'deadline') {
            const da = a.deadline ? new Date(a.deadline + 'T00:00:00').getTime() : null;
            const db = b.deadline ? new Date(b.deadline + 'T00:00:00').getTime() : null;
            if (da === null && db === null) return 0;
            if (da === null) return 1;
            if (db === null) return -1;
            return dir * (da - db);
        }
        // completed_at null siempre al final, independientemente de la dirección
        if (sort.criterion === 'completed_at') {
            const resolve = item =>
                item.completedAt ? new Date(item.completedAt).getTime()
                : item.updatedAt  ? new Date(item.updatedAt).getTime()
                : item.createdAt  ? new Date(item.createdAt).getTime()
                : null;
            const ta = resolve(a);
            const tb = resolve(b);
            if (ta === null && tb === null) return 0;
            if (ta === null) return 1;
            if (tb === null) return -1;
            return dir * (ta - tb);
        }
        return dir * cmp(a, b);
    });
}
