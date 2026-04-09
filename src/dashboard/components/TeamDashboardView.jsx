import { useState, useMemo, useEffect } from 'react';
import { useDateRange } from '../hooks/useDateRange.js';
import { fetchTeams, fetchAdminUsers, fetchTeamMetrics } from '../dashApi.js';
import PeriodSelector from './PeriodSelector.jsx';
import KpiCard from './KpiCard.jsx';
import { AreaChart, DoughnutChart } from './Charts.jsx';
import CapacityHeatmap from './CapacityHeatmap.jsx';

function initials(name) {
    return (name || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function OnTimeBadge({ rate }) {
    if (rate == null) return <span>—</span>;
    const rounded = Math.round(rate);
    let cls = 'badge-success';
    let icon = 'fa-check-circle';
    if (rounded < 80)       { cls = 'badge-danger';  icon = 'fa-exclamation-circle'; }
    else if (rounded < 90)  { cls = 'badge-warning'; icon = 'fa-clock'; }

    return (
        <span className={`badge ${cls}`}>
            <i className={`fas ${icon}`} style={{ marginRight: '4px' }} />
            {rounded}%
        </span>
    );
}

/** Resolves initial filter state and lock rules from the user's role. */
function resolveRoleConstraints(user) {
    const role = user?.role ?? 'member';

    if (role === 'admin') {
        return { defaultTeam: 'all', defaultMember: 'all', lockTeam: false, lockMember: false };
    }
    if (role === 'leader') {
        return { defaultTeam: user.teamId ?? 'all', defaultMember: 'all', lockTeam: true, lockMember: false };
    }
    // member
    return { defaultTeam: user?.teamId ?? 'all', defaultMember: user?.id ?? 'all', lockTeam: true, lockMember: true };
}

export default function TeamDashboardView({ user }) {
    const dr = useDateRange('month');
    const constraints = useMemo(() => resolveRoleConstraints(user), [user]);

    const [selectedTeam, setSelectedTeam]     = useState(constraints.defaultTeam);
    const [selectedMember, setSelectedMember] = useState(constraints.defaultMember);
    const [teams, setTeams]                   = useState([]);
    const [allMembers, setAllMembers]         = useState([]);
    const [memberMetrics, setMemberMetrics]   = useState([]);
    const [metricsLoading, setMetricsLoading] = useState(false);

    useEffect(() => {
        fetchTeams().then(data => setTeams(data ?? [])).catch(() => {});
        fetchAdminUsers().then(data => setAllMembers(
            (data ?? []).map(u => ({
                ...u,
                userId:      u.id ?? u.ncUserId,
                displayname: u.displayName || u.displayname || u.id,
            }))
        )).catch(() => {});
    }, []);

    // Fetch real metrics when team or date range changes
    useEffect(() => {
        if (!selectedTeam || selectedTeam === 'all') {
            setMemberMetrics([]);
            return;
        }
        setMetricsLoading(true);
        fetchTeamMetrics(selectedTeam, dr.range.start, dr.range.end)
            .then(data => setMemberMetrics(data?.memberMetrics ?? []))
            .catch(() => setMemberMetrics([]))
            .finally(() => setMetricsLoading(false));
    }, [selectedTeam, dr.range.start, dr.range.end]);

    const visibleMembers = useMemo(() => {
        let list = allMembers;
        if (selectedTeam !== 'all') list = list.filter(m => m.teamId === selectedTeam);
        return list;
    }, [allMembers, selectedTeam]);

    // Metrics filtered by selected member
    const filteredMetrics = useMemo(() => {
        if (selectedMember === 'all') return memberMetrics;
        return memberMetrics.filter(m => String(m.userId) === String(selectedMember));
    }, [memberMetrics, selectedMember]);

    // --- KPIs computed from real metrics ---
    const kpis = useMemo(() => {
        const total     = filteredMetrics.reduce((s, m) => s + (m.metrics?.completedTasks ?? 0), 0);
        const avgOnTime = filteredMetrics.length
            ? filteredMetrics.reduce((s, m) => s + (m.metrics?.completionRate ?? 0), 0) / filteredMetrics.length
            : 0;
        const totalHrs  = filteredMetrics.reduce((s, m) => s + (m.metrics?.hoursWorked ?? 0), 0);
        const avgEff    = filteredMetrics.length
            ? filteredMetrics.reduce((s, m) => s + (m.metrics?.iel ?? 0), 0) / filteredMetrics.length
            : 0;
        return { total, avgOnTime, totalHrs, avgEff };
    }, [filteredMetrics]);

    const hasTeamSelected = selectedTeam && selectedTeam !== 'all';

    const teamTrendChart      = useMemo(() => ({ labels: [], datasets: [] }), []);
    const individualTrendChart = useMemo(() => ({ labels: [], datasets: [] }), []);
    const statusChart          = useMemo(() => ({ labels: [], data: [] }), []);

    // --- Handlers ---
    const handleTeamChange = (val) => {
        if (constraints.lockTeam) return;
        setSelectedTeam(val);
        if (!constraints.lockMember) setSelectedMember('all');
    };

    const handleMemberChange = (val) => {
        if (constraints.lockMember) return;
        setSelectedMember(val);
    };

    return (
        <>
            {/* Header + Period */}
            <div className="view-header">
                <h2 className="view-title">
                    <i className="fas fa-tachometer-alt" /> Dashboard del Equipo
                </h2>
                <PeriodSelector
                    period={dr.period}
                    onPeriodChange={dr.setPeriod}
                    customStart={dr.customStart}
                    onCustomStartChange={dr.setCustomStart}
                    customEnd={dr.customEnd}
                    onCustomEndChange={dr.setCustomEnd}
                    showCustom={false}
                />
            </div>

            {/* Filters */}
            <div className="filter-bar">
                <div className="filter-group">
                    <label className="filter-label">
                        <i className="fas fa-layer-group" /> Equipo
                    </label>
                    <select
                        className="form-select-sm"
                        value={selectedTeam}
                        disabled={constraints.lockTeam}
                        onChange={e => handleTeamChange(e.target.value)}
                    >
                        {!constraints.lockTeam && <option value="all">Todos los equipos</option>}
                        {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                </div>
                <div className="filter-group">
                    <label className="filter-label">
                        <i className="fas fa-user" /> Miembro
                    </label>
                    <select
                        className="form-select-sm"
                        value={selectedMember}
                        disabled={constraints.lockMember}
                        onChange={e => handleMemberChange(e.target.value)}
                    >
                        {!constraints.lockMember && <option value="all">Todos los miembros</option>}
                        {visibleMembers.map(m => (
                            <option key={m.userId} value={m.userId}>{m.displayname}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Row 1 – KPIs */}
            <div className="metrics-grid">
                <KpiCard color="primary" icon="fa-tasks"
                    value={hasTeamSelected && !metricsLoading ? kpis.total : '—'}
                    label="Tareas Completadas"
                />
                <KpiCard color="success" icon="fa-clock"
                    value={hasTeamSelected && !metricsLoading ? `${Math.round(kpis.avgOnTime)}%` : '—'}
                    label="Entrega a Tiempo (prom.)"
                />
                <KpiCard color="warning" icon="fa-hourglass-half"
                    value={hasTeamSelected && !metricsLoading ? `${kpis.totalHrs}h` : '—'}
                    label="Horas Trabajadas"
                />
                <KpiCard color="purple" icon="fa-bolt"
                    value={hasTeamSelected && !metricsLoading ? kpis.avgEff.toFixed(1) : '—'}
                    label="Índice de Efectividad"
                />
            </div>

            {/* Row 2 – Area charts */}
            <div className="charts-grid mx">
                {/* Team trend: responds to team filter only */}
                <div className="chart-card">
                    <h3 className="chart-title">
                        <i className="fas fa-chart-area" /> Tendencia de Entrega – Equipos
                    </h3>
                    <p className="text-muted text-sm" style={{ marginBottom: '0.5rem' }}>
                        Días antes (+) o después (−) del deadline. La línea punteada es el deadline exacto.
                    </p>
                    <AreaChart
                        labels={teamTrendChart.labels}
                        datasets={teamTrendChart.datasets}
                    />
                </div>

                {/* Individual trend: responds to team + member filters */}
                <div className="chart-card">
                    <h3 className="chart-title">
                        <i className="fas fa-chart-area" /> Tendencia de Entrega – Individual
                    </h3>
                    <p className="text-muted text-sm" style={{ marginBottom: '0.5rem' }}>
                        {selectedMember !== 'all'
                            ? `Margen de entrega de ${filteredMetrics[0]?.displayName ?? 'miembro seleccionado'}`
                            : 'Promedio del grupo filtrado'}
                    </p>
                    <AreaChart
                        labels={individualTrendChart.labels}
                        datasets={individualTrendChart.datasets}
                    />
                </div>
            </div>

            {/* Row 3 – Doughnut + Heatmap */}
            <div className="charts-grid mx" style={{ gridTemplateColumns: '2fr 3fr' }}>
                <div className="chart-card">
                    <h3 className="chart-title">
                        <i className="fas fa-chart-pie" /> Distribución por Estado
                    </h3>
                    <DoughnutChart
                        labels={statusChart.labels}
                        data={statusChart.data}
                    />
                </div>

                <div className="chart-card">
                    <h3 className="chart-title">
                        <i className="fas fa-fire" /> Mapa de Calor – Capacidad Semanal
                    </h3>
                    <p className="text-muted text-sm" style={{ marginTop: '-0.25rem', marginBottom: '0.75rem' }}>
                        Horas trabajadas por día. Asigna tareas urgentes a quien tenga menor carga.
                    </p>
                    <CapacityHeatmap
                        members={selectedMember !== 'all'
                            ? visibleMembers.filter(m => m.userId === selectedMember)
                            : visibleMembers}
                        capacity={{}}
                    />
                </div>
            </div>

            {/* Row 4 – Member detail table (6 columns) */}
            <div className="section-card mx">
                <h3 className="section-title">
                    <i className="fas fa-users" /> Detalle por Miembro
                </h3>
                <div className="table-wrapper">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Miembro</th>
                                <th>Tareas Completadas</th>
                                <th>Entrega a Tiempo</th>
                                <th>Rendimiento</th>
                                <th>Horas Trabajadas</th>
                                <th>Índice de Efectividad</th>
                            </tr>
                        </thead>
                        <tbody>
                            {metricsLoading && (
                                <tr>
                                    <td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }}>
                                        <i className="fas fa-spinner fa-spin" style={{ marginRight: '0.5rem' }} />
                                        Cargando métricas...
                                    </td>
                                </tr>
                            )}
                            {!metricsLoading && !hasTeamSelected && (
                                <tr>
                                    <td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }}>
                                        Selecciona un equipo para ver las métricas.
                                    </td>
                                </tr>
                            )}
                            {!metricsLoading && hasTeamSelected && filteredMetrics.map(m => (
                                <tr key={m.userId}>
                                    <td>
                                        <div className="member-cell">
                                            <div className="member-avatar">{initials(m.displayName)}</div>
                                            <div>
                                                <div className="member-name">{m.displayName}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td>{m.metrics?.completedTasks ?? 0}</td>
                                    <td><OnTimeBadge rate={m.metrics?.completionRate} /></td>
                                    <td>
                                        {m.metrics?.completedTasks ?? '—'}
                                        <span className="text-muted text-sm"> tareas/período</span>
                                    </td>
                                    <td>{m.metrics?.hoursWorked != null ? `${m.metrics.hoursWorked}h` : '—'}</td>
                                    <td>
                                        {m.metrics?.iel != null
                                            ? m.metrics.iel.toFixed(1)
                                            : '—'}
                                    </td>
                                </tr>
                            ))}
                            {!metricsLoading && hasTeamSelected && filteredMetrics.length === 0 && (
                                <tr>
                                    <td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }}>
                                        Sin datos para los filtros seleccionados.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </>
    );
}
