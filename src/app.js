/** Punto de entrada: OAuth, carga de datos, event delegation central. */

import { STATE }            from './core/state.js';
import { load }             from './core/storage.js';
import { fetchTasks, reopenTask, completeTask } from './api/api.js';
import { drainPendingTimeOps } from './api/timeLogs.js';
import { renderBoard, toggleCompletedAccordion } from './board/render.js';
import { setupDragAndDrop } from './board/dragDrop.js';
import { initAuth }         from './auth/auth.js';
import { CONFIG }           from './core/config.js';
import { closeModal, closeModalSafe, hasDirtyCheck, isDirty } from './shared/modal.js';
import { fetchTeams }       from './dashboard/dashApi.js';
import { renderMyMetrics }  from './dashboard/myMetrics.js';
import { renderTeamDashboard } from './dashboard/teamDashboard.js';
import { renderSkills, submitEndorse } from './skills/skills.js';
import { renderAdmin }      from './admin/admin.js';

import {
    openNewTaskModal, openEditTaskModal,
    addSubtaskInput, submitNewTask, confirmDeleteTask,
    switchTab, toggleSubtask, 
    openAddTimeLog, cancelAddTimeLog, saveNewTimeLog, 
    openEditTimeLog, cancelEditTimeLog, saveEditTimeLog, deleteTimeLogPrompt
} from './tasks/taskForm.js';

import {
    openImportDeckModal, selectDeckBoard,
    toggleDeckSelection, importSelectedDeckCards, filterDeckCards,
    toggleDeckFilterPanel, toggleDeckTag, selectAllDeckTags, clearAllDeckTags,
} from './deck/deckImport.js';

import { confirmCompletion } from './timer/completionModal.js';
import { renderCalendar, handleCalendarClick } from './calendar/calendar-router.js';
import { submitBlock, handleWeeklyModalEvent } from './weekly/weekly-modal.js';
import { initRetroAccordion } from './tasks/retroactiveAccordion.js';
import { openSettings, closeSettings, saveSettings } from './settings/settings.js';

import {
    startTimer, pauseTimer, stopTimer, cancelPause, confirmPause,
    closeTimerNotif, timerNotifNo, closeTimerAction, timerActionFinalize, timerActionStop,
    cancelCompletion, restoreTimers,
} from './timer/timer.js';
import { flushActiveTimers } from './timer/timerFlush.js';

// ---------------------------------------------------------------------------
// Navegación entre vistas
// ---------------------------------------------------------------------------

let _currentUser = null;

function navigateTo(view) {
    document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));

    document.getElementById(`view-${view}`)?.classList.add('active');
    document.querySelector(`.nav-tab[data-view="${view}"]`)?.classList.add('active');

    // Lazy render cada vez (datos frescos)
    const container = document.getElementById(`view-${view}`);
    if (!container) return;
    switch (view) {
        case 'my-metrics':
            renderMyMetrics(container, _currentUser);
            break;
        case 'dashboard':
            renderTeamDashboard(container, _currentUser);
            break;
        case 'skills':
            if (_currentUser) renderSkills(container, _currentUser);
            break;
        case 'admin':
            if (_currentUser) renderAdmin(container, _currentUser);
            break;
        case 'weekly':
            renderCalendar(container);
            break;
    }
}

function setupNav(user, isTechTeam) {
    if (user.role === 'leader' || user.role === 'admin') {
        document.querySelectorAll('.nav-leader').forEach(el => el.style.display = '');
    }
    if (isTechTeam) {
        document.querySelectorAll('.nav-tech').forEach(el => el.style.display = '');
    }

    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => navigateTo(tab.dataset.view));
    });
}

// ---------------------------------------------------------------------------
// Funciones locales
// ---------------------------------------------------------------------------

function setSubtaskSelection(taskId, subtaskId) {
    STATE.selectedSubtasks[taskId] = subtaskId;
}

// ---------------------------------------------------------------------------
// Event delegation: un único listener maneja toda la UI
// ---------------------------------------------------------------------------

async function handleClick(e) {
    if (!e.target.closest('.task-menu-wrapper')) {
        document.querySelectorAll('.task-dropdown.open').forEach(d => d.classList.remove('open'));
    }

    const el = e.target.closest('[data-action]');
    if (!el) return;

    const { action, taskId, subtaskId, modalId, type, elapsed, deckId } = el.dataset;

    switch (action) {
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
        case 'submit-task':       await submitNewTask(); break;
        case 'toggle-subtask':    toggleSubtask(taskId, subtaskId); break;

        // Formulario de nueva/editar tarea
        case 'add-subtask':       addSubtaskInput(); break;
        case 'remove-parent':     el.parentElement.remove(); break;

        case 'switch-tab':        switchTab(el.dataset.tab); break;

        // Tiempo
        case 'add-time-log':      openAddTimeLog(); break;
        case 'cancel-new-time-log': cancelAddTimeLog(); break;
        case 'save-new-time-log': saveNewTimeLog(); break;
        case 'edit-time-log':     openEditTimeLog(el.dataset.logId); break;
        case 'cancel-edit-time-log': cancelEditTimeLog(el.dataset.logId); break;
        case 'save-edit-time-log': saveEditTimeLog(el.dataset.logId, el.dataset.logDate); break;
        case 'delete-time-log':   deleteTimeLogPrompt(el.dataset.logId); break;

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
        case 'timer-notif-no':    await timerNotifNo(taskId, type); break;
        case 'close-timer-action': closeTimerAction(); break;
        case 'timer-finalize':    await timerActionFinalize(taskId, type); break;
        case 'timer-stop':        timerActionStop(taskId, type); break;

        // Reabrir tarea completada
        case 'reopen-task':       await reopenTask(taskId); renderBoard(); break;

        // Finalizar tarea desde Overview
        case 'finalize-task': {
            await completeTask(taskId);
            closeModal('modalNewTask');
            renderBoard();
            break;
        }

        // Acordeón de completadas
        case 'toggle-completed-accordion': toggleCompletedAccordion(el.dataset.colKey); break;

        // Deck
        case 'open-import-deck':          await openImportDeckModal(); break;
        case 'toggle-deck':               toggleDeckSelection(deckId); break;
        case 'import-deck-cards':         await importSelectedDeckCards(); break;
        case 'toggle-deck-filter-panel':  toggleDeckFilterPanel(); break;
        case 'toggle-deck-tag':           toggleDeckTag(el.dataset.tag); break;
        case 'toggle-deck-select-all':    selectAllDeckTags(); break;
        case 'toggle-deck-select-none':   clearAllDeckTags(); break;

        // Skills – endorse
        case 'submit-endorse':    await submitEndorse(); break;

        // Configuración
        case 'open-settings':     openSettings(); break;
        case 'close-settings':    closeSettings(); break;
        case 'save-settings':     saveSettings(); break;

        // Weekly tracker
        case 'weekly-submit-block': submitBlock(); break;

        // Modales
        case 'close-modal':       closeModalSafe(modalId); break;

        default:
            if (action?.startsWith('weekly-')) {
                if (!handleWeeklyModalEvent(action, el)) handleCalendarClick(action, el);
            } else if (action?.startsWith('calendar-') || action?.startsWith('day-') ||
                       action?.startsWith('month-') || action?.startsWith('quarter-') ||
                       action?.startsWith('semester-') || action?.startsWith('annual-')) {
                handleCalendarClick(action, el);
            }
            break;
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

function handleInput(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    if (el.dataset.action === 'filter-deck-cards') filterDeckCards(el.value);
}

// ---------------------------------------------------------------------------
// Inicialización
// ---------------------------------------------------------------------------

async function init() {
    const user = await initAuth();

    if (!user) {
        if (CONFIG.NEXTCLOUD_OAUTH_CLIENT_ID) return;
        document.getElementById('userAvatar').textContent = '?';
        document.getElementById('userName').textContent   = 'User';
    } else {
        document.getElementById('userAvatar').textContent = user.initials   || '?';
        document.getElementById('userName').textContent   = user.displayname || user.id || 'User';
        _currentUser = user;
    }

    load();

    let isTechTeam = false;
    const promises = [];

    if (CONFIG.BACKEND_URL) {
        promises.push(
            fetchTasks().then(fetched => {
                if (Array.isArray(fetched) && fetched.length > 0) STATE.tasks = fetched;
            }).catch(err => console.error('[init] Error al cargar tareas:', err))
        );
    }

    if (_currentUser?.teamId != null) {
        promises.push(
            fetchTeams().then(teams => {
                const myTeam = (teams ?? []).find(t => t.id === _currentUser.teamId);
                isTechTeam = myTeam?.isTechTeam ?? false;
            }).catch(() => {})
        );
    }

    await Promise.all(promises);
    
    initRetroAccordion();
    restoreTimers();
    renderBoard();
    setupDragAndDrop();

    if (_currentUser) {
        setupNav(_currentUser, isTechTeam);
        drainPendingTimeOps();
    }

    // Weekly tab is always available (no auth required)
    document.querySelectorAll('.nav-tab[data-view="weekly"]').forEach(tab => {
        tab.addEventListener('click', () => navigateTo('weekly'));
    });

    window.addEventListener('beforeunload', flushActiveTimers);

    document.addEventListener('click',  handleClick);
    document.addEventListener('change', handleChange);
    document.addEventListener('input',  handleInput);

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal-overlay.active').forEach(m => {
                // If dirty, ESC is disabled. If clean (or no dirty check), close normally.
                if (!isDirty(m.id)) closeModal(m.id);
            });
        }
    });

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', e => {
            // Backdrop click is fully disabled for creation/edit modals (those with a
            // registered dirty check). Other modals (timer, completion) still close.
            if (e.target === overlay && !hasDirtyCheck(overlay.id)) {
                overlay.classList.remove('active');
            }
        });
    });
}

document.addEventListener('DOMContentLoaded', init);
