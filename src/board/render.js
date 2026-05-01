/** Render del tablero kanban y tarjetas de tarea. */

import { STATE }      from '../core/state.js';
import { updateKPIs } from '../kpi/kpi.js';
import { formatTime, formatDate, isOverdue, getActivityTypeLabel, formatTimeCompact, formatLogDate, formatRelativeTime, formatTimeOfDay } from '../shared/utils.js';
import {
    sortItems, getSort, setSort, resetSort, isDefaultSort,
    CRITERIA_ACTIVE, CRITERIA_COMPLETED,
} from './column-sort.js';

// Columnas que separan tareas completadas en acordeón
const ACCORDION_COLUMNS = ['actively-working', 'activities'];

// Estado local del acordeón (no persiste)
const _accordionOpen = { 'actively-working': false, 'activities': false };

function _isCompletedTask(task) {
    if (task.type === 'activity') return task.progress === 100;
    return task.column === 'completed';
}

// ── Sort menu ─────────────────────────────────────────────────────────────────

const _CRITERION_LABELS = {
    title:        { label: 'Nombre',    asc: 'A → Z',                desc: 'Z → A'                },
    created_at:   { label: 'Creación',  asc: 'Más antiguo primero',  desc: 'Más reciente primero'  },
    deadline:     { label: 'Deadline',  asc: 'Más próximo',          desc: 'Más lejano'            },
    completed_at: { label: 'Completado',asc: 'Más antiguo primero',  desc: 'Más reciente primero'  },
};

export function initBoardSortMenus() {
    _injectSortMenu('actively-working', CRITERIA_ACTIVE);
    _injectSortMenu('activities', CRITERIA_ACTIVE);
}

function _injectSortMenu(colKey, criteria) {
    const header = document.querySelector(`.kanban-column[data-column="${colKey}"] .column-header`);
    if (!header || header.querySelector('.sort-menu-wrapper')) return;

    const wrapper  = _buildSortWrapper(colKey, criteria);
    const countEl  = header.querySelector('.column-count');
    header.insertBefore(wrapper, countEl);
}

function _buildSortWrapper(colKey, criteria) {
    const wrapper = document.createElement('div');
    wrapper.className = 'sort-menu-wrapper';
    wrapper.dataset.colKey = colKey;

    const btn = document.createElement('button');
    btn.className = 'sort-menu-btn';
    btn.dataset.action = 'toggle-sort-menu';
    btn.dataset.colKey  = colKey;
    btn.title = 'Ordenar';
    btn.innerHTML = '<i class="fas fa-sort"></i><span class="sort-active-dot" aria-hidden="true"></span>';

    const dropdown = _buildSortDropdown(colKey, criteria);
    wrapper.appendChild(btn);
    wrapper.appendChild(dropdown);
    return wrapper;
}

function _buildSortDropdown(colKey, criteria) {
    const menu = document.createElement('div');
    menu.className = 'sort-menu-dropdown';
    menu.id = `sort-menu-${colKey}`;

    let prevGroup = null;
    criteria.forEach(c => {
        const info  = _CRITERION_LABELS[c];
        const group = document.createElement('div');
        group.className = 'sort-menu-group';

        if (prevGroup) {
            const sep = document.createElement('div');
            sep.className = 'sort-menu-group-sep';
            menu.appendChild(sep);
        }

        const groupLabel = document.createElement('div');
        groupLabel.className = 'sort-menu-group-label';
        groupLabel.textContent = info.label;
        group.appendChild(groupLabel);

        ['asc', 'desc'].forEach(dir => {
            const item = document.createElement('button');
            item.className = 'sort-menu-item';
            item.dataset.action    = 'set-column-sort';
            item.dataset.colKey    = colKey;
            item.dataset.criterion = c;
            item.dataset.direction = dir;
            item.innerHTML = `<i class="fas fa-check sort-item-check" aria-hidden="true"></i>${info[dir]}`;
            group.appendChild(item);
        });

        menu.appendChild(group);
        prevGroup = group;
    });

    const sep = document.createElement('div');
    sep.className = 'sort-menu-sep';
    menu.appendChild(sep);

    const resetBtn = document.createElement('button');
    resetBtn.className = 'sort-menu-item sort-menu-reset';
    resetBtn.dataset.action = 'reset-column-sort';
    resetBtn.dataset.colKey  = colKey;
    resetBtn.innerHTML = '<i class="fas fa-undo" aria-hidden="true"></i>Restablecer orden por defecto';
    menu.appendChild(resetBtn);

    return menu;
}

export function openSortMenu(colKey) {
    const dropdown = document.getElementById(`sort-menu-${colKey}`);
    const isOpen   = dropdown?.classList.contains('open');
    closeSortMenus();
    if (!isOpen) dropdown?.classList.add('open');
}

export function closeSortMenus() {
    document.querySelectorAll('.sort-menu-dropdown.open').forEach(el => el.classList.remove('open'));
}

export function applyColumnSort(colKey, criterion, direction) {
    setSort(colKey, { criterion, direction });
}

export function resetColumnSort(colKey) {
    resetSort(colKey);
}

function _syncSortButtonStates() {
    ['actively-working', 'activities'].forEach(colKey => {
        const sort = getSort(colKey);
        const isDef = isDefaultSort(colKey, sort);

        const dot = document.querySelector(`.sort-menu-wrapper[data-col-key="${colKey}"] .sort-active-dot`);
        if (dot) dot.classList.toggle('visible', !isDef);

        const menu = document.getElementById(`sort-menu-${colKey}`);
        if (!menu) return;

        menu.querySelectorAll('.sort-menu-item[data-criterion]').forEach(item => {
            const active = item.dataset.criterion === sort.criterion
                        && item.dataset.direction  === sort.direction;
            item.classList.toggle('sort-item-active', active);
        });

        const resetBtn = menu.querySelector('.sort-menu-reset');
        if (resetBtn) resetBtn.classList.toggle('sort-reset-active', !isDef);
    });
}

// ── Board render ──────────────────────────────────────────────────────────────

export function renderBoard() {
    const columns = {
        'actively-working': document.getElementById('columnActivelyWorking'),
        'working-now':      document.getElementById('columnWorkingNow'),
        'activities':       document.getElementById('columnActivities')
    };

    Object.values(columns).forEach(col => (col.innerHTML = ''));

    // Clasificar tareas por columna y estado
    const activeTasks    = { 'actively-working': [], 'working-now': [], 'activities': [] };
    const completedTasks = { 'actively-working': [], 'activities': [] };

    STATE.tasks.forEach(task => {
        const col = activeTasks.hasOwnProperty(task.column) ? task.column : 'actively-working';
        if (ACCORDION_COLUMNS.includes(col) && _isCompletedTask(task)) {
            completedTasks[col].push(task);
        } else {
            activeTasks[col].push(task);
        }
    });

    // Aplicar sort a cada sección
    const sorted = {
        'actively-working': sortItems(activeTasks['actively-working'], 'actively-working'),
        'working-now':      activeTasks['working-now'],
        'activities':       sortItems(activeTasks['activities'], 'activities'),
    };
    const sortedCompleted = {
        'actively-working': sortItems(completedTasks['actively-working'], 'actively-working-completed'),
        'activities':       sortItems(completedTasks['activities'], 'activities-completed'),
    };

    // Renderizar tareas activas
    const counts = { 'actively-working': 0, 'working-now': 0, 'activities': 0 };
    Object.entries(sorted).forEach(([colKey, tasks]) => {
        const col = columns[colKey];
        if (!col) return;
        tasks.forEach(task => {
            col.appendChild(createTaskCard(task));
            counts[colKey]++;
        });
    });

    // Acordeones al final de cada columna que los admite
    ACCORDION_COLUMNS.forEach(colKey => {
        const col   = columns[colKey];
        const tasks = sortedCompleted[colKey];
        if (tasks.length > 0) {
            col.appendChild(_createCompletedAccordion(colKey, tasks));
        }
    });

    document.getElementById('countActivelyWorking').textContent = counts['actively-working'];
    document.getElementById('countWorkingNow').textContent      = counts['working-now'];
    document.getElementById('countActivities').textContent      = counts['activities'];

    Object.entries(columns).forEach(([key, col]) => {
        const total = counts[key] + (completedTasks[key]?.length ?? 0);
        if (total === 0) {
            col.innerHTML = `
                <div class="column-empty">
                    <i class="fas fa-inbox"></i>
                    <p>Drag tasks here</p>
                </div>`;
        }
    });

    _syncSortButtonStates();
    updateKPIs();
}

export function toggleCompletedAccordion(colKey) {
    _accordionOpen[colKey] = !_accordionOpen[colKey];
    const el = document.querySelector(`.completed-accordion[data-col-key="${colKey}"]`);
    if (el) el.classList.toggle('open', _accordionOpen[colKey]);
}

function _createCompletedAccordion(colKey, tasks) {
    const isOpen       = _accordionOpen[colKey];
    const completedKey = colKey + '-completed';
    const sort         = getSort(completedKey);
    const isDef        = isDefaultSort(completedKey, sort);

    const wrapper = document.createElement('div');
    wrapper.className = `completed-accordion${isOpen ? ' open' : ''}`;
    wrapper.dataset.colKey = colKey;

    // Header: div container (no es button para poder anidar buttons)
    const header = document.createElement('div');
    header.className = 'completed-accordion-header';

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'completed-accordion-toggle';
    toggleBtn.dataset.action = 'toggle-completed-accordion';
    toggleBtn.dataset.colKey  = colKey;
    toggleBtn.innerHTML = `
        <span><i class="fas fa-check-circle"></i> Completadas (${tasks.length})</span>
        <i class="fas fa-chevron-down completed-accordion-chevron"></i>`;

    // Sort menu del acordeón
    const sortWrapper = document.createElement('div');
    sortWrapper.className = 'sort-menu-wrapper';
    sortWrapper.dataset.colKey = completedKey;

    const sortBtn = document.createElement('button');
    sortBtn.className = 'sort-menu-btn';
    sortBtn.dataset.action = 'toggle-sort-menu';
    sortBtn.dataset.colKey  = completedKey;
    sortBtn.title = 'Ordenar completadas';
    sortBtn.innerHTML = `<i class="fas fa-sort" aria-hidden="true"></i><span class="sort-active-dot${isDef ? '' : ' visible'}" aria-hidden="true"></span>`;

    const dropdown = _buildSortDropdown(completedKey, CRITERIA_COMPLETED);

    // Marcar ítem activo en el dropdown recién construido
    dropdown.querySelectorAll('.sort-menu-item[data-criterion]').forEach(item => {
        const active = item.dataset.criterion === sort.criterion
                    && item.dataset.direction  === sort.direction;
        item.classList.toggle('sort-item-active', active);
    });
    const resetBtn = dropdown.querySelector('.sort-menu-reset');
    if (resetBtn) resetBtn.classList.toggle('sort-reset-active', !isDef);

    sortWrapper.appendChild(sortBtn);
    sortWrapper.appendChild(dropdown);

    header.appendChild(toggleBtn);
    header.appendChild(sortWrapper);

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

function _priorityLabel(priority) {
    return { high: 'Alta', medium: 'Media', low: 'Baja' }[priority] ?? priority;
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
            <span class="priority-chip ${task.priority}">${_priorityLabel(task.priority)}</span>
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
