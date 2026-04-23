/** Modal para agregar bloques al weekly tracker. */

import { STATE } from '../core/state.js';
import { getBlocks, createBlock, hasOverlap } from './weekly-data.js';
import { openModal, closeModal } from '../shared/modal.js';

const COLORS     = ['#e8b86d', '#f97316', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444'];
const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

let _onSaved         = null;
let _pendingDay      = null;
let _pendingWeekStart = null;
let _preselectedTask = null;
let _selectedColor   = COLORS[0];

export function openBlockModal(day, weekStartIsoDate, onSaved, preselectedTaskId = null) {
    _onSaved          = onSaved;
    _pendingDay       = day;
    _pendingWeekStart = weekStartIsoDate;
    _preselectedTask  = preselectedTaskId != null ? String(preselectedTaskId) : null;
    _selectedColor    = COLORS[0];
    _buildContent();
    openModal('modalWeeklyBlock');
}

export function closeBlockModal() {
    closeModal('modalWeeklyBlock');
}

export async function submitBlock() {
    const type      = document.getElementById('weeklyBlockType')?.value;
    const day       = parseInt(document.getElementById('weeklyBlockDay')?.value ?? '', 10);
    const startTime = document.getElementById('weeklyBlockStart')?.value;
    const endTime   = document.getElementById('weeklyBlockEnd')?.value;

    if (!startTime || !endTime) { alert('Ingresa hora de inicio y fin.'); return; }
    const sm = _toMins(startTime);
    const em = _toMins(endTime);
    if (em <= sm) { alert('La hora de fin debe ser mayor a la hora de inicio.'); return; }

    if (!_pendingWeekStart) { alert('No se pudo determinar la semana. Recarga la vista.'); return; }

    let payload;
    if (type === 'task') {
        const selectEl = document.getElementById('weeklyBlockTask');
        const taskId   = selectEl?.value;
        if (!taskId) { alert('Selecciona una tarea o actividad.'); return; }

        const task = STATE.tasks.find(t => String(t.id) === String(taskId));
        if (!task) { alert('La tarea seleccionada ya no existe.'); return; }

        const isActivity = task.type === 'activity';
        payload = {
            week_start:  _pendingWeekStart,
            day_of_week: day,
            block_type:  isActivity ? 'activity' : 'task',
            task_id:     isActivity ? null : task.id,
            activity_id: isActivity ? task.id : null,
            start_time:  startTime,
            end_time:    endTime,
        };
    } else {
        const title = document.getElementById('weeklyBlockTitle')?.value.trim();
        if (!title) { alert('Ingresa un título para el bloque.'); return; }
        payload = {
            week_start:  _pendingWeekStart,
            day_of_week: day,
            block_type:  'personal',
            title,
            color:       _selectedColor,
            start_time:  startTime,
            end_time:    endTime,
        };
    }

    // Chequeo de solapamiento contra los bloques ya cargados para esta semana.
    const local = getBlocks();
    const overlapCheck = {
        day,
        start_time: startTime,
        end_time:   endTime,
    };
    if (hasOverlap(local, overlapCheck)) {
        const ok = confirm('⚠️ Este bloque se solapa con otro existente. ¿Agregarlo de todas formas?');
        if (!ok) return;
    }

    const saved = await createBlock(payload);
    if (!saved) return; // createBlock ya mostró el error

    closeBlockModal();
    _onSaved?.(saved);
}

export function handleWeeklyModalEvent(action, el) {
    switch (action) {
        case 'weekly-type-tab': {
            const tab = el.dataset.tab;
            document.getElementById('weeklyBlockType').value = tab;
            document.querySelectorAll('.weekly-type-btn').forEach(b =>
                b.classList.toggle('active', b.dataset.tab === tab)
            );
            document.getElementById('weeklyTaskFields').style.display    = tab === 'task'     ? '' : 'none';
            document.getElementById('weeklyPersonalFields').style.display = tab === 'personal' ? '' : 'none';
            return true;
        }
        case 'weekly-pick-color': {
            _selectedColor = el.dataset.color;
            document.querySelectorAll('.weekly-color-swatch').forEach(s =>
                s.classList.toggle('selected', s.dataset.color === _selectedColor)
            );
            return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------

function _buildContent() {
    const body = document.getElementById('modalWeeklyBlockBody');

    // Tomamos todas las tareas/actividades del board que no estén completadas.
    const activeItems = STATE.tasks.filter(t => {
        if (t.type === 'activity') return (t.progress ?? 0) < 100;
        return t.column !== 'completed';
    });

    const dayOptions = DAY_LABELS.map((l, i) =>
        `<option value="${i}"${i === _pendingDay ? ' selected' : ''}>${l}</option>`
    ).join('');

    const taskOptions = activeItems.length === 0
        ? '<option value="" disabled>No hay tareas disponibles en el board</option>'
        : activeItems.map(t => {
            const kind = t.type === 'activity' ? 'Actividad' : 'Tarea';
            const pri  = t.priority ? ` · ${t.priority}` : '';
            const sel  = String(t.id) === _preselectedTask ? ' selected' : '';
            return `<option value="${t.id}"${sel}>${_esc(t.title)} (${kind}${pri})</option>`;
        }).join('');

    const colorSwatches = COLORS.map(c =>
        `<button type="button" class="weekly-color-swatch${c === _selectedColor ? ' selected' : ''}"
            style="background:${c}" data-action="weekly-pick-color" data-color="${c}" title="${c}"></button>`
    ).join('');

    body.innerHTML = `
        <div class="form-group">
            <label class="form-label">Tipo de bloque</label>
            <div class="weekly-type-selector">
                <button type="button" class="weekly-type-btn active" data-action="weekly-type-tab" data-tab="task">
                    <i class="fas fa-tasks"></i> Tarea / Actividad
                </button>
                <button type="button" class="weekly-type-btn" data-action="weekly-type-tab" data-tab="personal">
                    <i class="fas fa-user"></i> Bloque personal
                </button>
            </div>
            <input type="hidden" id="weeklyBlockType" value="task">
        </div>

        <div id="weeklyTaskFields">
            <div class="form-group">
                <label class="form-label" for="weeklyBlockTask">Tarea / Actividad</label>
                <select id="weeklyBlockTask" class="form-select">
                    <option value="">-- Selecciona --</option>
                    ${taskOptions}
                </select>
            </div>
        </div>

        <div id="weeklyPersonalFields" style="display:none">
            <div class="form-group">
                <label class="form-label" for="weeklyBlockTitle">Título</label>
                <input type="text" id="weeklyBlockTitle" class="form-input" placeholder="Ej. Almuerzo, Deep work...">
            </div>
            <div class="form-group">
                <label class="form-label">Color</label>
                <div class="weekly-color-picker">${colorSwatches}</div>
            </div>
        </div>

        <div class="form-row">
            <div class="form-group">
                <label class="form-label" for="weeklyBlockDay">Día</label>
                <select id="weeklyBlockDay" class="form-select">${dayOptions}</select>
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label" for="weeklyBlockStart">Hora inicio</label>
                <input type="time" id="weeklyBlockStart" class="form-input" value="09:00">
            </div>
            <div class="form-group">
                <label class="form-label" for="weeklyBlockEnd">Hora fin</label>
                <input type="time" id="weeklyBlockEnd" class="form-input" value="10:00">
            </div>
        </div>
    `;
}

function _toMins(t) {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
}

function _esc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
