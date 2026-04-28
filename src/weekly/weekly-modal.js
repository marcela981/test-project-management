/** Modal para agregar bloques al weekly tracker. */

import { STATE } from '../core/state.js';
import { getBlocks, createBlock, updateBlock, hasOverlap } from './weekly-data.js';
import { openModal, closeModal, registerDirtyCheck } from '../shared/modal.js';
import { formStateToRRule } from '../calendar/recurrence/rrule-expander.js';

const COLORS     = ['#e8b86d', '#f97316', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444'];
const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

let _formSnapshot        = null;
let _onSaved             = null;
let _pendingDay          = null;
let _pendingWeekStart    = null;
let _preselectedTask     = null;
let _selectedColor       = COLORS[0];
let _mode                = 'create'; // 'create' | 'edit'
let _pendingBlock        = null;
let _defaultStart        = '09:00';
let _defaultEnd          = '10:00';
let _selectedRecurrence  = 'none';
let _recurrenceUntil     = '';

function _getBlockFormState() {
    return {
        type:       document.getElementById('weeklyBlockType')?.value ?? '',
        task:       document.getElementById('weeklyBlockTask')?.value ?? '',
        title:      (document.getElementById('weeklyBlockTitle')?.value ?? '').trim(),
        day:        document.getElementById('weeklyBlockDay')?.value ?? '',
        start:      document.getElementById('weeklyBlockStart')?.value ?? '',
        end:        document.getElementById('weeklyBlockEnd')?.value ?? '',
        freq:       document.getElementById('weeklyBlockRecurrence')?.value ?? 'none',
        interval:   document.getElementById('weeklyRruleInterval')?.value ?? '1',
        unit:       document.getElementById('weeklyRruleUnit')?.value ?? 'weekly',
        days:       _getSelectedRruleDays(),
        until:      document.getElementById('weeklyBlockRecurrenceUntil')?.value ?? '',
    };
}

function _getSelectedRruleDays() {
    return [...(document.querySelectorAll('.rrule-day-cb:checked') ?? [])].map(cb => cb.value);
}

function _isBlockFormDirty() {
    if (!_formSnapshot) return false;
    return JSON.stringify(_getBlockFormState()) !== JSON.stringify(_formSnapshot);
}

registerDirtyCheck('modalWeeklyBlock', _isBlockFormDirty);

/**
 * Firma nueva:  openBlockModal({ mode, day, weekStartIso, preselectedTaskId?, block? }, onSaved)
 * Firma antigua: openBlockModal(day, weekStartIsoDate, onSaved, preselectedTaskId?)
 */
export function openBlockModal(dayOrOptions, weekStartOrSaved, onSaved, preselectedTaskId = null) {
    if (dayOrOptions !== null && typeof dayOrOptions === 'object') {
        const { mode = 'create', day, weekStartIso, preselectedTaskId: tid, block,
                startTime, endTime } = dayOrOptions;
        _mode                = mode;
        _pendingBlock        = block ?? null;
        _onSaved             = weekStartOrSaved;
        _pendingDay          = day;
        _pendingWeekStart    = weekStartIso;
        _preselectedTask     = tid != null ? String(tid) : null;
        _selectedColor       = block?.color ?? COLORS[0];
        _defaultStart        = startTime ?? '09:00';
        _defaultEnd          = endTime   ?? '10:00';
        _selectedRecurrence  = block?.recurrence ?? 'none';
        _recurrenceUntil     = block?.recurrence_until ?? '';
    } else {
        _mode                = 'create';
        _pendingBlock        = null;
        _onSaved             = onSaved;
        _pendingDay          = dayOrOptions;
        _pendingWeekStart    = weekStartOrSaved;
        _preselectedTask     = preselectedTaskId != null ? String(preselectedTaskId) : null;
        _selectedColor       = COLORS[0];
        _defaultStart        = '09:00';
        _defaultEnd          = '10:00';
        _selectedRecurrence  = 'none';
        _recurrenceUntil     = '';
    }
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

    const rruleState = _getBlockFormState();
    const rruleStr   = formStateToRRule({
        freq:     rruleState.freq,
        interval: rruleState.interval,
        unit:     rruleState.unit,
        days:     rruleState.days,
        until:    rruleState.until,
    });

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

    if (rruleStr) payload.rrule_string = rruleStr;

    const local        = getBlocks();
    const overlapCheck = { day, start_time: startTime, end_time: endTime };
    const excludeId    = _mode === 'edit' ? _pendingBlock?.id : null;
    if (hasOverlap(local, overlapCheck, excludeId)) {
        const ok = confirm('⚠️ Este bloque se solapa con otro existente. ¿Agregarlo de todas formas?');
        if (!ok) return;
    }

    let scope = null;
    if (_mode === 'edit' && (_pendingBlock?.series_id || _pendingBlock?.is_virtual)) {
        scope = await askScope();
        if (scope === null) return;
    }

    const saved = _mode === 'edit'
        ? await updateBlock(_pendingBlock.id, payload, scope)
        : await createBlock(payload);
    if (!saved) return;

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
    const body    = document.getElementById('modalWeeklyBlockBody');
    const isEdit  = _mode === 'edit';
    const block   = _pendingBlock;
    const bType   = isEdit
        ? (block.block_type === 'personal' ? 'personal' : 'task')
        : 'task';
    const disAttr = isEdit ? ' disabled' : '';

    const activeItems = STATE.tasks.filter(t => {
        if (t.type === 'activity') return (t.progress ?? 0) < 100;
        return t.column !== 'completed';
    });

    const dayOptions = DAY_LABELS.map((l, i) =>
        `<option value="${i}"${i === _pendingDay ? ' selected' : ''}>${l}</option>`
    ).join('');

    const preselectedId = isEdit
        ? String(block.task_id ?? block.activity_id ?? '')
        : _preselectedTask;

    const taskOptions = activeItems.length === 0
        ? '<option value="" disabled>No hay tareas disponibles en el board</option>'
        : activeItems.map(t => {
            const kind = t.type === 'activity' ? 'Actividad' : 'Tarea';
            const pri  = t.priority ? ` · ${t.priority}` : '';
            const sel  = String(t.id) === preselectedId ? ' selected' : '';
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
                <button type="button" class="weekly-type-btn${bType === 'task' ? ' active' : ''}"
                        data-action="weekly-type-tab" data-tab="task"${disAttr}>
                    <i class="fas fa-tasks"></i> Tarea / Actividad
                </button>
                <button type="button" class="weekly-type-btn${bType === 'personal' ? ' active' : ''}"
                        data-action="weekly-type-tab" data-tab="personal"${disAttr}>
                    <i class="fas fa-user"></i> Bloque personal
                </button>
            </div>
            <input type="hidden" id="weeklyBlockType" value="${bType}">
        </div>

        <div id="weeklyTaskFields"${bType !== 'task' ? ' style="display:none"' : ''}>
            <div class="form-group">
                <label class="form-label" for="weeklyBlockTask">Tarea / Actividad</label>
                <select id="weeklyBlockTask" class="form-select">
                    <option value="">-- Selecciona --</option>
                    ${taskOptions}
                </select>
            </div>
        </div>

        <div id="weeklyPersonalFields"${bType !== 'personal' ? ' style="display:none"' : ''}>
            <div class="form-group">
                <label class="form-label" for="weeklyBlockTitle">Título</label>
                <input type="text" id="weeklyBlockTitle" class="form-input"
                       placeholder="Ej. Almuerzo, Deep work..."
                       value="${_esc(isEdit ? (block.title ?? '') : '')}">
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
                <input type="time" id="weeklyBlockStart" class="form-input"
                       value="${isEdit ? block.start_time : _defaultStart}">
            </div>
            <div class="form-group">
                <label class="form-label" for="weeklyBlockEnd">Hora fin</label>
                <input type="time" id="weeklyBlockEnd" class="form-input"
                       value="${isEdit ? block.end_time : _defaultEnd}">
            </div>
        </div>

        ${_renderRecurrenceFields()}
    `;

    const modalEl   = document.getElementById('modalWeeklyBlock');
    const titleEl   = modalEl?.querySelector('.modal-title');
    const submitBtn = modalEl?.querySelector('[data-action="weekly-submit-block"]');
    if (titleEl)   titleEl.textContent = isEdit ? 'Editar bloque' : 'Agregar bloque';
    if (submitBtn) submitBtn.innerHTML = isEdit
        ? 'Guardar cambios'
        : '<i class="fas fa-plus"></i> Agregar';

    _bindRecurrenceEvents();
    _formSnapshot = _getBlockFormState();
}

function _renderRecurrenceFields() {
    const freq = _selectedRecurrence;
    const isCustom = freq === 'custom';
    const isWeekly = freq === 'weekly' || (isCustom);
    const showUntil = freq !== 'none';

    const DAY_OPTIONS = [
        ['MO','Lun'],['TU','Mar'],['WE','Mié'],['TH','Jue'],['FR','Vie'],['SA','Sáb'],['SU','Dom'],
    ];

    const dayChecks = DAY_OPTIONS.map(([val, label]) =>
        `<label class="rrule-day-label">
            <input type="checkbox" class="rrule-day-cb" value="${val}"> ${label}
        </label>`
    ).join('');

    return `
        <div class="form-group">
            <label class="form-label" for="weeklyBlockRecurrence">Repetición</label>
            <select id="weeklyBlockRecurrence" class="form-select">
                <option value="none"${freq === 'none'    ? ' selected' : ''}>No repetir</option>
                <option value="daily"${freq === 'daily'  ? ' selected' : ''}>Cada día</option>
                <option value="weekly"${freq === 'weekly'? ' selected' : ''}>Cada semana</option>
                <option value="monthly"${freq === 'monthly'?' selected':''}>Cada mes</option>
                <option value="yearly"${freq === 'yearly' ? ' selected' : ''}>Cada año</option>
                <option value="custom"${freq === 'custom' ? ' selected' : ''}>Personalizado...</option>
            </select>
        </div>

        <div id="weeklyRecurrenceCustomGroup" class="form-group" style="${!isCustom ? 'display:none' : ''}">
            <div class="rrule-custom-row">
                <span class="rrule-custom-label">Cada</span>
                <input type="number" id="weeklyRruleInterval" class="form-input rrule-interval"
                       value="1" min="1" max="99">
                <select id="weeklyRruleUnit" class="form-select rrule-unit">
                    <option value="daily">días</option>
                    <option value="weekly" selected>semanas</option>
                    <option value="monthly">meses</option>
                    <option value="yearly">años</option>
                </select>
            </div>
            <div id="weeklyRruleDaysGroup" class="rrule-days-group" style="${!isWeekly ? 'display:none' : ''}">
                ${dayChecks}
            </div>
        </div>

        <div class="form-group" id="weeklyRecurrenceUntilGroup"
             style="${!showUntil ? 'display:none' : ''}">
            <label class="form-label" for="weeklyBlockRecurrenceUntil">Hasta (opcional)</label>
            <input type="date" id="weeklyBlockRecurrenceUntil" class="form-input"
                   value="${_esc(_recurrenceUntil)}">
        </div>`;
}

function _bindRecurrenceEvents() {
    const freqSel  = document.getElementById('weeklyBlockRecurrence');
    const customGr = document.getElementById('weeklyRecurrenceCustomGroup');
    const untilGr  = document.getElementById('weeklyRecurrenceUntilGroup');
    const unitSel  = document.getElementById('weeklyRruleUnit');
    const daysGr   = document.getElementById('weeklyRruleDaysGroup');

    function _syncVisibility() {
        const freq     = freqSel?.value ?? 'none';
        const isCustom = freq === 'custom';
        const showDays = isCustom && (unitSel?.value ?? 'weekly') === 'weekly';
        if (customGr) customGr.style.display = isCustom ? '' : 'none';
        if (untilGr)  untilGr.style.display  = freq !== 'none' ? '' : 'none';
        if (daysGr)   daysGr.style.display   = showDays ? '' : 'none';
    }

    freqSel?.addEventListener('change', _syncVisibility);
    unitSel?.addEventListener('change', _syncVisibility);
}

export function askScope() {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'scope-dialog-overlay';
        overlay.innerHTML = `
            <div class="scope-dialog">
                <p class="scope-dialog-question">Aplicar cambios a:</p>
                <div class="scope-dialog-actions">
                    <button type="button" class="btn btn-secondary btn-sm" data-scope="this">Sólo este</button>
                    <button type="button" class="btn btn-secondary btn-sm" data-scope="future">Este y futuros</button>
                    <button type="button" class="btn btn-secondary btn-sm" data-scope="all">Toda la serie</button>
                </div>
                <button type="button" class="btn btn-sm scope-dialog-cancel" data-scope="cancel">Cancelar</button>
            </div>`;

        overlay.addEventListener('click', e => {
            const btn = e.target.closest('[data-scope]');
            if (!btn) return;
            overlay.remove();
            resolve(btn.dataset.scope === 'cancel' ? null : btn.dataset.scope);
        });

        document.body.appendChild(overlay);
    });
}

function _toMins(t) {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
}

function _esc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
