/** Cronómetro por tarea; pausa guarda progreso y observación. */

import { STATE }      from '../core/state.js';
import { saveTime, completeTask, updateTask } from '../api/api.js';
import { save, saveTimers, loadTimerData } from '../core/storage.js';
import { renderBoard } from '../board/render.js';
import { formatTime }  from '../shared/utils.js';
import { closeModal }  from '../shared/modal.js';
import { openCompletionModal } from './completionModal.js';
import { emitTimeLogChanged } from '../core/events.js';


// Umbrales de notificación: proyecto 3h, actividad 1h
const NOTIFY_THRESHOLD    = { project: 3 * 3600, activity: 1 * 3600 };
const HEARTBEAT_INTERVAL  = 60; // seconds between silent backend syncs

// Heartbeat-in-flight guard per timer type. setInterval keeps firing _tick every
// 1s even while an awaited saveTime is pending — without this flag, slow saves
// (>1s) trigger overlapping heartbeats that all accumulate into the same row.
const _heartbeatInFlight = { project: false, activity: false };

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

    const now = Date.now();
    STATE.timers[type] = {
        taskId,
        subtaskId:    selectedSubId,
        startTime:    now,
        sessionStart: now,
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
    const elapsed       = _elapsed(type);
    const subtaskId     = STATE.timers[type].subtaskId;
    const sessionStart  = new Date(STATE.timers[type].sessionStart).toISOString();
    STATE.timers[type] = null;
    saveTimers();


    if (subtaskId && subtaskId !== 'none') {
        const sub = task.subtasks.find(s => s.id === subtaskId);
        const completedAfter = task.subtasks.filter(s => s.completed || s.id === subtaskId).length;
        const progressAfter  = Math.round((completedAfter / task.subtasks.length) * 100);

        if (progressAfter === 100 && task.type === 'project') {
            openCompletionModal(taskId, elapsed, subtaskId, sessionStart);
            return;
        }

        await saveTime(taskId, elapsed, subtaskId, {}, sessionStart);
        emitTimeLogChanged({ taskId, type: 'create' });
        if (sub) sub.completed = true;
        const done = task.subtasks.filter(s => s.completed).length;
        task.progress = Math.round((done / task.subtasks.length) * 100);
        await updateTask(taskId, { subtasks: task.subtasks, progress: task.progress });
    } else {
        if (task.type === 'project') {
            openCompletionModal(taskId, elapsed, null, sessionStart);
            return;
        }
        await saveTime(taskId, elapsed, subtaskId, { progress: 100 }, sessionStart);
        emitTimeLogChanged({ taskId, type: 'create' });
        await completeTask(taskId);
    }
    renderBoard();
}

export function cancelCompletion(taskId) {
    const task = STATE.tasks.find(t => t.id === taskId);
    if (task) {
        const type = task.type;
        const now  = Date.now();
        STATE.timers[type] = {
            taskId,
            subtaskId:    'none',
            startTime:    now,
            sessionStart: now,
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
        const prevAccum        = prev ? prev.accumulated + prevElapsed : (task.timeSpent ?? 0);
        const now              = Date.now();
        // cancelPause continues the same session — preserve the original sessionStart
        const prevSessionStart = prev?.sessionStart ?? now;
        STATE.timers[type] = {
            taskId,
            subtaskId:    prevSubtaskId,
            startTime:    now,
            sessionStart: prevSessionStart,
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

    const type         = task.type;
    const progress     = parseInt(document.getElementById('pauseProgress').value, 10);
    const observation  = document.getElementById('pauseObservation').value.trim();
    const subtaskId    = STATE.timers[type]?.subtaskId ?? null;
    const sessionStart = new Date(STATE.timers[type]?.sessionStart ?? Date.now()).toISOString();

    if (subtaskId && subtaskId !== 'none') {
        // El progreso ingresado corresponde a la subtarea, no a la tarea global
        const sub = task.subtasks.find(s => s.id === subtaskId);
        if (sub) sub.progress = progress;
        await saveTime(taskId, elapsedTime, subtaskId, { observation: observation || null }, sessionStart);
        await updateTask(taskId, { subtasks: task.subtasks });
    } else {
        await saveTime(taskId, elapsedTime, subtaskId, {
            progress,
            observation: observation || null,
        }, sessionStart);
    }
    emitTimeLogChanged({ taskId, type: 'create' });

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
            // sessionStart might be missing in timers saved before this change
            sessionStart: timerData.sessionStart ?? timerData.startTime,
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

export async function timerNotifNo(taskId, type) {
    const task = STATE.tasks.find(t => t.id === taskId);
    if (!task) return;

    closeTimerNotif();

    // Detener el timer activo y guardar el tiempo acumulado
    const timer = STATE.timers[type];
    if (timer?.taskId === taskId) {
        clearInterval(timer.intervalId);
        const elapsed      = _elapsed(type);
        const subtaskId    = timer.subtaskId ?? null;
        const sessionStart = new Date(timer.sessionStart ?? timer.startTime).toISOString();
        STATE.timers[type] = null;
        saveTimers();
        if (elapsed > 0) {
            await saveTime(taskId, elapsed, subtaskId, null, sessionStart).catch(() => {});
        }
    }

    // Marcar la tarea como completada al 100% y persistir
    await completeTask(taskId);
    renderBoard();
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

async function _tick(taskId, type) {
    const el    = document.getElementById(`timer-${taskId}`);
    const timer = STATE.timers[type];
    if (!el || !timer) return;

    const elapsed = _elapsed(type);
    el.textContent = formatTime(timer.accumulated + elapsed);

    // Heartbeat: silently persist elapsed to backend every HEARTBEAT_INTERVAL seconds.
    // The in-flight guard prevents the next setInterval tick from launching a
    // second concurrent save while the first is still awaiting the network — the
    // overlap was double-counting time on the backend row.
    if (elapsed >= HEARTBEAT_INTERVAL && !_heartbeatInFlight[type]) {
        _heartbeatInFlight[type] = true;
        const subtaskId    = timer.subtaskId;
        const sessionStart = new Date(timer.sessionStart ?? timer.startTime).toISOString();
        try {
            await saveTime(taskId, elapsed, subtaskId, null, sessionStart);
            // Only advance if timer is still active for this task
            if (STATE.timers[type]?.taskId === taskId) {
                STATE.timers[type].accumulated  += elapsed;
                STATE.timers[type].startTime     = Date.now();
                // sessionStart is intentionally NOT reset — it marks this session's origin
                STATE.timers[type].nextNotifyAt -= elapsed; // keep threshold relative to total
                saveTimers();
            }
        } catch {
            // Offline or 401: leave startTime unchanged, retry next interval
        } finally {
            _heartbeatInFlight[type] = false;
        }
    }

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

    const subtaskId = STATE.timers[task.type]?.subtaskId ?? null;
    const activeSub = subtaskId && subtaskId !== 'none'
        ? task.subtasks.find(s => s.id === subtaskId)
        : null;
    const progressLabel = activeSub
        ? `¿Qué porcentaje de "${activeSub.text}" completaste?`
        : '¿Qué porcentaje de la tarea completaste?';
    const progressValue = activeSub ? (activeSub.progress ?? 0) : task.progress;

    document.getElementById('modalDetailTitle').textContent = 'Record Progress';

    document.getElementById('modalDetailBody').innerHTML = `
        <div class="pause-feedback">
            <div class="pause-feedback-title">
                <i class="fas fa-pause-circle"></i>
                Time recorded: ${formatTime(elapsedTime)}
            </div>
            <div class="form-group">
                <label class="form-label">${progressLabel}</label>
                <div class="progress-input-group">
                    <input type="range" id="pauseProgress" min="0" max="100" value="${progressValue}"
                           oninput="document.getElementById('pauseProgressValue').textContent = this.value + '%'">
                    <span id="pauseProgressValue">${progressValue}%</span>
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
