/** Modal de creación y edición de tareas/actividades. */

import { STATE }      from '../core/state.js';
import { createTask, updateTask, deleteTask, fetchTasks } from '../api/api.js';
import { renderBoard } from '../board/render.js';
import { generateId }  from '../shared/utils.js';
import { CONFIG }      from '../core/config.js';
import { openModal, closeModal } from '../shared/modal.js';

export function openNewTaskModal(type) {
    STATE.currentTaskType = type;
    STATE.editingTaskId = null;

    document.getElementById('modalNewTaskTitle').textContent   = type === 'activity' ? 'New Activity' : 'New Task';
    document.getElementById('activityTypeGroup').style.display = type === 'activity' ? 'block' : 'none';
    document.getElementById('subtasksGroup').style.display     = type === 'activity' ? 'none'  : 'block';

    document.getElementById('inputTaskName').value    = '';
    document.getElementById('inputStartDate').value   = new Date().toISOString().split('T')[0];
    document.getElementById('inputDeadline').value    = '';
    document.getElementById('inputPriority').value    = 'medium';
    document.getElementById('inputDescription').value = '';
    document.getElementById('subtasksContainer').innerHTML = '';

    const submitBtn = document.querySelector('#modalNewTask .modal-footer .btn-primary');
    if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-check"></i> Create';

    openModal('modalNewTask');
}

export function openEditTaskModal(taskId) {
    const task = STATE.tasks.find(t => t.id === taskId);
    if (!task) return;

    STATE.editingTaskId = taskId;
    STATE.currentTaskType = task.type;

    const isActivity = task.type === 'activity';

    document.getElementById('modalNewTaskTitle').textContent   = isActivity ? 'Edit Activity' : 'Edit Task';
    document.getElementById('activityTypeGroup').style.display = isActivity ? 'block' : 'none';
    document.getElementById('subtasksGroup').style.display     = isActivity ? 'none'  : 'block';

    document.getElementById('inputTaskName').value    = task.title ?? '';
    document.getElementById('inputDescription').value = task.description ?? '';
    document.getElementById('inputStartDate').value   = task.startDate ?? '';
    document.getElementById('inputDeadline').value    = task.deadline ?? '';
    document.getElementById('inputPriority').value    = task.priority ?? 'medium';

    if (isActivity) {
        const actTypeEl = document.getElementById('inputActivityType');
        if (actTypeEl && task.activityType) actTypeEl.value = task.activityType;
    }

    const container = document.getElementById('subtasksContainer');
    container.innerHTML = '';
    (task.subtasks ?? []).forEach((sub, index) => {
        const div = document.createElement('div');
        div.style.cssText = 'display: flex; gap: 0.5rem; margin-bottom: 0.5rem;';
        div.innerHTML = `
            <input type="text" class="form-input subtask-input" placeholder="Subtask ${index + 1}..." value="${sub.text ?? ''}">
            <button type="button" class="btn btn-secondary btn-sm" data-action="remove-parent">
                <i class="fas fa-times"></i>
            </button>`;
        container.appendChild(div);
    });

    const submitBtn = document.querySelector('#modalNewTask .modal-footer .btn-primary');
    if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-save"></i> Save Changes';

    openModal('modalNewTask');
}

export function addSubtaskInput() {
    const container = document.getElementById('subtasksContainer');
    const index     = container.children.length;
    const div       = document.createElement('div');

    div.style.cssText = 'display: flex; gap: 0.5rem; margin-bottom: 0.5rem;';
    div.innerHTML = `
        <input type="text" class="form-input subtask-input" placeholder="Subtask ${index + 1}...">
        <button type="button" class="btn btn-secondary btn-sm" data-action="remove-parent">
            <i class="fas fa-times"></i>
        </button>`;

    container.appendChild(div);
}

export async function submitNewTask() {
    const name = document.getElementById('inputTaskName').value.trim();
    if (!name) {
        alert('Name is required.');
        return;
    }

    const subtasks = Array.from(document.querySelectorAll('.subtask-input'))
        .map(input => ({ raw: input.value.trim() }))
        .filter(({ raw }) => raw)
        .map(({ raw }) => ({
            id:        generateId('sub'),
            text:      raw,
            completed: false,
            timeSpent: 0,
        }));

    const isEditing = !!STATE.editingTaskId;

    if (isEditing) {
        const taskId = STATE.editingTaskId;
        const existingTask = STATE.tasks.find(t => t.id === taskId);

        // Preservar estado completed/timeSpent de subtareas existentes al hacer match por texto
        const existingByText = new Map(
            (existingTask?.subtasks ?? []).map(s => [s.text.trim().toLowerCase(), s])
        );
        const mergedSubtasks = subtasks.map(s => {
            const prev = existingByText.get(s.text.trim().toLowerCase());
            return prev ? { ...prev, text: s.text } : s;
        });
        const completedCount = mergedSubtasks.filter(s => s.completed).length;
        const recalcProgress = mergedSubtasks.length > 0
            ? Math.round((completedCount / mergedSubtasks.length) * 100)
            : (existingTask?.progress ?? 0);

        const data = {
            title:        name,
            description:  document.getElementById('inputDescription').value.trim(),
            column:       existingTask?.column ?? (STATE.currentTaskType === 'activity' ? 'activities' : 'actively-working'),
            type:         STATE.currentTaskType,
            priority:     document.getElementById('inputPriority').value,
            startDate:    document.getElementById('inputStartDate').value,
            deadline:     document.getElementById('inputDeadline').value || null,
            activityType: STATE.currentTaskType === 'activity'
                ? document.getElementById('inputActivityType').value
                : null,
            subtasks:  mergedSubtasks,
            progress:  recalcProgress,
        };

        try {
            await updateTask(taskId, data);
        } catch (err) {
            console.error('[submitNewTask] Error al actualizar tarea:', err);
            alert('Error al actualizar la tarea. Por favor intenta de nuevo.');
            return;
        }

        if (CONFIG.BACKEND_URL) {
            try {
                const tareas = await fetchTasks();
                if (Array.isArray(tareas)) STATE.tasks = tareas;
            } catch (err) {
                console.error('[submitNewTask] Error al recargar tareas:', err);
            }
        }

        renderBoard();
        closeModal('modalNewTask');

        const submitBtn = document.querySelector('#modalNewTask .modal-footer .btn-primary');
        if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-check"></i> Create';

        STATE.editingTaskId = null;
        return;
    }

    try {
        await createTask({
            title:        name,
            description:  document.getElementById('inputDescription').value.trim(),
            column:       STATE.currentTaskType === 'activity' ? 'activities' : 'actively-working',
            type:         STATE.currentTaskType,
            priority:     document.getElementById('inputPriority').value,
            startDate:    document.getElementById('inputStartDate').value,
            deadline:     document.getElementById('inputDeadline').value || null,
            activityType: STATE.currentTaskType === 'activity'
                ? document.getElementById('inputActivityType').value
                : null,
            subtasks,
        });
    } catch (err) {
        console.error('[submitNewTask] Error al crear tarea:', err);
        alert('Error al crear la tarea. Por favor intenta de nuevo.');
        return;
    }

    if (CONFIG.BACKEND_URL) {
        try {
            const tareas = await fetchTasks();
            if (Array.isArray(tareas)) STATE.tasks = tareas;
        } catch (err) {
            console.error('[submitNewTask] Error al recargar tareas:', err);
        }
    }

    renderBoard();
    closeModal('modalNewTask');
}

export async function confirmDeleteTask(taskId) {
    const confirmed = confirm('¿Está seguro que desea eliminar esta tarjeta?');
    if (!confirmed) return;

    try {
        await deleteTask(taskId);
    } catch (err) {
        console.error('[confirmDeleteTask] Error al eliminar tarea:', err);
        alert('Error al eliminar la tarea. Por favor intenta de nuevo.');
        return;
    }

    if (CONFIG.BACKEND_URL) {
        try {
            const tareas = await fetchTasks();
            if (Array.isArray(tareas)) STATE.tasks = tareas;
        } catch (err) {
            console.error('[confirmDeleteTask] Error al recargar tareas:', err);
        }
    }

    renderBoard();
}
