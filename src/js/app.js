/** Punto de entrada: OAuth, carga de datos, event delegation central. */

import { STATE }            from './state.js';
import { load }             from './storage.js';
import { fetchTasks }       from './api.js';
import { renderBoard }      from './render.js';
import { setupDragAndDrop } from './dragDrop.js';
import { initAuth }         from './auth.js';
import { CONFIG }           from './config.js';

import {
    openNewTaskModal, openEditTaskModal, openImportDeckModal,
    openTaskDetail, closeModal, addSubtaskInput, submitNewTask,
    toggleSubtask, toggleDeckSelection, importSelectedDeckCards,
    selectDeckBoard, confirmDeleteTask, openTimeEdit, cancelTimeEdit, saveTimeEdit,
    confirmCompletion,
} from './modals.js';

import {
    startTimer, pauseTimer, stopTimer, cancelPause, confirmPause,
    closeTimerNotif, timerNotifNo, closeTimerAction, timerActionFinalize, timerActionStop,
    cancelCompletion,
} from './timer.js';

// ---------------------------------------------------------------------------
// Funciones locales (no necesitan ser globales)
// ---------------------------------------------------------------------------

function setSubtaskSelection(taskId, subtaskId) {
    STATE.selectedSubtasks[taskId] = subtaskId;
}

// ---------------------------------------------------------------------------
// Event delegation: un único listener maneja toda la UI
// ---------------------------------------------------------------------------

async function handleClick(e) {
    // Cierra dropdowns abiertos si el click es fuera del menú
    if (!e.target.closest('.task-menu-wrapper')) {
        document.querySelectorAll('.task-dropdown.open').forEach(d => d.classList.remove('open'));
    }

    const el = e.target.closest('[data-action]');
    if (!el) return;

    const { action, taskId, subtaskId, modalId, type, elapsed, deckId } = el.dataset;

    switch (action) {
        // Menú de tarjeta (dropdown)
        case 'toggle-task-menu': {
            const dropdown = document.getElementById(`task-dropdown-${taskId}`);
            const isOpen = dropdown?.classList.contains('open');
            document.querySelectorAll('.task-dropdown.open').forEach(d => d.classList.remove('open'));
            if (!isOpen) dropdown?.classList.add('open');
            break;
        }

        // Tareas
        case 'new-task':          openNewTaskModal(type); break;
        case 'edit-task':         openEditTaskModal(taskId); break;
        case 'delete-task':       await confirmDeleteTask(taskId); break;
        case 'task-detail':       openTaskDetail(taskId); break;
        case 'submit-task':       await submitNewTask(); break;
        case 'toggle-subtask':    toggleSubtask(taskId, subtaskId); break;

        // Formulario de nueva/editar tarea
        case 'add-subtask':       addSubtaskInput(); break;
        case 'remove-parent':     el.parentElement.remove(); break;

        // Tiempo
        case 'open-time-edit':    openTimeEdit(taskId); break;
        case 'save-time-edit':    await saveTimeEdit(taskId); break;
        case 'cancel-time-edit':  cancelTimeEdit(); break;

        // Timer
        case 'start-timer':       startTimer(taskId); break;
        case 'pause-timer':       pauseTimer(taskId); break;
        case 'stop-timer':        await stopTimer(taskId); break;
        case 'cancel-pause':       cancelPause(taskId); break;
        case 'confirm-pause':      await confirmPause(taskId, parseInt(elapsed, 10)); break;
        case 'confirm-completion': await confirmCompletion(taskId, parseInt(elapsed, 10), subtaskId); break;
        case 'cancel-completion':  cancelCompletion(taskId); break;

        // Notificaciones de timer
        case 'close-timer-notif': closeTimerNotif(); break;
        case 'timer-notif-no':    timerNotifNo(taskId, type); break;
        case 'close-timer-action': closeTimerAction(); break;
        case 'timer-finalize':    await timerActionFinalize(taskId, type); break;
        case 'timer-stop':        timerActionStop(taskId, type); break;

        // Deck
        case 'open-import-deck':  await openImportDeckModal(); break;
        case 'toggle-deck':       toggleDeckSelection(deckId); break;
        case 'import-deck-cards': await importSelectedDeckCards(); break;

        // Modales
        case 'close-modal':       closeModal(modalId); break;
    }
}

function handleChange(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const { action, taskId } = el.dataset;
    switch (action) {
        case 'select-subtask':    setSubtaskSelection(taskId, el.value); break;
        case 'select-deck-board': selectDeckBoard(el.value); break;
    }
}

// ---------------------------------------------------------------------------
// Inicialización
// ---------------------------------------------------------------------------

async function init() {
    const user = await initAuth();

    if (!user) {
        if (!CONFIG.NEXTCLOUD_OAUTH_CLIENT_ID) {
            document.getElementById('userAvatar').textContent = '?';
            document.getElementById('userName').textContent   = 'User';
        }
        if (CONFIG.NEXTCLOUD_OAUTH_CLIENT_ID) return;
    } else {
        document.getElementById('userAvatar').textContent = user.initials   || '?';
        document.getElementById('userName').textContent   = user.displayname || user.id || 'User';
    }

    load();

    if (CONFIG.BACKEND_URL) {
        try {
            const fetched = await fetchTasks();
            if (Array.isArray(fetched) && fetched.length > 0) STATE.tasks = fetched;
        } catch (err) {
            console.error('[init] Error al cargar tareas:', err);
        }
    }

    renderBoard();
    setupDragAndDrop();

    // Event delegation — un único listener para toda la app
    document.addEventListener('click',  handleClick);
    document.addEventListener('change', handleChange);

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal-overlay.active')
                .forEach(m => m.classList.remove('active'));
        }
    });

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', e => {
            if (e.target === overlay) overlay.classList.remove('active');
        });
    });
}

document.addEventListener('DOMContentLoaded', init);
