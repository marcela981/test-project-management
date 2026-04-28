import { STATE }      from '../core/state.js';
import { createTask, updateTask, deleteTask, fetchTasks } from '../api/api.js';
import { createTimeLog, updateTimeLog, deleteTimeLog, fetchTimeLogs } from '../api/timeLogs.js';
import { emitTimeLogChanged } from '../core/events.js';
import { renderBoard } from '../board/render.js';
import { generateId, formatTime, formatDate, isOverdue, formatTimeCompact, formatLogDate }  from '../shared/utils.js';
import { CONFIG }      from '../core/config.js';
import { openModal, closeModal, registerDirtyCheck } from '../shared/modal.js';
import {
    enableRetro, disableRetro,
    getRetroValues, isRetroActive, validateRetro,
} from './retroactiveAccordion.js';
import { save }        from '../core/storage.js';

let currentTab    = 'edicion';
let _formSnapshot = null;

function _getFormState() {
    return {
        name:        document.getElementById('inputTaskName')?.value ?? '',
        description: document.getElementById('inputDescription')?.value ?? '',
        startDate:   document.getElementById('inputStartDate')?.value ?? '',
        deadline:    document.getElementById('inputDeadline')?.value ?? '',
        priority:    document.getElementById('inputPriority')?.value ?? '',
        subtasks:    [...document.querySelectorAll('.subtask-input')].map(s => s.value).join('\n'),
        retroActive: isRetroActive(),
    };
}

function _isTaskFormDirty() {
    if (!_formSnapshot) return false;
    return JSON.stringify(_getFormState()) !== JSON.stringify(_formSnapshot);
}

registerDirtyCheck('modalNewTask', _isTaskFormDirty);

export function switchTab(tab) {
    currentTab = tab;
    ['edicion', 'tiempo', 'resumen'].forEach(t => {
        const btn = document.querySelector(`[data-tab="${t}"]`);
        const body = document.getElementById(`tab-${t}`);
        if (btn) {
            btn.classList.toggle('active', t === tab);
            btn.style.borderBottomColor = t === tab ? 'var(--color-primary)' : 'transparent';
            btn.style.color = t === tab ? 'inherit' : 'var(--text-muted)';
        }
        if (body) body.style.display = t === tab ? 'block' : 'none';
    });

    // Sólo la tab Edición tiene Save/Cancel. En Tiempo/Resumen se oculta.
    const footer = document.getElementById('modalNewTaskFooter');
    if (footer) footer.style.display = tab === 'edicion' ? 'flex' : 'none';
}

export function openNewTaskModal(type) {
    STATE.currentTaskType = type;
    STATE.editingTaskId = null;

    document.getElementById('modalTaskTabs').style.display = 'none';
    switchTab('edicion');

    document.getElementById('modalNewTaskTitle').textContent   = type === 'activity' ? 'New Activity' : 'New Task';
    document.getElementById('activityTypeGroup').style.display = type === 'activity' ? 'block' : 'none';
    document.getElementById('subtasksGroup').style.display     = type === 'activity' ? 'none'  : 'block';

    document.getElementById('inputTaskName').value    = '';
    document.getElementById('inputStartDate').value   = new Date().toISOString().split('T')[0];
    document.getElementById('inputDeadline').value    = '';
    document.getElementById('inputPriority').value    = 'medium';
    document.getElementById('inputDescription').value = '';
    document.getElementById('subtasksContainer').innerHTML = '';

    const submitBtn = document.querySelector('#modalNewTaskFooter .btn-primary');
    if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-check"></i> Create';
    document.getElementById('modalNewTaskFooter').style.display = 'flex';

    enableRetro();
    _formSnapshot = _getFormState();
    openModal('modalNewTask');
}

export async function openEditTaskModal(taskId) {
    const task = STATE.tasks.find(t => t.id === taskId);
    if (!task) return;

    STATE.editingTaskId = taskId;
    STATE.currentTaskType = task.type;

    document.getElementById('modalTaskTabs').style.display = 'flex';
    switchTab('edicion');

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
            <input type="text" class="form-input subtask-input" placeholder="Subtask ${index + 1}..." value="${sub.text ?? ''}" data-subtask-id="${sub.id ?? ''}">
            <button type="button" class="btn btn-secondary btn-sm" data-action="remove-parent">
                <i class="fas fa-times"></i>
            </button>`;
        container.appendChild(div);
    });

    const submitBtn = document.querySelector('#modalNewTaskFooter .btn-primary');
    if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-save"></i> Save Changes';

    // Render inicial con lo que ya tenemos en STATE.
    renderResumenTab(task);
    renderTiempoTab(task);

    disableRetro();
    _formSnapshot = _getFormState();
    openModal('modalNewTask');

    // Hidratar time logs con IDs canónicos del backend (necesarios para edit/delete).
    if (CONFIG.BACKEND_URL) {
        try {
            const logs = await fetchTimeLogs(task.id, isActivity);
            if (Array.isArray(logs)) {
                task.timeLog = logs.map(l => ({
                    id: l.id,
                    date: l.logDate,
                    seconds: l.seconds,
                }));
                if (STATE.editingTaskId === task.id) {
                    renderTiempoTab(task);
                    renderResumenTab(task);
                }
            }
        } catch (e) {
            console.warn('[openEditTaskModal] No se pudieron hidratar time logs:', e);
        }
    }
}

// ── Tab Resumen (solo lectura, subtasks interactivas) ────────────────────────

function renderResumenTab(task) {
    const isComplete = task.progress === 100;
    const completedCount = (task.subtasks ?? []).filter(s => s.completed).length;
    const totalCount     = (task.subtasks ?? []).length;
    const pct = task.progress ?? (totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0);

    let html = `
        <div class="mb-2">
            <p class="text-muted">${task.description ? escapeHtml(task.description) : 'No description.'}</p>
        </div>
        <div class="form-row mb-2">
            <div>
                <span class="form-label">Start</span>
                <p>${formatDate(task.startDate)}</p>
            </div>
            <div>
                <span class="form-label">Deadline</span>
                <p class="${isOverdue(task.deadline) && !isComplete ? 'text-danger' : ''} ${isComplete ? 'text-success' : ''}">
                    ${formatDate(task.deadline)}
                </p>
            </div>
        </div>
        <div class="mb-2">
            <span class="form-label">Priority</span>
            <p>${task.priority ?? '—'}</p>
        </div>
        <div class="mb-2">
            <span class="form-label">Investment time</span>
            <p style="font-size:1.25rem; font-weight:600; color:var(--color-primary);">${formatTime(task.timeSpent ?? 0)}</p>
        </div>
        ${totalCount > 0 || (task.progress ?? 0) > 0 ? `
        <div class="mb-2">
            <span class="form-label">Progress (${pct}%)</span>
            <div class="progress-bar" style="margin-top:.35rem;">
                <div class="progress-fill ${isComplete ? 'complete' : ''}" style="width:${pct}%"></div>
            </div>
        </div>` : ''}
    `;

    if (task.timeLog && task.timeLog.length > 0) {
        html += `
        <div class="mb-2">
            <span class="form-label">Time log</span>
            <div class="time-log mt-1">
                ${[...task.timeLog]
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .map(entry => `
                        <div class="time-log-entry">
                            <span class="time-log-date">${formatLogDate(entry.date)}</span>
                            <span class="time-log-duration">${formatTimeCompact(entry.seconds)}</span>
                        </div>`).join('')}
            </div>
        </div>`;
    }

    if (totalCount > 0) {
        html += `
            <div class="mb-2">
                <span class="form-label">
                    Subtasks (${completedCount}/${totalCount})
                </span>
                <div class="subtasks-list mt-1">
                    ${task.subtasks.map(sub => `
                        <div class="subtask-item ${sub.completed ? 'completed' : ''}"
                             data-action="toggle-subtask" data-task-id="${task.id}" data-subtask-id="${sub.id}">
                            <div class="subtask-checkbox">
                                ${sub.completed ? '<i class="fas fa-check"></i>' : ''}
                            </div>
                            <span class="subtask-text">${escapeHtml(sub.text ?? '')}</span>
                            <span class="subtask-time">${formatTimeCompact(sub.timeSpent ?? 0)}</span>
                        </div>`).join('')}
                </div>
            </div>`;
    }

    if (task.observations && task.observations.length > 0) {
        html += `
            <div class="mb-2">
                <span class="form-label">Observations</span>
                <div class="mt-1">
                    ${task.observations.map(obs => {
                        const text = typeof obs === 'string' ? obs : obs.text;
                        const date = typeof obs === 'string' ? '' : new Date(obs.date).toLocaleString('en-US');
                        return `
                            <div style="padding:.5rem; background:var(--color-secondary-light);
                                        border-radius:var(--radius-sm); margin-bottom:.5rem;">
                                ${date ? `<small class="text-muted">${date}</small>` : ''}
                                <p style="margin-top:.25rem;">${escapeHtml(text ?? '')}</p>
                            </div>`;
                    }).join('')}
                </div>
            </div>`;
    }

    if (!isComplete) {
        html += `
        <div class="overview-finalize-cta">
            <button class="btn btn-primary" data-action="finalize-task" data-task-id="${task.id}">
                <i class="fas fa-check-double"></i> ¿Ya finalizaste?
            </button>
        </div>`;
    }

    document.getElementById('resumen-content').innerHTML = html;
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
}

export async function toggleSubtask(taskId, subtaskId) {
    const task = STATE.tasks.find(t => t.id === taskId);
    const subtask = task?.subtasks.find(s => s.id === subtaskId);
    if (!subtask) return;

    subtask.completed = !subtask.completed;
    task.progress = Math.round(
        (task.subtasks.filter(s => s.completed).length / task.subtasks.length) * 100
    );

    save();
    try {
        await updateTask(taskId, { subtasks: task.subtasks, progress: task.progress });
    } catch (e) {
        console.error(e);
    }

    if (STATE.editingTaskId === taskId) {
        renderResumenTab(task);
    }
    renderBoard();
}

// ── Tab Tiempo ───────────────────────────────────────────────────────────────

export function renderTiempoTab(task) {
    document.getElementById('tiempo-total-display').textContent = formatTime(task.timeSpent ?? 0);
    document.getElementById('add-time-log-form').style.display = 'none';
    document.getElementById('inputLogDate').max = new Date().toISOString().split('T')[0];
    renderTimeLogsList(task);
    renderExistingDatesHint(task);
}

function renderTimeLogsList(task) {
    const list = document.getElementById('time-logs-list');
    if (!task.timeLog || task.timeLog.length === 0) {
        list.innerHTML = `<div class="text-muted" style="text-align:center; padding:1rem;">No records yet</div>`;
        return;
    }

    list.innerHTML = [...task.timeLog]
        .sort((a, b) => b.date.localeCompare(a.date))
        .map(entry => {
            const key = entry.id ?? `tmp-${entry.date}`;
            const h = Math.floor((entry.seconds ?? 0) / 3600);
            const m = Math.floor(((entry.seconds ?? 0) % 3600) / 60);
            const s = (entry.seconds ?? 0) % 60;
            const editable = entry.id != null && !String(entry.id).startsWith('temp-');
            return `
            <div class="time-log-row">
                <button class="btn-icon btn-delete-icon" data-action="delete-time-log" data-log-id="${key}" ${editable ? '' : 'disabled'} title="Delete">
                    <i class="fas fa-minus-circle"></i>
                </button>
                <span class="time-log-date">${formatLogDate(entry.date)}</span>
                <span class="time-log-duration">${formatTimeCompact(entry.seconds ?? 0)}</span>
                <button class="btn-icon btn-edit-icon" data-action="edit-time-log" data-log-id="${key}" ${editable ? '' : 'disabled'} title="Edit">
                    <i class="fas fa-pencil-alt"></i>
                </button>
            </div>
            <div id="edit-time-log-form-${key}" class="time-log-add-form" style="display:none;">
                <div class="time-log-add-row">
                    <div class="hms-group">
                        <input type="number" id="editLogH-${key}" class="form-input hms-input" min="0" value="${h}">
                        <span>h</span>
                        <input type="number" id="editLogM-${key}" class="form-input hms-input" min="0" max="59" value="${m}">
                        <span>m</span>
                        <input type="number" id="editLogS-${key}" class="form-input hms-input" min="0" max="59" value="${s}">
                        <span>s</span>
                    </div>
                    <button class="btn btn-primary btn-sm" data-action="save-edit-time-log" data-log-id="${key}" data-log-date="${entry.date}">Guardar</button>
                    <button class="btn btn-secondary btn-sm" data-action="cancel-edit-time-log" data-log-id="${key}">Cancelar</button>
                </div>
            </div>`;
        }).join('');
}

function renderExistingDatesHint(task) {
    const form = document.getElementById('add-time-log-form');
    if (!form) return;
    const existing = new Set((task.timeLog ?? []).map(l => l.date));
    let hint = form.querySelector('.time-log-existing-hint');
    if (!hint) {
        hint = document.createElement('div');
        hint.className = 'time-log-existing-hint text-muted';
        hint.style.cssText = 'font-size:0.75rem; margin-top:.35rem;';
        form.appendChild(hint);
    }
    if (existing.size === 0) {
        hint.textContent = '';
        return;
    }
    const dates = [...existing].sort().reverse().slice(0, 10).map(d => formatLogDate(d)).join(', ');
    hint.textContent = `Fechas ya registradas (no disponibles): ${dates}${existing.size > 10 ? '…' : ''}`;
}

export function openAddTimeLog() {
    const task = STATE.tasks.find(t => t.id === STATE.editingTaskId);
    if (!task) return;

    const form = document.getElementById('add-time-log-form');
    form.style.display = 'block';
    document.getElementById('inputLogH').value = 0;
    document.getElementById('inputLogM').value = 0;
    document.getElementById('inputLogS').value = 0;
    document.getElementById('inputLogDate').value = new Date().toISOString().split('T')[0];
    renderExistingDatesHint(task);
}

export function cancelAddTimeLog() {
    document.getElementById('add-time-log-form').style.display = 'none';
}

export async function saveNewTimeLog() {
    if (!STATE.editingTaskId) return;
    const task = STATE.tasks.find(t => t.id === STATE.editingTaskId);
    if (!task) return;

    const date = document.getElementById('inputLogDate').value;
    const h = parseInt(document.getElementById('inputLogH').value, 10) || 0;
    const m = parseInt(document.getElementById('inputLogM').value, 10) || 0;
    const s = parseInt(document.getElementById('inputLogS').value, 10) || 0;
    const seconds = h * 3600 + m * 60 + s;

    if (!date) { alert('Selecciona una fecha.'); return; }
    if (date > new Date().toISOString().split('T')[0]) {
        alert('No se permiten fechas futuras.');
        return;
    }
    if (seconds <= 0) { alert('La duración debe ser mayor a 0.'); return; }
    if (seconds > 86400) { alert('La duración máxima por día es 24 horas.'); return; }

    task.timeLog = task.timeLog ?? [];
    if (task.timeLog.some(l => l.date === date)) {
        alert('Ya existe un registro para esta fecha. Edítalo en la lista.');
        return;
    }

    // Optimista: agregar localmente con ID temporal.
    const tempId = `temp-${Date.now()}`;
    const tempEntry = { id: tempId, date, seconds };
    task.timeLog.push(tempEntry);
    task.timeSpent = (task.timeSpent ?? 0) + seconds;
    cancelAddTimeLog();
    renderTiempoTab(task);
    renderResumenTab(task);
    renderBoard();

    try {
        const res = await createTimeLog(task.id, task.type === 'activity', { logDate: date, seconds });
        const updated = res?.task ?? res?.activity;
        if (updated) syncTaskFromBackend(task, updated);
        emitTimeLogChanged({ taskId: task.id, type: 'create' });
    } catch (e) {
        console.error('[saveNewTimeLog]', e);
        // Revertir.
        task.timeLog = task.timeLog.filter(l => l.id !== tempId);
        task.timeSpent = Math.max(0, (task.timeSpent ?? 0) - seconds);
        renderTiempoTab(task);
        renderResumenTab(task);
        renderBoard();
        alert(e.code === 409
            ? 'Ya existe un registro para esta fecha en el servidor.'
            : 'No se pudo guardar el registro. Se reintentará automáticamente.');
    }
}

export function openEditTimeLog(logId) {
    const el = document.getElementById(`edit-time-log-form-${logId}`);
    if (el) el.style.display = 'block';
}

export function cancelEditTimeLog(logId) {
    const el = document.getElementById(`edit-time-log-form-${logId}`);
    if (el) el.style.display = 'none';
}

export async function saveEditTimeLog(logId) {
    const task = STATE.tasks.find(t => t.id === STATE.editingTaskId);
    if (!task) return;

    const h = parseInt(document.getElementById(`editLogH-${logId}`).value, 10) || 0;
    const m = parseInt(document.getElementById(`editLogM-${logId}`).value, 10) || 0;
    const s = parseInt(document.getElementById(`editLogS-${logId}`).value, 10) || 0;
    const seconds = h * 3600 + m * 60 + s;

    if (seconds > 86400) { alert('La duración máxima por día es 24 horas.'); return; }

    const entry = task.timeLog.find(l => String(l.id) === String(logId));
    if (!entry) return;

    if (String(logId).startsWith('temp-')) {
        alert('El registro aún se está guardando. Intenta de nuevo en unos segundos.');
        return;
    }

    if (seconds === 0) return deleteTimeLogPrompt(logId);

    const prevSeconds = entry.seconds;
    const diff = seconds - prevSeconds;
    entry.seconds = seconds;
    task.timeSpent = Math.max(0, (task.timeSpent ?? 0) + diff);
    cancelEditTimeLog(logId);
    renderTiempoTab(task);
    renderResumenTab(task);
    renderBoard();

    try {
        const res = await updateTimeLog(logId, seconds);
        const updated = res?.task ?? res?.activity;
        if (updated) syncTaskFromBackend(task, updated);
        emitTimeLogChanged({ taskId: task.id, type: 'update' });
    } catch (e) {
        console.error('[saveEditTimeLog]', e);
        entry.seconds = prevSeconds;
        task.timeSpent = Math.max(0, (task.timeSpent ?? 0) - diff);
        renderTiempoTab(task);
        renderResumenTab(task);
        renderBoard();
        alert('No se pudo actualizar el registro. Se reintentará automáticamente.');
    }
}

export async function deleteTimeLogPrompt(logId) {
    const task = STATE.tasks.find(t => t.id === STATE.editingTaskId);
    if (!task) return;

    const entryIndex = task.timeLog.findIndex(l => String(l.id) === String(logId));
    if (entryIndex === -1) return;
    const entry = task.timeLog[entryIndex];

    if (!confirm(`¿Eliminar el registro del ${formatLogDate(entry.date)} (${formatTimeCompact(entry.seconds)})?`)) return;

    if (String(logId).startsWith('temp-')) {
        task.timeLog.splice(entryIndex, 1);
        task.timeSpent = Math.max(0, (task.timeSpent ?? 0) - entry.seconds);
        renderTiempoTab(task);
        renderResumenTab(task);
        renderBoard();
        return;
    }

    task.timeLog.splice(entryIndex, 1);
    task.timeSpent = Math.max(0, (task.timeSpent ?? 0) - entry.seconds);
    renderTiempoTab(task);
    renderResumenTab(task);
    renderBoard();

    try {
        const res = await deleteTimeLog(logId);
        const updated = res?.task ?? res?.activity;
        if (updated) syncTaskFromBackend(task, updated);
        emitTimeLogChanged({ taskId: task.id, type: 'delete' });
    } catch (e) {
        console.error('[deleteTimeLogPrompt]', e);
        task.timeLog.splice(entryIndex, 0, entry);
        task.timeSpent = (task.timeSpent ?? 0) + entry.seconds;
        renderTiempoTab(task);
        renderResumenTab(task);
        renderBoard();
        alert('No se pudo eliminar el registro. Se reintentará automáticamente.');
    }
}

function syncTaskFromBackend(task, updated) {
    if (!updated) return;
    // Remapear timeLog a la forma {id, date, seconds}.
    const normalizedLog = Array.isArray(updated.timeLog)
        ? updated.timeLog.map(l => ({
            id: l.id,
            date: l.date ?? l.logDate,
            seconds: l.seconds,
        }))
        : task.timeLog;
    Object.assign(task, updated, { timeLog: normalizedLog });
    renderTiempoTab(task);
    renderResumenTab(task);
    renderBoard();
}

// ── Subtasks (tab Edición) ───────────────────────────────────────────────────

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

// ── Submit (crear o editar tarea/actividad) ──────────────────────────────────

export async function submitNewTask() {
    const name = document.getElementById('inputTaskName').value.trim();
    if (!name) {
        alert('Name is required.');
        return;
    }

    const subtasks = Array.from(document.querySelectorAll('.subtask-input'))
        .map(input => ({
            raw: input.value.trim(),
            prevId: input.dataset.subtaskId || null,
        }))
        .filter(({ raw }) => raw)
        .map(({ raw, prevId }) => ({
            id:        prevId || generateId('sub'),
            text:      raw,
            completed: false,
            timeSpent: 0,
        }));

    const isEditing = !!STATE.editingTaskId;

    if (isEditing) {
        const taskId = STATE.editingTaskId;
        const existingTask = STATE.tasks.find(t => t.id === taskId);

        const prevById = new Map((existingTask?.subtasks ?? []).map(s => [s.id, s]));
        const mergedSubtasks = subtasks.map(s => {
            const prev = prevById.get(s.id);
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

        const submitBtn = document.querySelector('#modalNewTaskFooter .btn-primary');
        if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-check"></i> Create';

        STATE.editingTaskId = null;
        return;
    }

    // Validate retro accordion before submit
    const retroErr = validateRetro();
    if (retroErr) { alert(retroErr); return; }

    const retro = getRetroValues();
    const retroFields = retro.isActive ? {
        isRetroactive: true,
        completedAt:   retro.completedAt,
        progress:      100,
        timeLogs:      retro.timeLogs,
    } : {};

    const payload = {
        title:        name,
        description:  document.getElementById('inputDescription').value.trim(),
        column:       retro.isActive
            ? 'completed'
            : (STATE.currentTaskType === 'activity' ? 'activities' : 'actively-working'),
        type:         STATE.currentTaskType,
        priority:     document.getElementById('inputPriority').value,
        startDate:    document.getElementById('inputStartDate').value,
        deadline:     document.getElementById('inputDeadline').value || null,
        activityType: STATE.currentTaskType === 'activity'
            ? document.getElementById('inputActivityType').value
            : null,
        subtasks,
        ...retroFields,
    };

    console.log('PAYLOAD ENVIADO:', JSON.stringify(payload, null, 2));

    try {
        await createTask(payload);
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
