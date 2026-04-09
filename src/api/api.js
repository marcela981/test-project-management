/** Capa de datos: REST + localStorage; Deck y auth vía backend. */

import { CONFIG }    from '../core/config.js';
import { STATE }     from '../core/state.js';
import { save }      from '../core/storage.js';
import { generateId } from '../shared/utils.js';
import { getToken, logout }  from '../auth/auth.js';

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

function _isActivity(taskId) {
    return STATE.tasks.find(t => t.id === taskId)?.type === 'activity';
}

export async function fetchTasks() {
    if (!CONFIG.BACKEND_URL) return [];

    const [tareas, activities] = await Promise.all([
        apiFetch('/tareas').catch(() => []),
        apiFetch('/activities').catch(() => []),
    ]);

    return [
        ...(Array.isArray(tareas)      ? tareas      : []),
        ...(Array.isArray(activities)  ? activities  : []),
    ];
}

export async function saveTime(taskId, timeSpent, subtaskId = null, feedback = null) {
    if (CONFIG.BACKEND_URL) {
        const endpoint = _isActivity(taskId)
            ? `/activities/${taskId}/time`
            : `/tareas/${taskId}/time`;

        await apiFetch(endpoint, {
            method: 'POST',
            body: JSON.stringify({ timeSpent, subtaskId, feedback }),
            // ↑ FIJO: antes mandaba {tareaId, tiempoInvertido}
        });
    }

    const task = STATE.tasks.find(t => t.id === taskId);
    if (!task) return;

    task.timeSpent += timeSpent;

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

    if (!task.timeLog) task.timeLog = [];
    const today = new Date().toISOString().split('T')[0];
    const logEntry = task.timeLog.find(e => e.date === today);
    if (logEntry) {
        logEntry.seconds = Math.max(0, logEntry.seconds + diff);
        if (logEntry.seconds === 0) task.timeLog = task.timeLog.filter(e => e.date !== today);
    } else if (diff > 0) {
        task.timeLog.push({ date: today, seconds: diff });
    }

    if (CONFIG.BACKEND_URL) {
        const endpoint = _isActivity(taskId)
            ? `/activities/${taskId}`
            : `/tareas/${taskId}`;
        await apiFetch(endpoint, {
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
        if (newTask.type === 'activity') {
            // ↓ Activities van a su propio endpoint
            const payload = {
                title:       newTask.title,
                description: newTask.description ?? "",
                type:        newTask.activityType ?? 'other',  // meeting/training/etc.
                priority:    newTask.priority ?? 'medium',
                startDate:   newTask.startDate ?? null,
                deadline:    newTask.deadline ?? null,
            };
            const saved = await apiFetch('/activities', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            // El backend retorna {success, activity} con column y type ya normalizados
            const activity = saved?.activity ?? (saved?.id ? saved : newTask);
            STATE.tasks.push(activity);
            save();
            return activity;
        } else {
            const payload = {
                title:        newTask.title,
                description:  newTask.description ?? "",
                column:       newTask.column,
                type:         newTask.type,
                priority:     newTask.priority ?? "medium",
                startDate:    newTask.startDate ?? null,
                deadline:     newTask.deadline ?? null,
                subtasks:     newTask.subtasks ?? [],
            };
            const saved = await apiFetch('/tareas', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            const task = saved?.task ?? (saved?.id ? saved : newTask);
            STATE.tasks.push(task);
            save();
            return task;
        }
    }

    STATE.tasks.push(newTask);
    save();
    return newTask;
}

export async function updateTask(taskId, data) {
    if (CONFIG.BACKEND_URL) {
        const isAct = _isActivity(taskId);

        if (isAct) {
            const payload = {
                title:       data.title,
                description: data.description,
                type:        data.activityType ?? 'other',
                priority:    data.priority,
                startDate:   data.startDate ?? null,
                deadline:    data.deadline ?? null,
            };
            const saved = await apiFetch(`/activities/${taskId}`, {
                method: 'PATCH',
                body: JSON.stringify(payload),
            });
            const idx = STATE.tasks.findIndex(t => t.id === taskId);
            if (idx !== -1) {
                STATE.tasks[idx] = saved?.activity ?? { ...STATE.tasks[idx], ...data };
            }
        } else {
            const saved = await apiFetch(`/tareas/${taskId}`, {
                method: 'PATCH',
                body: JSON.stringify(data),
            });
            const idx = STATE.tasks.findIndex(t => t.id === taskId);
            if (idx !== -1) {
                STATE.tasks[idx] = saved?.task ?? (saved?.id ? saved : { ...STATE.tasks[idx], ...data });
            }
        }
        save();
        return;
    }

    const idx = STATE.tasks.findIndex(t => t.id === taskId);
    if (idx !== -1) STATE.tasks[idx] = { ...STATE.tasks[idx], ...data };
    save();
    return STATE.tasks[idx];
}

export async function deleteTask(taskId) {
    if (CONFIG.BACKEND_URL) {
        const endpoint = _isActivity(taskId)
            ? `/activities/${taskId}`
            : `/tareas/${taskId}`;
        await apiFetch(endpoint, { method: 'DELETE' });
    }

    const idx = STATE.tasks.findIndex(t => t.id === taskId);
    if (idx !== -1) STATE.tasks.splice(idx, 1);
    save();
}

export async function updateColumn(taskId, column) {
    const task = STATE.tasks.find(t => t.id === taskId);

    if (task?.type !== 'activity' && CONFIG.BACKEND_URL) {
        await apiFetch(`/tareas/${taskId}/columna`, {
            method: 'PATCH',
            body: JSON.stringify({ column }),
        });
    }

    if (task) task.column = column;
    save();
}

export async function completeTask(taskId) {
    const isAct = _isActivity(taskId);

    if (CONFIG.BACKEND_URL) {
        if (isAct) {
            await apiFetch(`/activities/${taskId}`, {
                method: 'PATCH',
                body: JSON.stringify({ progress: 100 }),
            });
        } else {
            await apiFetch(`/tareas/${taskId}/finalizar`, { method: 'POST' });
        }
    }

    const task = STATE.tasks.find(t => t.id === taskId);
    if (task) {
        task.progress = 100;
        task.subtasks.forEach(s => (s.completed = true));
        task.column = isAct ? 'activities' : 'completed'; // ← FIJO
        // Las tareas completadas desaparecen del board (no hay columna 'completed' en el kanban)
    }
    save();
}

export async function fetchDeckBoards() {
    return deckFetch('/api/deck/boards');
}

export async function fetchDeckCards(boardId) {
    return deckFetch(`/api/deck/boards/${boardId}/cards`);
}
