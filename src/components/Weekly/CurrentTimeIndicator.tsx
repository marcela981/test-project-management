import { memo } from 'react';
import { useCurrentTime } from '../../hooks/useCurrentTime';

interface Props {
    pixelsPerHour: number;
    dayColumnWidth: number;
    /** Index (0-based) of today's column in the visible week.
     *  null when the displayed week does not include today → renders nothing. */
    todayColumnIndex: number | null;
    /** First visible hour in the grid (default 6). Must match the grid's
     *  dynamic _gridHourStart so topPx aligns with block positions. */
    gridHourStart?: number;
    /** Last visible hour in the grid (default 23). */
    gridHourEnd?: number;
}

/**
 * Horizontal current-time indicator rendered ONLY over today's column.
 * Placed inside the weekly-grid's scrollable area and positioned absolutely
 * so it passes over blocks (z-index 10) but stays below modals.
 *
 * For vanilla-JS grids, the equivalent imperative logic lives in
 * weekly.js (_mountCurrentTimeLine). Keep the formulas in sync.
 */
const CurrentTimeIndicator = memo(function CurrentTimeIndicator({
    pixelsPerHour,
    dayColumnWidth,
    todayColumnIndex,
    gridHourStart = 6,
    gridHourEnd = 23,
}: Props) {
    const now = useCurrentTime();

    if (todayColumnIndex === null) return null;

    const h = now.getHours();
    const m = now.getMinutes();

    // Outside visible range → hide (e.g. user opens app at 5 am or midnight)
    if (h < gridHourStart || h > gridHourEnd) return null;

    // topPx: distance from the top of the scrollable grid body.
    // Mirrors the block-positioning formula in weekly.js:
    //   top = timeToMinutes(start_time) - _gridHourStart * 60
    // With PX_PER_HOUR=60, 1 min = 1 px, so:
    //   topPx = (h - gridHourStart) * pixelsPerHour + m * (pixelsPerHour / 60)
    const topPx = (h - gridHourStart) * pixelsPerHour + m * (pixelsPerHour / 60);
    const leftPx = todayColumnIndex * dayColumnWidth;
    const timeLabel = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

    return (
        <div
            className="weekly-current-time"
            style={{ top: topPx, left: leftPx, width: dayColumnWidth }}
        >
            <div className="weekly-current-time-dot" />
            <div className="weekly-current-time-line" />
            <span className="weekly-current-time-label">{timeLabel}</span>
        </div>
    );
});

export default CurrentTimeIndicator;
