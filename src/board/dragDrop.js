/** Drag & drop en el kanban; reglas: una tarea en "Working Now", actividades solo en columna Activities. */

import { STATE }        from '../core/state.js';
import { updateColumn } from '../api/api.js';
import { renderBoard }  from './render.js';

let draggedTaskId = null;

export function setupDragAndDrop() {
    const board = document.getElementById('kanbanBoard');

    board.addEventListener('dragstart', e => {
        const card = e.target.closest('.task-card');
        if (!card) return;
        draggedTaskId = card.dataset.taskId;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
    });

    board.addEventListener('dragend', e => {
        const card = e.target.closest('.task-card');
        if (card) card.classList.remove('dragging');
        draggedTaskId = null;
    });

    board.addEventListener('dragover', e => {
        const col = e.target.closest('.column-body');
        if (!col) return;
        e.preventDefault();
        col.classList.add('drag-over');
    });

    board.addEventListener('dragleave', e => {
        const col = e.target.closest('.column-body');
        if (col && !col.contains(e.relatedTarget)) {
            col.classList.remove('drag-over');
        }
    });

    board.addEventListener('drop', async e => {
        const col = e.target.closest('.column-body');
        if (!col) return;

        e.preventDefault();
        col.classList.remove('drag-over');

        if (!draggedTaskId) return;

        const targetColumn = col.closest('.kanban-column').dataset.column;
        const task = STATE.tasks.find(t => t.id === draggedTaskId);
        if (!task) return;

        if (!_isValidMove(task, targetColumn)) return;

        await updateColumn(draggedTaskId, targetColumn);
        renderBoard();
    });
}

function _isValidMove(task, targetColumn) {
    if (targetColumn === 'working-now') {
        const occupied = STATE.tasks.filter(t => t.column === 'working-now');
        if (occupied.length > 0 && occupied[0].id !== task.id) {
            alert('You can only have one task in "Working Right Now". Move the current one first.');
            return false;
        }
    }

    if (task.type === 'activity' && targetColumn !== 'activities') {
        alert('Activities can only be placed in the "Activities" column.');
        return false;
    }

    if (task.type === 'project' && targetColumn === 'activities') {
        alert('Projects cannot be moved to the "Activities" column.');
        return false;
    }

    return true;
}
