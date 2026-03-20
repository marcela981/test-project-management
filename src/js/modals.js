/** Modales: nueva tarea/actividad, importar Deck, detalle de tarea. */

import { STATE }                              from './state.js';
import { createTask, fetchTasks, fetchDeckBoards, fetchDeckCards } from './api.js';
import { save }                               from './storage.js';
import { renderBoard }                        from './render.js';
import { formatTime, formatDate, isOverdue, generateId } from './utils.js';
import { CONFIG }                             from './config.js';

let _deckCards = [];

export function closeModal(modalId) {
    document.getElementById(modalId)?.classList.remove('active');
}

function _openModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

export function openNewTaskModal(type) {
    STATE.currentTaskType = type;

    document.getElementById('modalNewTaskTitle').textContent   = type === 'activity' ? 'New Activity' : 'New Task';
    document.getElementById('activityTypeGroup').style.display = type === 'activity' ? 'block' : 'none';
    document.getElementById('subtasksGroup').style.display     = type === 'activity' ? 'none'  : 'block';

    document.getElementById('inputTaskName').value    = '';
    document.getElementById('inputStartDate').value   = new Date().toISOString().split('T')[0];
    document.getElementById('inputDeadline').value    = '';
    document.getElementById('inputPriority').value    = 'medium';
    document.getElementById('inputDescription').value = '';
    document.getElementById('subtasksContainer').innerHTML = '';

    _openModal('modalNewTask');
}

export function addSubtaskInput() {
    const container = document.getElementById('subtasksContainer');
    const index     = container.children.length;
    const div       = document.createElement('div');

    div.style.cssText = 'display: flex; gap: 0.5rem; margin-bottom: 0.5rem;';
    div.innerHTML = `
        <input type="text" class="form-input subtask-input" placeholder="Subtask ${index + 1}...">
        <button type="button" class="btn btn-secondary btn-sm" onclick="this.parentElement.remove()">
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

    // POST exitoso: recargar lista desde el servidor, actualizar vista y cerrar modal.
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

// ---------------------------------------------------------------------------
// Modal: Importar desde Nextcloud Deck
// ---------------------------------------------------------------------------

/**
 * Abre el modal de importación y carga la lista de boards del usuario.
 * El usuario primero elige un board; luego se cargan sus tarjetas.
 */
export async function openImportDeckModal() {
    STATE.selectedDeckCards.clear();
    _deckCards = [];

    const content = document.getElementById('deckModalContent');
    content.innerHTML = _loadingHtml('Loading your boards...');
    _openModal('modalImportDeck');

    try {
        const boards = await fetchDeckBoards();

        if (boards.length === 0) {
            content.innerHTML = `
                <p class="text-center text-muted">
                    No boards found in your Nextcloud Deck account.
                </p>`;
            return;
        }

        content.innerHTML = `
            <div class="form-group mb-2">
                <label class="form-label" for="deckBoardSelect">
                    <i class="fas fa-columns"></i> Select a board
                </label>
                <select id="deckBoardSelect" class="form-select"
                        onchange="selectDeckBoard(this.value)">
                    <option value="">-- Choose a board --</option>
                    ${boards.map(b => `
                        <option value="${b.id}">${_boardTitle(b)}</option>
                    `).join('')}
                </select>
            </div>
            <div id="deckCardList"></div>`;

    } catch (err) {
        content.innerHTML = `<p class="text-center text-danger">
            <i class="fas fa-exclamation-circle"></i> ${err.message}
        </p>`;
    }
}

export async function selectDeckBoard(boardId) {
    STATE.selectedDeckCards.clear();
    _deckCards = [];

    const cardList = document.getElementById('deckCardList');
    if (!boardId) {
        cardList.innerHTML = '';
        return;
    }

    cardList.innerHTML = _loadingHtml('Loading cards...');

    try {
        _deckCards = await fetchDeckCards(boardId);

        if (_deckCards.length === 0) {
            cardList.innerHTML = `
                <p class="text-center text-muted">
                    This board has no cards yet.
                </p>`;
            return;
        }

        const importedIds = new Set(
            STATE.tasks.filter(t => t.deck_card_id).map(t => String(t.deck_card_id))
        );

        cardList.innerHTML = `
            <div class="form-label mb-1" style="margin-top:.75rem;">
                <i class="fas fa-credit-card"></i>
                Cards (${_deckCards.length}) — click to select
            </div>
            <div class="deck-list">
                ${_deckCards.map(card => {
                    const alreadyImported = importedIds.has(String(card.id));
                    return `
                    <div class="deck-item${alreadyImported ? ' already-imported' : ''}"
                         data-deck-id="${card.id}"
                         ${alreadyImported ? '' : `onclick="toggleDeckSelection('${card.id}')"`}>
                        <div class="deck-item-checkbox">
                            ${alreadyImported
                                ? '<i class="fas fa-check-double" title="Already imported"></i>'
                                : '<i class="fas fa-check" style="display:none;"></i>'}
                        </div>
                        <div class="deck-item-content">
                            <div class="deck-item-title">${card.title}</div>
                            <div class="deck-item-meta">
                                ${alreadyImported
                                    ? '<i class="fas fa-ban"></i> Already imported'
                                    : card.duedate
                                        ? `<i class="fas fa-calendar"></i> ${formatDate(card.duedate.split('T')[0])}`
                                        : 'No deadline'}
                            </div>
                        </div>
                    </div>`;
                }).join('')}
            </div>`;

    } catch (err) {
        cardList.innerHTML = `<p class="text-center text-danger">
            <i class="fas fa-exclamation-circle"></i> ${err.message}
        </p>`;
    }
}

export function toggleDeckSelection(deckId) {
    const item = document.querySelector(`[data-deck-id="${deckId}"]`);
    if (!item) return;

    if (STATE.selectedDeckCards.has(deckId)) {
        STATE.selectedDeckCards.delete(deckId);
        item.classList.remove('selected');
        item.querySelector('.fa-check').style.display = 'none';
    } else {
        STATE.selectedDeckCards.add(deckId);
        item.classList.add('selected');
        item.querySelector('.fa-check').style.display = 'block';
    }
}

export async function importSelectedDeckCards() {
    if (STATE.selectedDeckCards.size === 0) {
        alert('Please select at least one card to import.');
        return;
    }

    const btn = document.getElementById('btnImportSelected');
    if (btn) btn.disabled = true;

    const importedIds = new Set(
        STATE.tasks.filter(t => t.deck_card_id).map(t => String(t.deck_card_id))
    );

    let count = 0;
    for (const deckId of STATE.selectedDeckCards) {
        if (importedIds.has(String(deckId))) continue; // idempotencia: saltar duplicados

        const card = _deckCards.find(c => String(c.id) === String(deckId));
        if (!card) continue;

        try {
            await createTask({
                deck_card_id: card.id,
                title:        card.title,
                description:  card.description ?? '',
                column:       'actively-working',
                type:         'project',
                priority:     'medium',
                startDate:    new Date().toISOString().split('T')[0],
                deadline:     card.duedate ? card.duedate.split('T')[0] : null,
                subtasks:     [],
            });
            count++;
        } catch (err) {
            console.error(`[importSelectedDeckCards] Error al importar card ${deckId}:`, err);
        }
    }

    if (count === 0) {
        if (btn) btn.disabled = false;
        return;
    }

    // Al menos un POST exitoso: recargar lista desde el servidor, actualizar vista y cerrar modal.
    if (CONFIG.BACKEND_URL) {
        try {
            const tareas = await fetchTasks();
            if (Array.isArray(tareas)) STATE.tasks = tareas;
        } catch (err) {
            console.error('[importSelectedDeckCards] Error al recargar tareas:', err);
        }
    }

    renderBoard();
    closeModal('modalImportDeck');
    alert(`${count} card(s) imported successfully!`);
    if (btn) btn.disabled = false;
}

export function openTaskDetail(taskId) {
    const task = STATE.tasks.find(t => t.id === taskId);
    if (!task) return;

    const isComplete = task.progress === 100;

    document.getElementById('modalDetailTitle').textContent = task.title;

    document.getElementById('modalDetailBody').innerHTML = `
        <div class="mb-2">
            <p class="text-muted">${task.description || 'No description.'}</p>
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
            <span class="form-label">Time invested</span>
            <p style="font-size:1.5rem; font-weight:600; color:var(--color-primary);">
                ${formatTime(task.timeSpent)}
            </p>
        </div>
        ${task.subtasks.length > 0 ? `
            <div class="mb-2">
                <span class="form-label">
                    Subtasks (${task.subtasks.filter(s => s.completed).length}/${task.subtasks.length})
                </span>
                <div class="subtasks-list mt-1">
                    ${task.subtasks.map(sub => `
                        <div class="subtask-item ${sub.completed ? 'completed' : ''}"
                             onclick="toggleSubtask('${task.id}', '${sub.id}')">
                            <div class="subtask-checkbox">
                                ${sub.completed ? '<i class="fas fa-check"></i>' : ''}
                            </div>
                            <span class="subtask-text">${sub.text}</span>
                            <span class="subtask-time">${formatTime(sub.timeSpent)}</span>
                        </div>`).join('')}
                </div>
            </div>` : ''}
        ${task.observations.length > 0 ? `
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
                                <p style="margin-top:.25rem;">${text}</p>
                            </div>`;
                    }).join('')}
                </div>
            </div>` : ''}`;

    document.getElementById('modalDetailFooter').innerHTML = `
        <button class="btn btn-secondary" onclick="closeModal('modalTaskDetail')">Close</button>`;

    _openModal('modalTaskDetail');
}

export function toggleSubtask(taskId, subtaskId) {
    const task    = STATE.tasks.find(t => t.id === taskId);
    const subtask = task?.subtasks.find(s => s.id === subtaskId);
    if (!subtask) return;

    subtask.completed = !subtask.completed;
    task.progress = Math.round(
        (task.subtasks.filter(s => s.completed).length / task.subtasks.length) * 100
    );

    save();
    openTaskDetail(taskId);
    renderBoard();
}

function _loadingHtml(msg) {
    return `<p class="text-center text-muted">
        <i class="fas fa-spinner fa-spin"></i> ${msg}
    </p>`;
}

function _boardTitle(board) {
    return board.title || `Board ${board.id}`;
}
