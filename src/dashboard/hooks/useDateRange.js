import { useState, useMemo } from 'react';

function computeRange(period, customStart, customEnd) {
    if (period === 'custom') return { start: customStart, end: customEnd };
    const end   = new Date();
    const start = new Date();
    const days  = { week: 7, month: 30, quarter: 90 };
    start.setDate(end.getDate() - (days[period] ?? 30));
    return {
        start: start.toISOString().split('T')[0],
        end:   end.toISOString().split('T')[0],
    };
}

export function useDateRange(initial = 'month') {
    const [period, setPeriod] = useState(initial);

    const [customStart, setCustomStart] = useState(
        () => new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0],
    );
    const [customEnd, setCustomEnd] = useState(
        () => new Date().toISOString().split('T')[0],
    );

    const range = useMemo(
        () => computeRange(period, customStart, customEnd),
        [period, customStart, customEnd],
    );

    return {
        period, setPeriod,
        customStart, setCustomStart,
        customEnd, setCustomEnd,
        range,
    };
}
