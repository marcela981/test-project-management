/** KPIs: tareas activas, tiempo total, efectividad, completadas. */

import { STATE } from './state.js';
import { formatTime, calculateEffectiveness } from './utils.js';

export function updateKPIs() {
    const projectTasks = STATE.tasks.filter(t => t.type === 'project');
    const activeTasks  = projectTasks.filter(t => t.progress < 100);
    const totalTime    = STATE.tasks.reduce((acc, t) => acc + (t.timeSpent ?? 0), 0);
    const effectiveness = calculateEffectiveness(STATE.tasks);

    const avgProgress = projectTasks.length > 0
        ? Math.round(projectTasks.reduce((acc, t) => acc + (t.progress ?? 0), 0) / projectTasks.length)
        : 0;

    document.getElementById('kpiTareasActivas').textContent  = activeTasks.length;
    document.getElementById('kpiTiempoTotal').textContent    = formatTime(totalTime);
    document.getElementById('kpiEfectividad').textContent    = `${effectiveness}%`;
    document.getElementById('kpiCompletadas').textContent    = `${avgProgress}%`;
}
