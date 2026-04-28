/**
 * Pure layout engine for weekly-block stacking.
 * Sweep-line + greedy column packing — Google Calendar style.
 *
 * Each block is assigned the lowest available column; then totalColumns
 * is resolved per-block as the widest concurrent column-set it belongs to.
 */

/**
 * @param {Array<{id: string, start_time: string, end_time: string}>} blocks
 * @returns {Map<string, {column: number, totalColumns: number}>}
 */
export function computeBlockLayout(blocks) {
    if (!blocks.length) return new Map();

    const items = blocks
        .map(b => ({
            id:    b.id,
            start: _minsFromTime(b.start_time),
            end:   _minsFromTime(b.end_time),
            col:   -1,
        }))
        .sort((a, b) => a.start - b.start || b.end - a.end);

    // Greedy column assignment: place each block in the first free column.
    const colEnds = []; // colEnds[c] = end-minute of the last block in column c
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
    // concurrently overlapping blocks + 1.
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
