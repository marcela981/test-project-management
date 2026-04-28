/** Importación de tarjetas desde Nextcloud Deck. */

import { STATE }      from '../core/state.js';
import { fetchDeckBoards, fetchDeckCards, createTask, fetchTasks } from '../api/api.js';
import { renderBoard } from '../board/render.js';
import { formatDate }  from '../shared/utils.js';
import { CONFIG }      from '../core/config.js';
import { openModal, closeModal } from '../shared/modal.js';

const DONE_STACK_RE = /^(done|finalizado|finalizada|completed|completado|completada|terminado|terminada|finished|cerrado|cerrada)$/i;

const DECK_FILTER_TAGS = [
    'BTS', 'CAPITAL', 'CTYPTOX', 'DIGITAL ONE', 'FINANCIAL',
    'GCF', 'GLOBAL', 'HIGH PRIORITY', 'MEDIUM PRIORITY',
    'Prioridad Baja', 'RECURRENT',
];

const normalize = s => s.trim().toUpperCase();

let _deckCards       = [];
let _availableTags   = [];
let _searchQuery     = '';
let _selectedTags    = new Set();
let _filterPanelOpen = false;

// ── Filter pipeline ────────────────────────────────────────────────────────

function _isFinished(card) {
    if (card.archived === true) return true;
    const stackName = (typeof card.stack === 'string' ? card.stack : card.stack?.title) ?? '';
    return DONE_STACK_RE.test(stackName.trim());
}

function excludeFinishedStack(cards) {
    return cards.filter(c => !_isFinished(c));
}

function excludeImported(cards) {
    const importedIds = new Set(
        STATE.tasks.filter(t => t.deck_card_id).map(t => String(t.deck_card_id))
    );
    return cards.filter(c => !importedIds.has(String(c.id)));
}

function applySearch(cards) {
    if (!_searchQuery) return cards;
    const q = _searchQuery.toLowerCase();
    return cards.filter(c => c.title.toLowerCase().includes(q));
}

function getAvailableTags(cards) {
    const active = excludeImported(excludeFinishedStack(cards));
    const normalizedInFilter = new Set(DECK_FILTER_TAGS.map(normalize));
    const found = new Set();
    for (const card of active) {
        for (const label of (card.labels ?? [])) {
            const n = normalize(label);
            if (normalizedInFilter.has(n)) found.add(n);
        }
    }
    return DECK_FILTER_TAGS.filter(tag => found.has(normalize(tag)));
}

function applyTagFilter(cards) {
    if (_selectedTags.size === _availableTags.length) return cards;
    const normalizedSelected = new Set([..._selectedTags].map(normalize));
    return cards.filter(c => {
        if (!c.labels || c.labels.length === 0) return true;
        return c.labels.some(l => normalizedSelected.has(normalize(l)));
    });
}

function applyAllFilters() {
    return [excludeFinishedStack, excludeImported, applySearch, applyTagFilter]
        .reduce((acc, fn) => fn(acc), _deckCards);
}

// ── Render helpers ─────────────────────────────────────────────────────────

function _renderHeader() {
    const showFilter = _availableTags.length > 0;
    const deselected = _availableTags.length - _selectedTags.size;
    return `
        <div class="deck-filter-bar">
            <input id="deckCardSearch"
                   type="text"
                   class="form-control"
                   placeholder="Buscar tarjeta..."
                   value="${_searchQuery.replace(/"/g, '&quot;')}"
                   data-action="filter-deck-cards"
                   autocomplete="off">
            ${showFilter ? `
            <button class="deck-filter-btn" data-action="toggle-deck-filter-panel" title="Filtrar por etiqueta">
                <i class="fas fa-filter"></i>
                ${deselected > 0 ? `<span class="deck-filter-badge">${deselected}</span>` : ''}
            </button>` : ''}
        </div>
        ${showFilter && _filterPanelOpen ? _renderFilterPanel() : ''}`;
}

function _renderFilterPanel() {
    return `
        <div class="deck-filter-panel">
            <div class="deck-filter-panel-header">
                <span>Filtrar por etiqueta</span>
                <div>
                    <button class="deck-filter-panel-action" data-action="toggle-deck-select-all">Todos</button>
                    <button class="deck-filter-panel-action" data-action="toggle-deck-select-none">Ninguno</button>
                </div>
            </div>
            <div class="deck-filter-chips">
                ${_availableTags.map(tag => `
                    <button class="deck-filter-chip${_selectedTags.has(tag) ? ' selected' : ''}"
                            data-action="toggle-deck-tag"
                            data-tag="${tag}">${tag}</button>
                `).join('')}
            </div>
        </div>`;
}

function _refreshHeader() {
    const headerEl = document.getElementById('deckCardHeader');
    if (headerEl) headerEl.innerHTML = _renderHeader();
}

function renderFilteredList() {
    const filtered  = applyAllFilters();
    const container = document.getElementById('deckCardItems');
    const counter   = document.getElementById('deckCardCount');
    if (!container) return;

    if (filtered.length === 0) {
        container.innerHTML = `
            <p class="text-center text-muted" style="padding:.75rem 0;">
                No hay tarjetas que coincidan con los filtros.
            </p>`;
    } else {
        container.innerHTML = _renderCardItems(filtered);
        for (const deckId of STATE.selectedDeckCards) {
            const item = container.querySelector(`[data-deck-id="${deckId}"]`);
            if (item) {
                item.classList.add('selected');
                const icon = item.querySelector('.fa-check');
                if (icon) icon.style.display = 'block';
            }
        }
    }

    if (counter) counter.textContent = filtered.length;
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function openImportDeckModal() {
    STATE.selectedDeckCards.clear();
    _deckCards = [];

    const content = document.getElementById('deckModalContent');
    content.innerHTML = _loadingHtml('Loading your boards...');
    openModal('modalImportDeck');

    try {
        const boards = await fetchDeckBoards();

        if (boards.length === 0) {
            content.innerHTML = `
                <p class="text-center text-muted">
                    No se encontraron tableros en tu cuenta de Nextcloud Deck.
                </p>`;
            return;
        }

        const cardResults = await Promise.allSettled(boards.map(b => fetchDeckCards(b.id)));
        const boardsWithStatus = boards.map((b, i) => ({
            ...b,
            hasCards: cardResults[i].status === 'fulfilled' && cardResults[i].value.length > 0,
        }));

        content.innerHTML = `
            <div class="form-group mb-2">
                <label class="form-label" for="deckBoardSelect">
                    <i class="fas fa-columns"></i> Selecciona un tablero
                </label>
                <select id="deckBoardSelect" class="form-select"
                        data-action="select-deck-board">
                    <option value="">-- Elige un tablero --</option>
                    ${boardsWithStatus.map(b => `
                        <option value="${b.id}"${b.hasCards ? '' : ' disabled'}>
                            ${_boardTitle(b)}${b.hasCards ? '' : ' (sin tarjetas)'}
                        </option>
                    `).join('')}
                </select>
            </div>
            <div id="deckCardList"></div>`;

    } catch (err) {
        content.innerHTML = `<p class="text-center text-danger">
            <i class="fas fa-exclamation-circle"></i> ${err.message}
        </p>`;
    }
}

export async function selectDeckBoard(boardId) {
    STATE.selectedDeckCards.clear();
    _deckCards       = [];
    _availableTags   = [];
    _searchQuery     = '';
    _selectedTags    = new Set();
    _filterPanelOpen = false;

    const cardList = document.getElementById('deckCardList');
    if (!boardId) {
        cardList.innerHTML = '';
        return;
    }

    cardList.innerHTML = _loadingHtml('Loading cards...');

    try {
        _deckCards = await fetchDeckCards(boardId);

        if (excludeFinishedStack(_deckCards).length === 0) {
            cardList.innerHTML = `
                <p class="text-center text-muted">
                    No hay tarjetas activas para importar en este tablero.
                </p>`;
            return;
        }

        _availableTags = getAvailableTags(_deckCards);
        _selectedTags  = new Set(_availableTags);

        cardList.innerHTML = `
            <div id="deckCardHeader" style="margin-top:.75rem;">
                ${_renderHeader()}
            </div>
            <div class="form-label mb-1" style="margin-top:.5rem;">
                <i class="fas fa-credit-card"></i>
                Cards (<span id="deckCardCount">0</span>) — click to select
            </div>
            <div id="deckCardItems" class="deck-list"></div>`;

        renderFilteredList();

    } catch {
        _deckCards = [];
        cardList.innerHTML = `
            <p class="text-center text-muted">
                No se encontraron tarjetas para importar en este tablero.
            </p>`;
    }
}

export function filterDeckCards(query) {
    _searchQuery = query;
    renderFilteredList();
}

export function toggleDeckFilterPanel() {
    _filterPanelOpen = !_filterPanelOpen;
    _refreshHeader();
}

export function toggleDeckTag(tag) {
    if (_selectedTags.has(tag)) {
        _selectedTags.delete(tag);
    } else {
        _selectedTags.add(tag);
    }
    _refreshHeader();
    renderFilteredList();
}

export function selectAllDeckTags() {
    _selectedTags = new Set(_availableTags);
    _refreshHeader();
    renderFilteredList();
}

export function clearAllDeckTags() {
    _selectedTags = new Set();
    _refreshHeader();
    renderFilteredList();
}

export function toggleDeckSelection(deckId) {
    const item = document.querySelector(`[data-deck-id="${deckId}"]`);
    if (!item) return;

    if (STATE.selectedDeckCards.has(deckId)) {
        STATE.selectedDeckCards.delete(deckId);
        item.classList.remove('selected');
        item.querySelector('.fa-check').style.display = 'none';
    } else {
        STATE.selectedDeckCards.add(deckId);
        item.classList.add('selected');
        item.querySelector('.fa-check').style.display = 'block';
    }
}

export async function importSelectedDeckCards() {
    if (STATE.selectedDeckCards.size === 0) {
        alert('Please select at least one card to import.');
        return;
    }

    const btn = document.getElementById('btnImportSelected');
    if (btn) btn.disabled = true;

    const importedIds = new Set(
        STATE.tasks.filter(t => t.deck_card_id).map(t => String(t.deck_card_id))
    );

    let count = 0;
    for (const deckId of STATE.selectedDeckCards) {
        if (importedIds.has(String(deckId))) continue;

        const card = _deckCards.find(c => String(c.id) === String(deckId));
        if (!card) continue;

        try {
            await createTask({
                deck_card_id: card.id,
                title:        card.title,
                description:  card.description ?? '',
                column:       'actively-working',
                type:         'project',
                priority:     'medium',
                startDate:    new Date().toISOString().split('T')[0],
                deadline:     card.duedate ? card.duedate.split('T')[0] : null,
                subtasks:     [],
            });
            count++;
        } catch (err) {
            console.error(`[importSelectedDeckCards] Error al importar card ${deckId}:`, err);
        }
    }

    if (count === 0) {
        if (btn) btn.disabled = false;
        return;
    }

    if (CONFIG.BACKEND_URL) {
        try {
            const tareas = await fetchTasks();
            if (Array.isArray(tareas)) STATE.tasks = tareas;
        } catch (err) {
            console.error('[importSelectedDeckCards] Error al recargar tareas:', err);
        }
    }

    renderBoard();
    closeModal('modalImportDeck');
    alert(`${count} card(s) imported successfully!`);
    if (btn) btn.disabled = false;
}

// ── Private helpers ────────────────────────────────────────────────────────

function _renderCardItems(cards) {
    return cards.map(card => `
        <div class="deck-item"
             data-action="toggle-deck"
             data-deck-id="${card.id}">
            <div class="deck-item-checkbox">
                <i class="fas fa-check" style="display:none;"></i>
            </div>
            <div class="deck-item-content">
                <div class="deck-item-title">${card.title}</div>
                <div class="deck-item-meta">
                    ${card.duedate
                        ? `<i class="fas fa-calendar"></i> ${formatDate(card.duedate.split('T')[0])}`
                        : 'No deadline'}
                </div>
            </div>
        </div>`).join('');
}

function _loadingHtml(msg) {
    return `<p class="text-center text-muted">
        <i class="fas fa-spinner fa-spin"></i> ${msg}
    </p>`;
}

function _boardTitle(board) {
    return board.title || `Board ${board.id}`;
}
