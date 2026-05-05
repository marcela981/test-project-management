import { useState, useEffect, useRef } from 'react';
import { fetchTeams, fetchAdminUsers } from '../../dashboard/dashApi.js';
import { exportPerformanceReport, triggerBrowserDownload } from '../../api/reportsApi.js';

function showToast(message, type = 'success') {
    const el = document.createElement('div');
    el.className = `time-toast time-toast--${type}`;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
}

function buildPayload({ periodType, customStart, customEnd, scopeMode, selectedTeamIds, selectedUserIds, includeIndividualSheets, includeTeamSheets, topN }) {
    const payload = {
        period_type:               periodType,
        scope_mode:                scopeMode,
        include_individual_sheets: includeIndividualSheets,
        include_team_sheets:       includeTeamSheets,
        top_n:                     topN,
    };
    if (periodType === 'custom') {
        payload.start_date = customStart;
        payload.end_date   = customEnd;
    }
    if (scopeMode === 'teams')     payload.team_ids = selectedTeamIds;
    if (scopeMode === 'employees') payload.user_ids = selectedUserIds;
    return payload;
}

function validate({ periodType, customStart, customEnd, scopeMode, selectedTeamIds, selectedUserIds }) {
    if (periodType === 'custom') {
        if (!customStart || !customEnd) return 'Selecciona las fechas de inicio y fin.';
        if (customEnd < customStart)    return 'La fecha de inicio debe ser anterior a la fecha fin.';
    }
    if (scopeMode === 'teams'     && selectedTeamIds.length === 0) return 'Selecciona al menos un equipo.';
    if (scopeMode === 'employees' && selectedUserIds.length === 0) return 'Selecciona al menos un empleado.';
    return null;
}

const RADIO_BASE = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    cursor: 'pointer',
    fontSize: '0.875rem',
    padding: '0.35rem 0.75rem',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--color-border)',
    background: 'var(--color-surface)',
    transition: 'all var(--transition-fast)',
    userSelect: 'none',
};

const RADIO_ACTIVE = {
    borderColor: 'var(--color-primary)',
    background:  'var(--color-primary-light)',
    color:       'var(--color-primary)',
    fontWeight:  600,
};

function MultiSelect({ items, loading, selectedIds, onToggle, placeholder, labelKey }) {
    const [search, setSearch] = useState('');
    const filtered = items.filter(item =>
        String(item[labelKey] ?? '').toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div style={{ marginTop: '0.75rem' }}>
            <input
                type="text"
                className="form-input"
                style={{ marginBottom: '0.5rem' }}
                placeholder={placeholder}
                value={search}
                onChange={e => setSearch(e.target.value)}
            />
            <div style={{
                maxHeight: '160px',
                overflowY: 'auto',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-surface)',
            }}>
                {loading ? (
                    <div style={{ padding: '0.75rem', textAlign: 'center', fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>
                        <i className="fas fa-spinner fa-spin" style={{ marginRight: '0.4rem' }} />
                        Cargando...
                    </div>
                ) : filtered.length === 0 ? (
                    <div style={{ padding: '0.75rem', textAlign: 'center', fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>
                        Sin resultados
                    </div>
                ) : filtered.map((item, idx) => (
                    <label key={item.id} style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        padding: '0.5rem 0.75rem',
                        cursor: 'pointer',
                        fontSize: '0.875rem',
                        borderBottom: idx < filtered.length - 1 ? '1px solid var(--color-border)' : 'none',
                        background: selectedIds.includes(item.id) ? 'var(--color-primary-light)' : 'transparent',
                        transition: 'background var(--transition-fast)',
                    }}>
                        <input
                            type="checkbox"
                            checked={selectedIds.includes(item.id)}
                            onChange={() => onToggle(item.id)}
                            style={{ accentColor: 'var(--color-primary)', flexShrink: 0 }}
                        />
                        <span>{item[labelKey]}</span>
                    </label>
                ))}
            </div>
            {selectedIds.length > 0 && (
                <p style={{ fontSize: '0.8rem', color: 'var(--color-primary)', marginTop: '0.4rem', fontWeight: 500 }}>
                    {selectedIds.length} seleccionado(s)
                </p>
            )}
        </div>
    );
}

export default function DownloadMetricsModal({ isOpen, onClose }) {
    const [periodType,              setPeriodType]              = useState('month');
    const [customStart,             setCustomStart]             = useState('');
    const [customEnd,               setCustomEnd]               = useState('');
    const [scopeMode,               setScopeMode]               = useState('full');
    const [selectedTeamIds,         setSelectedTeamIds]         = useState([]);
    const [selectedUserIds,         setSelectedUserIds]         = useState([]);
    const [includeIndividualSheets, setIncludeIndividualSheets] = useState(false);
    const [includeTeamSheets,       setIncludeTeamSheets]       = useState(true);
    const [topN,                    setTopN]                    = useState(10);
    const [isGenerating,            setIsGenerating]            = useState(false);
    const [error,                   setError]                   = useState(null);

    const [teams,        setTeams]        = useState([]);
    const [users,        setUsers]        = useState([]);
    const [teamsLoading, setTeamsLoading] = useState(false);
    const [usersLoading, setUsersLoading] = useState(false);
    const abortRef = useRef(null);

    useEffect(() => {
        if (scopeMode === 'teams' && teams.length === 0 && !teamsLoading) {
            setTeamsLoading(true);
            fetchTeams()
                .then(data => setTeams(data ?? []))
                .catch(() => {})
                .finally(() => setTeamsLoading(false));
        }
        if (scopeMode === 'employees' && users.length === 0 && !usersLoading) {
            setUsersLoading(true);
            fetchAdminUsers()
                .then(data => setUsers(
                    (data ?? []).map(u => ({
                        ...u,
                        displayName: u.displayName || u.displayname || u.ncUserId || String(u.id),
                    }))
                ))
                .catch(() => {})
                .finally(() => setUsersLoading(false));
        }
    }, [scopeMode]);

    useEffect(() => {
        if (!isOpen) {
            abortRef.current?.abort();
            setIsGenerating(false);
            setError(null);
        }
    }, [isOpen]);

    function toggleTeam(id) {
        setSelectedTeamIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    }

    function toggleUser(id) {
        setSelectedUserIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    }

    async function handleSubmit(e) {
        e.preventDefault();
        const validationError = validate({ periodType, customStart, customEnd, scopeMode, selectedTeamIds, selectedUserIds });
        if (validationError) { setError(validationError); return; }

        setError(null);
        setIsGenerating(true);
        const controller = new AbortController();
        abortRef.current = controller;

        try {
            const payload = buildPayload({
                periodType, customStart, customEnd,
                scopeMode, selectedTeamIds, selectedUserIds,
                includeIndividualSheets, includeTeamSheets, topN,
            });
            const { blob, filename } = await exportPerformanceReport(payload, controller.signal);
            triggerBrowserDownload(blob, filename);
            showToast('Reporte descargado correctamente.', 'success');
            onClose();
        } catch (err) {
            if (err.name === 'AbortError') return;
            const msg = err.status ? `Error ${err.status}: ${err.message}` : err.message;
            setError(msg);
            showToast(msg, 'error');
        } finally {
            setIsGenerating(false);
        }
    }

    function handleCancel() {
        if (isGenerating) {
            abortRef.current?.abort();
        } else {
            onClose();
        }
    }

    if (!isOpen) return null;

    return (
        <div
            className="modal-overlay active"
            onClick={e => { if (e.target === e.currentTarget && !isGenerating) onClose(); }}
        >
            <div className="modal" style={{ maxWidth: '560px' }}>
                <div className="modal-header">
                    <span className="modal-title">
                        <i className="fas fa-file-excel" style={{ marginRight: '0.5rem', color: 'var(--color-success)' }} />
                        Descargar Reporte de Métricas
                    </span>
                    <button
                        type="button"
                        className="modal-close"
                        onClick={handleCancel}
                        disabled={isGenerating}
                        aria-label="Cerrar"
                    >
                        <i className="fas fa-times" />
                    </button>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

                        {/* ── Período ── */}
                        <section>
                            <p className="section-title" style={{ marginBottom: '0.5rem', fontSize: '0.9375rem' }}>
                                <i className="fas fa-calendar-alt" />
                                Período
                            </p>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                {[
                                    { value: 'week',    label: 'Semana'        },
                                    { value: 'month',   label: 'Mes'           },
                                    { value: 'quarter', label: 'Trimestre'     },
                                    { value: 'custom',  label: 'Personalizado' },
                                ].map(({ value, label }) => (
                                    <label
                                        key={value}
                                        style={{ ...RADIO_BASE, ...(periodType === value ? RADIO_ACTIVE : {}) }}
                                    >
                                        <input
                                            type="radio"
                                            name="periodType"
                                            value={value}
                                            checked={periodType === value}
                                            onChange={() => { setPeriodType(value); setError(null); }}
                                            disabled={isGenerating}
                                            style={{ accentColor: 'var(--color-primary)' }}
                                        />
                                        {label}
                                    </label>
                                ))}
                            </div>
                            {periodType === 'custom' && (
                                <div className="form-row" style={{ marginTop: '0.75rem' }}>
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">Desde</label>
                                        <input
                                            type="date"
                                            className="form-input"
                                            value={customStart}
                                            onChange={e => { setCustomStart(e.target.value); setError(null); }}
                                            disabled={isGenerating}
                                        />
                                    </div>
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">Hasta</label>
                                        <input
                                            type="date"
                                            className="form-input"
                                            value={customEnd}
                                            onChange={e => { setCustomEnd(e.target.value); setError(null); }}
                                            disabled={isGenerating}
                                        />
                                    </div>
                                </div>
                            )}
                        </section>

                        {/* ── Alcance ── */}
                        <section>
                            <p className="section-title" style={{ marginBottom: '0.5rem', fontSize: '0.9375rem' }}>
                                <i className="fas fa-sitemap" />
                                Alcance
                            </p>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                {[
                                    { value: 'full',      label: 'Reporte Completo' },
                                    { value: 'teams',     label: 'Por Equipos'      },
                                    { value: 'employees', label: 'Por Empleados'    },
                                ].map(({ value, label }) => (
                                    <label
                                        key={value}
                                        style={{ ...RADIO_BASE, ...(scopeMode === value ? RADIO_ACTIVE : {}) }}
                                    >
                                        <input
                                            type="radio"
                                            name="scopeMode"
                                            value={value}
                                            checked={scopeMode === value}
                                            onChange={() => { setScopeMode(value); setError(null); }}
                                            disabled={isGenerating}
                                            style={{ accentColor: 'var(--color-primary)' }}
                                        />
                                        {label}
                                    </label>
                                ))}
                            </div>
                            {scopeMode === 'teams' && (
                                <MultiSelect
                                    items={teams}
                                    loading={teamsLoading}
                                    selectedIds={selectedTeamIds}
                                    onToggle={toggleTeam}
                                    placeholder="Buscar equipo..."
                                    labelKey="name"
                                />
                            )}
                            {scopeMode === 'employees' && (
                                <MultiSelect
                                    items={users}
                                    loading={usersLoading}
                                    selectedIds={selectedUserIds}
                                    onToggle={toggleUser}
                                    placeholder="Buscar empleado..."
                                    labelKey="displayName"
                                />
                            )}
                        </section>

                        {/* ── Opciones ── */}
                        <section>
                            <p className="section-title" style={{ marginBottom: '0.75rem', fontSize: '0.9375rem' }}>
                                <i className="fas fa-sliders-h" />
                                Opciones
                            </p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                <label style={{
                                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                                    cursor: isGenerating ? 'not-allowed' : 'pointer',
                                    fontSize: '0.875rem',
                                }}>
                                    <input
                                        type="checkbox"
                                        checked={includeTeamSheets}
                                        onChange={e => setIncludeTeamSheets(e.target.checked)}
                                        disabled={isGenerating}
                                        style={{ accentColor: 'var(--color-primary)', width: 16, height: 16, flexShrink: 0 }}
                                    />
                                    Incluir hojas por equipo
                                </label>

                                <div>
                                    <label style={{
                                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                                        cursor: isGenerating ? 'not-allowed' : 'pointer',
                                        fontSize: '0.875rem',
                                    }}>
                                        <input
                                            type="checkbox"
                                            checked={includeIndividualSheets}
                                            onChange={e => setIncludeIndividualSheets(e.target.checked)}
                                            disabled={isGenerating}
                                            style={{ accentColor: 'var(--color-primary)', width: 16, height: 16, flexShrink: 0 }}
                                        />
                                        Incluir hojas individuales por empleado
                                    </label>
                                    {includeIndividualSheets && (
                                        <div style={{
                                            marginTop: '0.4rem',
                                            padding: '0.5rem 0.75rem',
                                            background: 'var(--color-warning-light)',
                                            border: '1px solid var(--color-warning)',
                                            borderRadius: 'var(--radius-sm)',
                                            fontSize: '0.8125rem',
                                            color: 'var(--color-text-primary)',
                                            lineHeight: 1.4,
                                        }}>
                                            <i className="fas fa-exclamation-triangle" style={{ marginRight: '0.35rem', color: 'var(--color-warning)' }} />
                                            Genera 1 hoja por empleado, puede tomar más tiempo
                                        </div>
                                    )}
                                </div>

                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label className="form-label">
                                        Top N empleados: <strong>{topN}</strong>
                                    </label>
                                    <input
                                        type="range"
                                        min={5}
                                        max={25}
                                        step={1}
                                        value={topN}
                                        onChange={e => setTopN(Number(e.target.value))}
                                        disabled={isGenerating}
                                        style={{ width: '100%', accentColor: 'var(--color-primary)', cursor: isGenerating ? 'not-allowed' : 'pointer' }}
                                    />
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: '0.15rem' }}>
                                        <span>5</span>
                                        <span>25</span>
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* ── Validación / Estado ── */}
                        {error && (
                            <p className="form-error" style={{ margin: 0 }}>
                                <i className="fas fa-exclamation-circle" style={{ marginRight: '0.35rem' }} />
                                {error}
                            </p>
                        )}
                        {isGenerating && (
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                padding: '0.75rem',
                                background: 'var(--color-primary-light)',
                                borderRadius: 'var(--radius-md)',
                                fontSize: '0.875rem',
                                color: 'var(--color-primary)',
                                fontWeight: 500,
                            }}>
                                <i className="fas fa-spinner fa-spin" />
                                Generando reporte... (puede tardar 10-30s)
                            </div>
                        )}
                    </div>

                    <div className="modal-footer">
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={handleCancel}
                        >
                            {isGenerating ? 'Abortar' : 'Cancelar'}
                        </button>
                        <button
                            type="submit"
                            className="btn btn-primary"
                            disabled={isGenerating}
                        >
                            {isGenerating ? (
                                <><i className="fas fa-spinner fa-spin" /> Generando...</>
                            ) : (
                                <><i className="fas fa-download" /> Descargar</>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
