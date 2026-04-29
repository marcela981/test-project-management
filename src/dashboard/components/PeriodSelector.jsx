const PERIODS = [
    ['week', 'Semana'],
    ['month', 'Mes'],
    ['quarter', 'Trimestre'],
    ['custom', 'Fechas'],
];

export default function PeriodSelector({
    period, onPeriodChange,
    customStart, onCustomStartChange,
    customEnd, onCustomEndChange,
    onApplyCustom,
    showCustom = true,
}) {
    const periods = showCustom ? PERIODS : PERIODS.filter(([k]) => k !== 'custom');

    return (
        <div className="period-selector">
            {periods.map(([key, label]) => (
                <button
                    key={key}
                    className={`period-btn${period === key ? ' active' : ''}`}
                    onClick={() => onPeriodChange(key)}
                >
                    {label}
                </button>
            ))}

            {showCustom && period === 'custom' && (
                <div className="period-custom" style={{ display: 'flex' }}>
                    <input
                        type="date"
                        className="form-input form-input-sm"
                        value={customStart}
                        onChange={e => onCustomStartChange(e.target.value)}
                    />
                    <span>—</span>
                    <input
                        type="date"
                        className="form-input form-input-sm"
                        value={customEnd}
                        onChange={e => onCustomEndChange(e.target.value)}
                    />
                    <button className="btn btn-sm btn-primary" onClick={onApplyCustom}>
                        OK
                    </button>
                </div>
            )}
        </div>
    );
}
