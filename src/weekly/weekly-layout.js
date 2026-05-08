/**
 * Pure layout engine for weekly-block stacking.
 * Sweep-line + greedy column packing — Google Calendar style.
 *
 * Each block is assigned the lowest available column; then totalColumns
 * is resolved per-block as the widest concurrent column-set it belongs to.
 *
 * Short blocks have a minimum visual height of MIN_BLOCK_MINUTES (matching the
 * Math.max(24, ...) in the render functions). Overlap detection uses this visual
 * footprint so consecutive short blocks don't paint over each other.
 */

// Must match the `Math.max(24, duration)` floor in _renderLogBlock / _renderBlock.
// With PX_PER_HOUR = 60 (1 min = 1 px) a 24-px floor equals 24 visual minutes.
const MIN_BLOCK_MINUTES = 24;

/**
 * @param {Array<{id: string, start_time: string, end_time: string}>} blocks
 * @returns {Map<string, {column: number, totalColumns: number}>}
 */
export function computeBlockLayout(blocks) {
    if (!blocks.length) return new Map();

    const items = blocks
        .map(b => {
            const start = _minsFromTime(b.start_time);
            const end   = _minsFromTime(b.end_time);
            return {
                id:    b.id,
                start,
                // Visual footprint: short blocks occupy at least MIN_BLOCK_MINUTES
                // so the layout engine treats them as overlapping with what follows.
                end:   Math.max(end, start + MIN_BLOCK_MINUTES),
                col:   -1,
            };
        })
        .sort((a, b) => a.start - b.start || b.end - a.end);

    // Greedy column assignment: place each block in the first free column.
    const colEnds = []; // colEnds[c] = visual-end-minute of the last block in column c
    for (const item of items) {
        let placed = false;
        for (let c = 0; c < colEnds.length; c++) {
            if (colEnds[c] <= item.start) {
                item.col  = c;
                colEnds[c] = item.end;
                placed    = true;
                break;
            }
        }
        if (!placed) {
            item.col = colEnds.length;
            colEnds.push(item.end);
        }
    }

    // totalColumns for each block = highest column index among all
    // concurrently overlapping blocks (using visual footprint) + 1.
    const layout = new Map();
    for (const item of items) {
        let maxCol = item.col;
        for (const other of items) {
            if (other !== item && other.start < item.end && other.end > item.start) {
                if (other.col > maxCol) maxCol = other.col;
            }
        }
        layout.set(item.id, { column: item.col, totalColumns: maxCol + 1 });
    }
    return layout;
}

function _minsFromTime(t) {
    if (!t) return 0;
    const i = t.indexOf(':');
    return parseInt(t.slice(0, i), 10) * 60 + parseInt(t.slice(i + 1, i + 3), 10);
}
