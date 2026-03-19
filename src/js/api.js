/** Capa de datos: REST + localStorage; Deck y auth vía backend. */

import { CONFIG }    from './config.js';
import { STATE }     from './state.js';
import { save }      from './storage.js';
import { generateId } from './utils.js';
import { getToken }  from './auth.js';

async function apiFetch(path, options = {}) {
    const token = getToken();
    const response = await fetch(`${CONFIG.BACKEND_URL}${path}`, {
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        ...options,
    });
    if (!response.ok) {
        throw new Error(`API error ${response.status}: ${response.statusText}`);
    }
    return response.json();
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
            body: JSON.stringify({ timeSpent, subtaskId, feedback }),
        });
    }

    const task = STATE.tasks.find(t => t.id === taskId);
    if (!task) return;

    task.timeSpent += timeSpent;

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

export async function createTask(data) {
    const newTask = {
        id:           generateId('task'),
        progress:     0,
        timeSpent:    0,
        observations: [],
        subtasks:     [],
        ...data,
    };

    if (CONFIG.BACKEND_URL) {
        const saved = await apiFetch('/tareas', {
            method: 'POST',
            body: JSON.stringify(newTask),
        });
        STATE.tasks.push(saved);
        save();
        return saved;
    }

    STATE.tasks.push(newTask);
    save();
    return newTask;
}

export async function updateColumn(taskId, column) {
    if (CONFIG.BACKEND_URL) {
        await apiFetch(`/tareas/${taskId}`, {
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
        await apiFetch(`/tareas/${taskId}/complete`, { method: 'POST' });
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
