/** Render del tablero kanban y tarjetas de tarea. */

import { STATE }      from '../core/state.js';
import { updateKPIs } from '../kpi/kpi.js';
import { formatTime, formatDate, isOverdue, getActivityTypeLabel, formatTimeCompact, formatLogDate, formatRelativeTime, formatTimeOfDay } from '../shared/utils.js';

// Columnas que separan tareas completadas en acordeón
const ACCORDION_COLUMNS = ['actively-working', 'activities'];

// Estado local del acordeón (no persiste)
const _accordionOpen = { 'actively-working': false, 'activities': false };

function _isCompletedTask(task) {
    if (task.type === 'activity') return task.progress === 100;
    return task.column === 'completed';
}

export function renderBoard() {
    const columns = {
        'actively-working': document.getElementById('columnActivelyWorking'),
        'working-now':      document.getElementById('columnWorkingNow'),
        'activities':       document.getElementById('columnActivities')
    };

    Object.values(columns).forEach(col => (col.innerHTML = ''));
    const counts      = { 'actively-working': 0, 'working-now': 0, 'activities': 0 };
    const completedBy = { 'actively-working': [], 'activities': [] };

    STATE.tasks.forEach(task => {
        const displayColumn = counts.hasOwnProperty(task.column) ? task.column : 'actively-working';
        const col = columns[displayColumn];
        if (!col) return;

        if (ACCORDION_COLUMNS.includes(displayColumn) && _isCompletedTask(task)) {
            completedBy[displayColumn].push(task);
        } else {
            col.appendChild(createTaskCard(task));
            counts[displayColumn]++;
        }
    });

    // Acordeones al final de cada columna que los admite
    ACCORDION_COLUMNS.forEach(colKey => {
        const col = columns[colKey];
        if (completedBy[colKey].length > 0) {
            col.appendChild(_createCompletedAccordion(colKey, completedBy[colKey]));
        }
    });

    document.getElementById('countActivelyWorking').textContent = counts['actively-working'];
    document.getElementById('countWorkingNow').textContent      = counts['working-now'];
    document.getElementById('countActivities').textContent      = counts['activities'];

    Object.entries(columns).forEach(([key, col]) => {
        const total = counts[key] + (completedBy[key]?.length ?? 0);
        if (total === 0) {
            col.innerHTML = `
                <div class="column-empty">
                    <i class="fas fa-inbox"></i>
                    <p>Drag tasks here</p>
                </div>`;
        }
    });

    updateKPIs();
}

export function toggleCompletedAccordion(colKey) {
    _accordionOpen[colKey] = !_accordionOpen[colKey];
    const el = document.querySelector(`.completed-accordion[data-col-key="${colKey}"]`);
    if (el) el.classList.toggle('open', _accordionOpen[colKey]);
}

function _createCompletedAccordion(colKey, tasks) {
    const isOpen  = _accordionOpen[colKey];
    const wrapper = document.createElement('div');
    wrapper.className = `completed-accordion${isOpen ? ' open' : ''}`;
    wrapper.dataset.colKey = colKey;

    const header = document.createElement('button');
    header.className = 'completed-accordion-header';
    header.dataset.action = 'toggle-completed-accordion';
    header.dataset.colKey  = colKey;
    header.innerHTML = `
        <span><i class="fas fa-check-circle"></i> Completadas (${tasks.length})</span>
        <i class="fas fa-chevron-down completed-accordion-chevron"></i>`;

    const body = document.createElement('div');
    body.className = 'completed-accordion-body';

    tasks.forEach(task => {
        const card = createTaskCard(task);
        card.draggable = false;
        card.classList.add('completed-in-accordion');
        body.appendChild(card);
    });

    wrapper.appendChild(header);
    wrapper.appendChild(body);
    return wrapper;
}

export function createTaskCard(task) {
    const type          = task.type;
    const isActiveTimer = STATE.timers[type]?.taskId === task.id;
    const timer         = STATE.timers[type];
    const completedCount  = task.subtasks.filter(s => s.completed).length;
    const totalCount      = task.subtasks.length;
    const progressPercent = task.progress
        || (totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0);
    const isComplete         = progressPercent === 100;
    const showCompletedBadge = task.column === 'completed' ||
        (task.type === 'activity' && progressPercent === 100);
    const overdueClass  = isOverdue(task.deadline) && !isComplete ? 'overdue' : '';
    const completeClass = isComplete ? 'complete' : '';

    const card = document.createElement('div');
    card.className = ['task-card', overdueClass, completeClass, isActiveTimer ? 'active-timer' : '']
        .filter(Boolean)
        .join(' ');
    card.draggable = !isComplete;
    card.dataset.taskId = task.id;

    const showTimer          = (task.column === 'working-now' || task.column === 'activities') && !isComplete;
    const showSubtaskSelector = showTimer && task.type !== 'activity';

    const activeSubtaskId = isActiveTimer ? timer.subtaskId : null;
    const activeSubtask   = activeSubtaskId && activeSubtaskId !== 'none'
        ? task.subtasks.find(s => s.id === activeSubtaskId)
        : null;

    const savedSubId = STATE.selectedSubtasks[task.id];
    const subtaskOptions = [
        `<option value="none"${!savedSubId || savedSubId === 'none' ? ' selected' : ''}>-- No specific subtask --</option>`,
        ...task.subtasks
            .filter(s => !s.completed)
            .map(s => `<option value="${s.id}"${savedSubId === s.id ? ' selected' : ''}>${s.text}</option>`)
    ].join('');

    const timerSeconds = isActiveTimer
        ? timer.accumulated + Math.floor((Date.now() - timer.startTime) / 1000)
        : task.timeSpent;

    card.innerHTML = `
        <div class="task-priority ${task.priority}"></div>
        ${showCompletedBadge ? `
        <div class="task-completed-badge">
            <i class="fas fa-check-circle"></i> Completada
        </div>` : ''}
        <div class="task-header">
            <span class="task-title">${task.title}</span>
            <div class="task-menu-wrapper">
                <button class="task-menu-btn task-menu-toggle" data-action="toggle-task-menu" data-task-id="${task.id}" title="Opciones">
                    <i class="fas fa-ellipsis-v"></i>
                </button>
                <div class="task-dropdown" id="task-dropdown-${task.id}">
                    <button class="task-dropdown-item" data-action="edit-task" data-task-id="${task.id}">
                        <i class="fas fa-pencil-alt"></i> Editar
                    </button>
                    ${(task.column === 'completed' || (task.type === 'activity' && task.progress === 100)) ? `
                    <button class="task-dropdown-item" data-action="reopen-task" data-task-id="${task.id}">
                        <i class="fas fa-undo"></i> ¿No has terminado? Reabrir
                    </button>` : ''}
                    <button class="task-dropdown-item danger" data-action="delete-task" data-task-id="${task.id}">
                        <i class="fas fa-trash"></i> Eliminar
                    </button>
                </div>
            </div>
        </div>
        <div class="task-meta">
            ${(task.createdAt || task.startDate) ? (() => {
                const src = task.createdAt || task.startDate;
                const timeStr = task.createdAt ? ` · ${formatTimeOfDay(task.createdAt)}` : '';
                return `<span class="task-meta-item" title="Creada: ${new Date(task.createdAt || task.startDate + 'T00:00:00').toLocaleString('es-ES')}">
                    <i class="fas fa-history"></i>${formatRelativeTime(src)}${timeStr}
                </span>`;
            })() : ''}
            ${task.deadline ? `
                <span class="task-meta-item ${overdueClass} ${completeClass}">
                    <i class="fas fa-calendar"></i>${formatDate(task.deadline)}
                </span>` : ''}
            <span class="task-meta-item">
                <i class="fas fa-clock"></i>${formatTime(task.timeSpent)}
            </span>
            ${totalCount > 0 ? `
                <span class="task-meta-item ${completeClass}">
                    <i class="fas fa-check-square"></i>${completedCount}/${totalCount}
                </span>` : ''}
        </div>
        ${totalCount > 0 || task.progress > 0 ? `
            <div class="task-progress">
                <div class="progress-header">
                    <span class="progress-label">Progress</span>
                    <span class="progress-value">${progressPercent}%</span>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill ${isComplete ? 'complete' : ''}"
                         style="width: ${progressPercent}%"></div>
                </div>
            </div>` : ''}
        ${showTimer ? `
            ${showSubtaskSelector ? `
            <div class="subtask-selector">
                <label>Working on:</label>
                ${isActiveTimer
                    ? `<div class="active-subtask-name">${activeSubtask ? activeSubtask.text : '<span class="no-subtask">— General task —</span>'}</div>`
                    : `<select data-action="select-subtask" data-task-id="${task.id}">${subtaskOptions}</select>`
                }
            </div>` : ''}
            <div class="task-timer">
                <span class="timer-display ${isActiveTimer ? 'running' : ''}" id="timer-${task.id}">
                    ${formatTime(timerSeconds)}
                </span>
                <div class="timer-controls">
                    ${isActiveTimer ? `
                        <button class="timer-btn pause" data-action="pause-timer" data-task-id="${task.id}" title="Pause">
                            <i class="fas fa-pause"></i>
                        </button>
                        <button class="timer-btn stop" data-action="stop-timer" data-task-id="${task.id}" title="Finish">
                            <i class="fas fa-check"></i>
                        </button>` : `
                        <button class="timer-btn start" data-action="start-timer" data-task-id="${task.id}" title="Start">
                            <i class="fas fa-play"></i>
                        </button>`}
                </div>
            </div>` : ''}
        ${task.type === 'activity' ? `
            <div class="task-tags">
                <span class="task-tag">
                    <i class="fas fa-tag"></i> ${getActivityTypeLabel(task.activityType)}
                </span>
            </div>` : ''}
        ${task.timeLog && task.timeLog.length > 0 ? `
            <div class="time-log">
                ${[...task.timeLog]
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .slice(0, 5)
                    .map(entry => `
                        <div class="time-log-entry">
                            <span class="time-log-date">${formatLogDate(entry.date)}</span>
                            <span class="time-log-duration">${formatTimeCompact(entry.seconds)}</span>
                        </div>`).join('')}
            </div>` : ''}
    `;

    return card;
}
