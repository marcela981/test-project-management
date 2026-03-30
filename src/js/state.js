/** Estado global compartido: tareas, timer activo, tipo en modal, selección Deck. */

export const STATE = {
    tasks: [],
    timers: { project: null, activity: null },
    selectedSubtasks: {},        // taskId → subtaskId seleccionado antes de iniciar timer
    currentTaskType: 'project',
    editingTaskId: null,
    selectedDeckCards: new Set()
};
