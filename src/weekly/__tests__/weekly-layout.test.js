import { describe, it, expect } from 'vitest';
import { computeBlockLayout } from '../weekly-layout.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function block(id, start_time, end_time) {
    return { id, start_time, end_time };
}

function layout(map, id) {
    return map.get(id);
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('computeBlockLayout', () => {
    it('returns empty map for empty input', () => {
        expect(computeBlockLayout([])).toEqual(new Map());
    });

    it('single block — full width (totalColumns=1, column=0)', () => {
        const map = computeBlockLayout([block('a', '09:00', '10:00')]);
        expect(layout(map, 'a')).toEqual({ column: 0, totalColumns: 1 });
    });

    it('two non-overlapping blocks share column 0', () => {
        const map = computeBlockLayout([
            block('a', '09:00', '10:00'),
            block('b', '11:00', '12:00'),
        ]);
        expect(layout(map, 'a')).toEqual({ column: 0, totalColumns: 1 });
        expect(layout(map, 'b')).toEqual({ column: 0, totalColumns: 1 });
    });

    it('two fully overlapping blocks occupy distinct columns', () => {
        const map = computeBlockLayout([
            block('a', '09:00', '11:00'),
            block('b', '09:00', '11:00'),
        ]);
        const la = layout(map, 'a');
        const lb = layout(map, 'b');
        expect(la.totalColumns).toBe(2);
        expect(lb.totalColumns).toBe(2);
        expect(la.column).not.toBe(lb.column);
    });

    it('adjacent blocks (end === start) do NOT overlap', () => {
        // 09:00-10:00 ends exactly when 10:00-11:00 starts → no overlap
        const map = computeBlockLayout([
            block('a', '09:00', '10:00'),
            block('b', '10:00', '11:00'),
        ]);
        expect(layout(map, 'a')).toEqual({ column: 0, totalColumns: 1 });
        expect(layout(map, 'b')).toEqual({ column: 0, totalColumns: 1 });
    });

    it('three-way simultaneous overlap uses three columns', () => {
        const map = computeBlockLayout([
            block('a', '09:00', '12:00'),
            block('b', '09:00', '12:00'),
            block('c', '09:00', '12:00'),
        ]);
        const cols = ['a', 'b', 'c'].map(id => layout(map, id).column);
        expect(new Set(cols).size).toBe(3);          // all distinct
        ['a', 'b', 'c'].forEach(id =>
            expect(layout(map, id).totalColumns).toBe(3),
        );
    });

    it('partial overlap: A-B overlap, B-C overlap, A-C non-overlapping', () => {
        // A: 09-11, B: 10-12, C: 11-13
        // A∩B overlap, B∩C overlap, A∩C no overlap (A ends at 11, C starts at 11)
        const map = computeBlockLayout([
            block('a', '09:00', '11:00'),
            block('b', '10:00', '12:00'),
            block('c', '11:00', '13:00'),
        ]);
        // A and B overlap → each totalColumns ≥ 2
        expect(layout(map, 'a').totalColumns).toBeGreaterThanOrEqual(2);
        expect(layout(map, 'b').totalColumns).toBeGreaterThanOrEqual(2);
        // A and C do not overlap → C can reuse A's column
        expect(layout(map, 'a').column).toBe(layout(map, 'c').column);
    });

    it('column index never exceeds totalColumns - 1', () => {
        const blocks = [
            block('a', '08:00', '12:00'),
            block('b', '09:00', '11:00'),
            block('c', '10:00', '14:00'),
            block('d', '13:00', '15:00'),
        ];
        const map = computeBlockLayout(blocks);
        for (const b of blocks) {
            const { column, totalColumns } = layout(map, b.id);
            expect(column).toBeGreaterThanOrEqual(0);
            expect(column).toBeLessThan(totalColumns);
        }
    });

    it('handles HH:MM:SS time strings (trimmed to HH:MM)', () => {
        // _minsFromTime reads only up to the third char after ':', so "10:30:00" → 630
        const map = computeBlockLayout([
            block('a', '10:00:00', '11:00:00'),
            block('b', '10:30:00', '11:30:00'),
        ]);
        expect(layout(map, 'a').totalColumns).toBe(2);
        expect(layout(map, 'b').totalColumns).toBe(2);
    });

    it('longer block with two short non-overlapping companions', () => {
        // A: 09-13 (long), B: 09-11, C: 11-13
        // B and C don't overlap each other, so they can share a column
        // A overlaps both B and C
        const map = computeBlockLayout([
            block('a', '09:00', '13:00'),
            block('b', '09:00', '11:00'),
            block('c', '11:00', '13:00'),
        ]);
        // A uses col 0 (placed first as longer), B→col 1, C→col 1 (reuses after B ends)
        expect(layout(map, 'a').column).toBe(0);
        expect(layout(map, 'b').column).toBe(1);
        expect(layout(map, 'c').column).toBe(1);
        // All three are in a 2-column layout
        expect(layout(map, 'a').totalColumns).toBe(2);
        expect(layout(map, 'b').totalColumns).toBe(2);
        expect(layout(map, 'c').totalColumns).toBe(2);
    });
});
