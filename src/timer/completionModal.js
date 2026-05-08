/** Modal de cierre de tarea: dificultad, obstáculos y registro final. */

import { STATE }      from '../core/state.js';
import { updateTask, saveTime, completeTask } from '../api/api.js';
import { renderBoard } from '../board/render.js';
import { formatTime }  from '../shared/utils.js';
import { openModal, closeModal } from '../shared/modal.js';

const OBSTACLES = [
    'Complejidad Lógica',
    'Infraestructura/Entorno',
    'Documentación Escasa',
    'Requerimientos Ambiguos',
    'Deuda Técnica',
    'Funcionamiento del equipo',
];

export function openCompletionModal(taskId, elapsed, subtaskId, sessionStart = null) {
    const task = STATE.tasks.find(t => t.id === taskId);
    if (!task || task.type !== 'project') return;

    document.getElementById('modalDetailTitle').textContent = '¡Tarea Completada!';

    document.getElementById('modalDetailBody').innerHTML = `
        <div class="completion-feedback">
            <div class="completion-header">
                <i class="fas fa-trophy"></i>
                <p>Has finalizado <strong>"${task.title}"</strong></p>
                <p class="completion-time-recorded">Tiempo registrado: ${formatTime(elapsed)}</p>
            </div>

            <div class="form-group">
                <label class="form-label">
                    Nivel de Dificultad
                    <span class="optional-badge">Opcional</span>
                </label>
                <div class="difficulty-group">
                    <span class="difficulty-scale-label">Fácil</span>
                    <input type="range" id="completionDifficulty" class="difficulty-slider"
                           min="0" max="10" value="0"
                           oninput="
                               const v = +this.value;
                               document.getElementById('completionDifficultyValue').textContent = v === 0 ? 'Sin calificar' : v;
                               document.getElementById('completionDifficultyValue').className = 'difficulty-badge' + (v === 0 ? '' : v > 5 ? ' high' : ' low');
                               document.getElementById('completionObstaclesGroup').style.display = v > 5 ? 'block' : 'none';
                           ">
                    <span class="difficulty-scale-label">Difícil</span>
                    <span id="completionDifficultyValue" class="difficulty-badge">Sin calificar</span>
                </div>
            </div>

            <div id="completionObstaclesGroup" class="obstacles-group" style="display:none;">
                <label class="form-label">
                    Identificación de Obstáculos
                    <span class="required-badge">Obligatorio</span>
                </label>
                <div class="obstacles-checklist">
                    ${OBSTACLES.map(o => `
                        <label class="obstacle-item">
                            <input type="checkbox" class="completion-obstacle" value="${o}">
                            <span>${o}</span>
                        </label>`).join('')}
                </div>
            </div>
        </div>`;

    document.getElementById('modalDetailFooter').innerHTML = `
        <button class="btn btn-secondary" data-action="cancel-completion" data-task-id="${taskId}">
            <i class="fas fa-undo"></i> Cancelar
        </button>
        <button class="btn btn-primary" data-action="confirm-completion"
                data-task-id="${taskId}"
                data-elapsed="${elapsed}"
                data-subtask-id="${subtaskId ?? 'none'}"
                data-session-start="${sessionStart ?? ''}">
            <i class="fas fa-check-double"></i> Confirmar
        </button>`;

    openModal('modalTaskDetail');
}

export async function confirmCompletion(taskId, elapsed, subtaskId, sessionStart = null) {
    const difficulty = parseInt(document.getElementById('completionDifficulty').value, 10) || 0;
    let obstacles = [];

    if (difficulty > 5) {
        obstacles = Array.from(document.querySelectorAll('.completion-obstacle:checked')).map(cb => cb.value);
        if (obstacles.length === 0) {
            alert('Por favor selecciona al menos un obstáculo.');
            return;
        }
    }

    await updateTask(taskId, {
        difficulty: difficulty === 0 ? null : difficulty,
        obstacles,
    });

    const task = STATE.tasks.find(t => t.id === taskId);
    if (!task) return;

    const hasSubtask = subtaskId && subtaskId !== 'none';

    if (hasSubtask) {
        await saveTime(taskId, elapsed, subtaskId, {}, sessionStart);
        const sub = task.subtasks.find(s => s.id === subtaskId);
        if (sub) sub.completed = true;
        const done = task.subtasks.filter(s => s.completed).length;
        task.progress = Math.round((done / task.subtasks.length) * 100);
        await completeTask(taskId);
    } else {
        await saveTime(taskId, elapsed, null, { progress: 100 }, sessionStart);
        await completeTask(taskId);
    }

    const debugTask = STATE.tasks.find(t => t.id === taskId);
    console.log('[DEBUG] task.column after completeTask:', debugTask?.column, '| type:', debugTask?.type);

    closeModal('modalTaskDetail');
    renderBoard();
}
