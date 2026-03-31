/** Utilidades: formato de tiempo/fecha, IDs, efectividad, etiquetas de actividad. */

export function formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const hrs  = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(`${dateStr}T00:00:00`);
    return date.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
}

export function isOverdue(deadline) {
    if (!deadline) return false;
    return new Date(`${deadline}T23:59:59`) < new Date();
}

/**
 * Índice de Efectividad Laboral (IEL) ponderado.
 *
 * Para cada tarea proyecto i:
 *   C_i  = progress / 100                          (completitud, 0–1)
 *   R_o  = T_rem / T_tot                           (ratio oportunidad)
 *   e_i  = C_i × (1 + R_o)  capped en [0.0, 1.5]
 *
 * E_total = Σ e_i / N   →  devuelto como entero 0–150
 */
export function calculateEffectiveness(tasks) {
    const evaluable = tasks.filter(t => t.type === 'project');
    const N = evaluable.length;
    if (N === 0) return 0;

    const now = new Date();
    let sumEi = 0;

    for (const task of evaluable) {
        const Ci = (task.progress ?? 0) / 100;
        let Ro = 0;

        if (task.deadline) {
            const deadline = new Date(`${task.deadline}T23:59:59`);
            const T_rem = (deadline - now) / 3_600_000; // horas restantes (negativo si vencida)

            if (task.startDate) {
                const start = new Date(`${task.startDate}T00:00:00`);
                const T_tot = Math.max(1, (deadline - start) / 3_600_000); // mín 1h para evitar /0
                Ro = T_rem / T_tot;
            }
            // Si la tarea está al 100% y el deadline ya pasó, no penalizar:
            // probablemente fue completada a tiempo pero no guardamos la fecha exacta.
            if (Ci === 1.0 && T_rem < 0) Ro = 0;
        }
        // Sin deadline → Ro = 0 (factor tiempo neutro)

        const ei = Math.max(0.0, Math.min(1.5, Ci * (1 + Ro)));
        sumEi += ei;
    }

    return Math.round((sumEi / N) * 100); // 0–150
}

export function generateId(prefix = 'item') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function formatTimeCompact(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const hrs  = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    if (hrs === 0) return `${mins}m`;
    if (mins === 0) return `${hrs}h`;
    return `${hrs}h ${mins}m`;
}

export function formatLogDate(dateStr) {
    const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const d    = new Date(`${dateStr}T00:00:00`);
    const day  = days[d.getDay()];
    const dd   = String(d.getDate()).padStart(2, '0');
    const mm   = String(d.getMonth() + 1).padStart(2, '0');
    return `${day} ${dd}/${mm}`;
}

export function getActivityTypeLabel(type) {
    const labels = {
        meeting:  'Meeting',
        training: 'Training',
        event:    'Event',
        other:    'Other'
    };
    return labels[type] ?? type;
}

export function formatRelativeTime(dateInput) {
    if (!dateInput) return '';
    const date = dateInput.includes('T') ? new Date(dateInput) : new Date(`${dateInput}T00:00:00`);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Hoy';
    if (diffDays === 1) return 'Hace 1 día';
    if (diffDays < 30) return `Hace ${diffDays} días`;
    const months = Math.floor(diffDays / 30);
    if (months === 1) return 'Hace 1 mes';
    if (months < 12) return `Hace ${months} meses`;
    const years = Math.floor(months / 12);
    return years === 1 ? 'Hace 1 año' : `Hace ${years} años`;
}

export function formatTimeOfDay(isoStr) {
    if (!isoStr) return '';
    const date = new Date(isoStr);
    return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}
