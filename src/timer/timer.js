/** Cronómetro por tarea; pausa guarda progreso y observación. */

import { STATE }      from '../core/state.js';
import { saveTime, completeTask, updateTask } from '../api/api.js';
import { save, saveTimers, loadTimerData } from '../core/storage.js';
import { renderBoard } from '../board/render.js';
import { formatTime }  from '../shared/utils.js';
import { closeModal }  from '../shared/modal.js';
import { openCompletionModal } from './completionModal.js';


// Umbrales de notificación: proyecto 3h, actividad 1h
const NOTIFY_THRESHOLD = { project: 3 * 3600, activity: 1 * 3600 };

export function startTimer(taskId) {
    const task = STATE.tasks.find(t => t.id === taskId);
    if (!task) return;

    const type = task.type;

    if (STATE.timers[type] && STATE.timers[type].taskId !== taskId) {
        alert('You already have an active timer for this type. Pause or stop it first.');
        return;
    }

    const selectedSubId  = STATE.selectedSubtasks[taskId]
        ?? document.getElementById(`subtask-select-${taskId}`)?.value
        ?? 'none';
    const activeSub      = selectedSubId !== 'none'
        ? task.subtasks.find(s => s.id === selectedSubId)
        : null;

    STATE.timers[type] = {
        taskId,
        subtaskId:    selectedSubId,
        startTime:    Date.now(),
        accumulated:  activeSub ? (activeSub.timeSpent ?? 0) : (task.timeSpent ?? 0),
        nextNotifyAt: NOTIFY_THRESHOLD[type],
        intervalId:   setInterval(() => _tick(taskId, type), 1000)
    };

    saveTimers();
    renderBoard();
}

export function pauseTimer(taskId) {
    const task = STATE.tasks.find(t => t.id === taskId);
    if (!task) return;

    const type = task.type;
    if (!STATE.timers[type] || STATE.timers[type].taskId !== taskId) return;

    clearInterval(STATE.timers[type].intervalId);
    const elapsed = _elapsed(type);
    _openPauseFeedbackModal(taskId, elapsed);
}

export async function stopTimer(taskId) {
    const task = STATE.tasks.find(t => t.id === taskId);
    if (!task) return;

    const type = task.type;
    if (!STATE.timers[type] || STATE.timers[type].taskId !== taskId) return;

    clearInterval(STATE.timers[type].intervalId);
    const elapsed   = _elapsed(type);
    const subtaskId = STATE.timers[type].subtaskId;
    STATE.timers[type] = null;
    saveTimers();


    if (subtaskId && subtaskId !== 'none') {
        const sub = task.subtasks.find(s => s.id === subtaskId);
        const completedAfter = task.subtasks.filter(s => s.completed || s.id === subtaskId).length;
        const progressAfter  = Math.round((completedAfter / task.subtasks.length) * 100);

        if (progressAfter === 100 && task.type === 'project') {
            openCompletionModal(taskId, elapsed, subtaskId);
            return;
        }

        await saveTime(taskId, elapsed, subtaskId, {});
        if (sub) sub.completed = true;
        const done = task.subtasks.filter(s => s.completed).length;
        task.progress = Math.round((done / task.subtasks.length) * 100);
        await updateTask(taskId, { subtasks: task.subtasks, progress: task.progress });
    } else {
        if (task.type === 'project') {
            openCompletionModal(taskId, elapsed, null);
            return;
        }
        await saveTime(taskId, elapsed, subtaskId, { progress: 100 });
        await completeTask(taskId);
    }
    renderBoard();
}

export function cancelCompletion(taskId) {
    const task = STATE.tasks.find(t => t.id === taskId);
    if (task) {
        const type = task.type;
        STATE.timers[type] = {
            taskId,
            subtaskId:    'none',
            startTime:    Date.now(),
            accumulated:  task.timeSpent ?? 0,
            nextNotifyAt: NOTIFY_THRESHOLD[type],
            intervalId:   setInterval(() => _tick(taskId, type), 1000),
        };
        saveTimers();
    }
    closeModal('modalTaskDetail');
    renderBoard();
}

export function cancelPause(taskId) {
    const task = STATE.tasks.find(t => t.id === taskId);
    if (task) {
        const type      = task.type;
        const prev      = STATE.timers[type];
        const prevElapsed   = prev ? Math.floor((Date.now() - prev.startTime) / 1000) : 0;
        const prevSubtaskId = prev?.subtaskId ?? null;
        const prevAccum     = prev ? prev.accumulated + prevElapsed : (task.timeSpent ?? 0);
        STATE.timers[type] = {
            taskId,
            subtaskId:    prevSubtaskId,
            startTime:    Date.now(),
            accumulated:  prevAccum,
            nextNotifyAt: NOTIFY_THRESHOLD[type],
            intervalId:   setInterval(() => _tick(taskId, type), 1000)
        };
        saveTimers();
    }
    closeModal('modalTaskDetail');
    renderBoard();
}

export async function confirmPause(taskId, elapsedTime) {
    const task = STATE.tasks.find(t => t.id === taskId);
    if (!task) return;

    const type        = task.type;
    const progress    = parseInt(document.getElementById('pauseProgress').value, 10);
    const observation = document.getElementById('pauseObservation').value.trim();
    const subtaskId   = STATE.timers[type]?.subtaskId ?? null;

    await saveTime(taskId, elapsedTime, subtaskId, {
        progress,
        observation: observation || null,
    });

    if (task.type === 'project') {
        const helpVisible = document.getElementById('pauseHelpVisible')?.checked ?? false;
        await updateTask(taskId, { helpVisible });
    }

    STATE.timers[type] = null;
    closeModal('modalTaskDetail');
    saveTimers();
    renderBoard();
}

export function restoreTimers() {
    const saved = loadTimerData();
    if (!saved) return;

    for (const [type, timerData] of Object.entries(saved)) {
        if (!timerData) continue;

        const task = STATE.tasks.find(t => t.id === timerData.taskId);
        if (!task) continue; // la tarea ya no existe

        // startTime original se preservó — el elapsed acumulará correctamente
        STATE.timers[type] = {
            ...timerData,
            intervalId: setInterval(() => _tick(timerData.taskId, type), 1000),
        };
    }
}

// ---------------------------------------------------------------------------
// Notificación de inactividad
// ---------------------------------------------------------------------------

export function closeTimerNotif() {
    document.getElementById('modalTimerNotif').classList.remove('active');
}

export function timerNotifNo(taskId, type) {
    const task = STATE.tasks.find(t => t.id === taskId);
    if (!task) return;

    closeTimerNotif();

    const label = type === 'activity' ? 'actividad' : 'tarea';
    document.getElementById('timerActionBody').innerHTML = `
        <p style="text-align:center; margin:0.5rem 0; font-size:1rem;">
            ¿Deseas finalizar o detener la ${label}
            <strong>"${task.title}"</strong>?
        </p>`;
    document.getElementById('timerActionFooter').innerHTML = `
        <button class="btn btn-secondary" data-action="timer-stop" data-task-id="${taskId}" data-type="${type}">
            <i class="fas fa-stop"></i> Detener
        </button>
        <button class="btn btn-primary" data-action="timer-finalize" data-task-id="${taskId}" data-type="${type}">
            <i class="fas fa-check-double"></i> Finalizar
        </button>`;

    document.getElementById('modalTimerAction').classList.add('active');
}

export function closeTimerAction() {
    document.getElementById('modalTimerAction').classList.remove('active');
}

export async function timerActionFinalize(taskId, type) {
    closeTimerAction();
    await stopTimer(taskId);
}

export function timerActionStop(taskId, type) {
    closeTimerAction();
    pauseTimer(taskId);
}

// ---------------------------------------------------------------------------
// Privadas
// ---------------------------------------------------------------------------

function _elapsed(type) {
    return Math.floor((Date.now() - STATE.timers[type].startTime) / 1000);
}

function _tick(taskId, type) {
    const el    = document.getElementById(`timer-${taskId}`);
    const timer = STATE.timers[type];
    if (!el || !timer) return;

    const elapsed = _elapsed(type);
    el.textContent = formatTime(timer.accumulated + elapsed);

    if (elapsed >= timer.nextNotifyAt) {
        timer.nextNotifyAt += NOTIFY_THRESHOLD[type];
        _showTimerNotification(taskId, type);
    }
}

function _showTimerNotification(taskId, type) {
    const task = STATE.tasks.find(t => t.id === taskId);
    if (!task) return;

    const label    = type === 'activity' ? 'actividad' : 'tarea';
    const timeStr  = type === 'activity' ? '1 hora' : '3 horas';

    document.getElementById('timerNotifBody').innerHTML = `
        <p style="text-align:center; margin:0.5rem 0; font-size:1rem;">
            Han pasado <strong>${timeStr}</strong> desde que iniciaste la ${label}
            <strong>"${task.title}"</strong>.<br>
            ¿Sigues trabajando en ella?
        </p>`;
    document.getElementById('timerNotifFooter').innerHTML = `
        <button class="btn btn-secondary" data-action="timer-notif-no" data-task-id="${taskId}" data-type="${type}">No</button>
        <button class="btn btn-primary"   data-action="close-timer-notif">Sí</button>`;

    document.getElementById('modalTimerNotif').classList.add('active');
}

function _openPauseFeedbackModal(taskId, elapsedTime) {
    const task = STATE.tasks.find(t => t.id === taskId);
    if (!task) return;

    document.getElementById('modalDetailTitle').textContent = 'Record Progress';

    document.getElementById('modalDetailBody').innerHTML = `
        <div class="pause-feedback">
            <div class="pause-feedback-title">
                <i class="fas fa-pause-circle"></i>
                Time recorded: ${formatTime(elapsedTime)}
            </div>
            <div class="form-group">
                <label class="form-label">Progress percentage</label>
                <div class="progress-input-group">
                    <input type="range" id="pauseProgress" min="0" max="100" value="${task.progress}"
                           oninput="document.getElementById('pauseProgressValue').textContent = this.value + '%'">
                    <span id="pauseProgressValue">${task.progress}%</span>
                </div>
            </div>
            <div class="form-group">
                <label class="form-label">Progress notes</label>
                <textarea class="form-textarea" id="pauseObservation"
                          placeholder="Briefly describe what you accomplished..."></textarea>
            </div>
            ${task.type === 'project' ? `
            <label class="help-visible-label">
                <input type="checkbox" id="pauseHelpVisible">
                <span>¿Deseas que esta tarea sea visible para que otros soliciten tu ayuda en este tema?</span>
            </label>` : ''}
        </div>`;

    document.getElementById('modalDetailFooter').innerHTML = `
        <button class="btn btn-secondary" data-action="cancel-pause" data-task-id="${taskId}">Cancel</button>
        <button class="btn btn-primary"   data-action="confirm-pause" data-task-id="${taskId}" data-elapsed="${elapsedTime}">
            <i class="fas fa-save"></i> Save &amp; Pause
        </button>`;

    document.getElementById('modalTaskDetail').classList.add('active');
}
