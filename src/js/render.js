/** Render del tablero kanban y tarjetas de tarea. */

import { STATE }      from './state.js';
import { updateKPIs } from './kpi.js';
import { formatTime, formatDate, isOverdue, getActivityTypeLabel, formatTimeCompact, formatLogDate } from './utils.js';

export function renderBoard() {
    const columns = {
        'actively-working': document.getElementById('columnActivelyWorking'),
        'working-now':      document.getElementById('columnWorkingNow'),
        'activities':       document.getElementById('columnActivities')
    };

    Object.values(columns).forEach(col => (col.innerHTML = ''));
    const counts = { 'actively-working': 0, 'working-now': 0, 'activities': 0 };

    STATE.tasks.forEach(task => {
        const col = columns[task.column];
        if (!col) return;
        col.appendChild(createTaskCard(task));
        counts[task.column]++;
    });

    document.getElementById('countActivelyWorking').textContent = counts['actively-working'];
    document.getElementById('countWorkingNow').textContent      = counts['working-now'];
    document.getElementById('countActivities').textContent      = counts['activities'];

    Object.entries(columns).forEach(([key, col]) => {
        if (counts[key] === 0) {
            col.innerHTML = `
                <div class="column-empty">
                    <i class="fas fa-inbox"></i>
                    <p>Drag tasks here</p>
                </div>`;
        }
    });

    updateKPIs();
}

export function createTaskCard(task) {
    const type          = task.type;
    const isActiveTimer = STATE.timers[type]?.taskId === task.id;
    const timer         = STATE.timers[type];

    const card = document.createElement('div');
    card.className = `task-card${isActiveTimer ? ' active-timer' : ''}`;
    card.draggable = true;
    card.dataset.taskId = task.id;

    const completedCount  = task.subtasks.filter(s => s.completed).length;
    const totalCount      = task.subtasks.length;
    const progressPercent = task.progress
        || (totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0);
    const isComplete   = progressPercent === 100;
    const overdueClass = isOverdue(task.deadline) && !isComplete ? 'overdue' : '';
    const completeClass = isComplete ? 'complete' : '';

    const showTimer = task.column === 'working-now' || task.column === 'activities';
    const showSubtaskSelector = showTimer && task.type !== 'activity';

    const activeSubtaskId = isActiveTimer ? timer.subtaskId : null;
    const activeSubtask = activeSubtaskId && activeSubtaskId !== 'none'
        ? task.subtasks.find(s => s.id === activeSubtaskId)
        : null;
    const subtaskOptions = [
        `<option value="none">-- No specific subtask --</option>`,
        ...task.subtasks
            .filter(s => !s.completed)
            .map(s => `<option value="${s.id}">${s.text}</option>`)
    ].join('');

    const timerSeconds = isActiveTimer
        ? timer.accumulated + Math.floor((Date.now() - timer.startTime) / 1000)
        : task.timeSpent;

    card.innerHTML = `
        <div class="task-priority ${task.priority}"></div>
        <div class="task-header">
            <span class="task-title">${task.title}</span>
            <div style="display:flex;gap:0.25rem;align-items:center;">
                <button class="task-menu-btn" onclick="openEditTaskModal('${task.id}')" title="Edit task">
                    <i class="fas fa-pencil-alt"></i>
                </button>
                <button class="task-menu-btn" onclick="confirmDeleteTask('${task.id}')" title="Delete task">
                    <i class="fas fa-trash"></i>
                </button>
                <button class="task-menu-btn" onclick="openTaskDetail('${task.id}')" title="View detail">
                    <i class="fas fa-expand"></i>
                </button>
            </div>
        </div>
        <div class="task-meta">
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
                    : `<select id="subtask-select-${task.id}" onchange="setSubtaskSelection('${task.id}', this.value)">${subtaskOptions}</select>`
                }
            </div>` : ''}
            <div class="task-timer">
                <span class="timer-display ${isActiveTimer ? 'running' : ''}" id="timer-${task.id}">
                    ${formatTime(timerSeconds)}
                </span>
                <div class="timer-controls">
                    ${isActiveTimer ? `
                        <button class="timer-btn pause" onclick="pauseTimer('${task.id}')" title="Pause">
                            <i class="fas fa-pause"></i>
                        </button>
                        <button class="timer-btn stop" onclick="stopTimer('${task.id}')" title="Finish">
                            <i class="fas fa-check"></i>
                        </button>` : `
                        <button class="timer-btn start" onclick="startTimer('${task.id}')" title="Start">
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
