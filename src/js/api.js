/** Capa de datos: REST + localStorage; Deck y auth vía backend. */

import { CONFIG }    from './config.js';
import { STATE }     from './state.js';
import { save }      from './storage.js';
import { generateId } from './utils.js';
import { getToken, logout }  from './auth.js';

async function apiFetch(path, options = {}) {
    const token = getToken();
    const response = await fetch(`${CONFIG.BACKEND_URL}${path}`, {
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        ...options,
    });
    if (response.status === 401) {
        logout();
        return;
    }
    if (!response.ok) {
        throw new Error(`API error ${response.status}: ${response.statusText}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : {};
}

async function deckFetch(path) {
    const token = getToken();
    const res = await fetch(`${CONFIG.BACKEND_BASE_URL}${path}`, {
        headers: {
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
    });
    if (!res.ok) throw new Error(`Deck error ${res.status}: ${res.statusText}`);
    return res.json();
}

export async function fetchTasks() {
    if (!CONFIG.BACKEND_URL) return [];
    return apiFetch('/tareas');
}

export async function saveTime(taskId, timeSpent, subtaskId = null, feedback = null) {
    if (CONFIG.BACKEND_URL) {
        await apiFetch(`/tareas/${taskId}/time`, {
            method: 'POST',
            // Backend: POST /api/proyectos/tareas/{task_id}/time
            // Espera `tiempoInvertido` y `subtaskId` (ver record_time_by_path).
            body: JSON.stringify({
                tareaId: taskId,           // alineado al modelo TimeRecord (alias: tareaId)
                tiempoInvertido: timeSpent,
                subtaskId,
                feedback,
            }),
        });
    }

    const task = STATE.tasks.find(t => t.id === taskId);
    if (!task) return;

    task.timeSpent += timeSpent;

    // Acumular en el log diario
    if (!task.timeLog) task.timeLog = [];
    const today = new Date().toISOString().split('T')[0];
    const logEntry = task.timeLog.find(e => e.date === today);
    if (logEntry) {
        logEntry.seconds += timeSpent;
    } else {
        task.timeLog.push({ date: today, seconds: timeSpent });
    }

    if (subtaskId && subtaskId !== 'none') {
        const sub = task.subtasks.find(s => s.id === subtaskId);
        if (sub) sub.timeSpent += timeSpent;
    }

    if (feedback) {
        if (feedback.progress !== undefined) task.progress = feedback.progress;
        if (feedback.observation) {
            task.observations.push({ date: new Date().toISOString(), text: feedback.observation });
        }
    }

    save();
}

export async function setTaskTime(taskId, newSeconds) {
    const task = STATE.tasks.find(t => t.id === taskId);
    if (!task) return;

    const diff = newSeconds - task.timeSpent;
    task.timeSpent = newSeconds;

    // Ajustar la entrada de hoy en el log
    if (!task.timeLog) task.timeLog = [];
    const today = new Date().toISOString().split('T')[0];
    const logEntry = task.timeLog.find(e => e.date === today);
    if (logEntry) {
        logEntry.seconds = Math.max(0, logEntry.seconds + diff);
        if (logEntry.seconds === 0) {
            task.timeLog = task.timeLog.filter(e => e.date !== today);
        }
    } else if (diff > 0) {
        task.timeLog.push({ date: today, seconds: diff });
    }

    if (CONFIG.BACKEND_URL) {
        await apiFetch(`/tareas/${taskId}`, {
            method: 'PATCH',
            body: JSON.stringify({ timeSpent: newSeconds, timeLog: task.timeLog }),
        });
    }

    save();
    return task;
}

export async function createTask(data) {
    const newTask = {
        id:           generateId('task'),
        createdAt:    new Date().toISOString(),
        progress:     0,
        timeSpent:    0,
        timeLog:      [],
        observations: [],
        subtasks:     [],
        ...data,
    };

    if (CONFIG.BACKEND_URL) {
        // Backend expects TaskCreate shape (no id/progress/timeSpent/observations wrapper).
        const payload = {
            title:        newTask.title,
            description:  newTask.description ?? "",
            column:       newTask.column,
            type:         newTask.type,
            priority:     newTask.priority ?? "medium",
            startDate:    newTask.startDate ?? null,
            deadline:     newTask.deadline ?? null,
            activityType: newTask.activityType ?? null,
            subtasks:     newTask.subtasks ?? [],
        };

        const saved = await apiFetch('/tareas', {
            method: 'POST',
            body: JSON.stringify(payload),
        });

        // Backend returns: { success: True, task: <Task> }
        // Fallback al objeto local si el backend no devuelve el task.
        const task = saved?.task ?? (saved?.id ? saved : newTask);
        STATE.tasks.push(task);
        save();
        return task;
    }

    STATE.tasks.push(newTask);
    save();
    return newTask;
}

export async function updateTask(taskId, data) {
    if (CONFIG.BACKEND_URL) {
        const saved = await apiFetch(`/tareas/${taskId}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });

        const idx = STATE.tasks.findIndex(t => t.id === taskId);
        if (idx !== -1) {
            const updated = saved?.task ?? (saved?.id ? saved : { ...STATE.tasks[idx], ...data });
            STATE.tasks[idx] = updated;
        }
        save();
        return saved;
    }

    const idx = STATE.tasks.findIndex(t => t.id === taskId);
    if (idx !== -1) {
        STATE.tasks[idx] = { ...STATE.tasks[idx], ...data };
    }
    save();
    return STATE.tasks[idx];
}

export async function deleteTask(taskId) {
    if (CONFIG.BACKEND_URL) {
        await apiFetch(`/tareas/${taskId}`, { method: 'DELETE' });
    }

    const idx = STATE.tasks.findIndex(t => t.id === taskId);
    if (idx !== -1) STATE.tasks.splice(idx, 1);
    save();
}

export async function updateColumn(taskId, column) {
    if (CONFIG.BACKEND_URL) {
        await apiFetch(`/tareas/${taskId}/columna`, {
            method: 'PATCH',
            body: JSON.stringify({ column }),
        });
    }

    const task = STATE.tasks.find(t => t.id === taskId);
    if (task) task.column = column;
    save();
}

export async function completeTask(taskId) {
    if (CONFIG.BACKEND_URL) {
        await apiFetch(`/tareas/${taskId}/finalizar`, { method: 'POST' });
    }

    const task = STATE.tasks.find(t => t.id === taskId);
    if (task) {
        task.progress = 100;
        task.subtasks.forEach(s => (s.completed = true));
        task.column = 'actively-working';
    }
    save();
}

export async function fetchDeckBoards() {
    return deckFetch('/api/deck/boards');
}

export async function fetchDeckCards(boardId) {
    return deckFetch(`/api/deck/boards/${boardId}/cards`);
}
