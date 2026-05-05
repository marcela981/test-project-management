/** Vista: Panel de administración – leaders y admins. */

import {
    fetchAdminUsers,
    fetchTeams, createTeam, updateTeam, deleteTeam,
    addTeamMember, removeTeamMember, setUserRole, syncUserFromNC,
} from '../dashboard/dashApi.js';
import { escHtml as _esc, initials as _initials } from '../shared/utils.js';
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import DownloadMetricsModal from './components/DownloadMetricsModal.jsx';

let _user     = null;
let _allTeams = [];

const _PRIVILEGED = new Set(['admin', 'leader', 'supervisor']);
let _metricsModalContainer = null;
let _metricsModalRoot      = null;

function _renderMetricsModal(isOpen) {
    _metricsModalRoot.render(
        h(DownloadMetricsModal, { isOpen, onClose: () => _renderMetricsModal(false) })
    );
}

function _openMetricsModal() {
    if (!_metricsModalContainer) {
        _metricsModalContainer = document.createElement('div');
        document.body.appendChild(_metricsModalContainer);
        _metricsModalRoot = createRoot(_metricsModalContainer);
    }
    _renderMetricsModal(true);
}

export async function renderAdmin(container, user) {
    _user = user;
    const isAdmin = user.role === 'admin';

    const tabs = [
        { id: 'my-team', label: '<i class="fas fa-users"></i> Mi Equipo' },
        ...(isAdmin ? [
            { id: 'teams', label: '<i class="fas fa-sitemap"></i> Equipos' },
        ] : []),
    ];

    container.innerHTML = `
        <div class="view-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem">
            <h2 class="view-title"><i class="fas fa-cog"></i> Administración</h2>
            ${_PRIVILEGED.has(user.role) ? `
            <button class="btn btn-primary btn-sm" id="btnDownloadMetrics">
                <i class="fas fa-download"></i> Descargar Métricas
            </button>` : ''}
        </div>
        <div class="skills-tabs">
            ${tabs.map((t, i) => `
                <button class="skills-tab${i === 0 ? ' active' : ''}" data-tab="${t.id}">${t.label}</button>
            `).join('')}
        </div>
        <div id="adminContent">
            <div class="loading-state"><i class="fas fa-spinner fa-spin"></i> Cargando…</div>
        </div>`;

    container.querySelector('#btnDownloadMetrics')?.addEventListener('click', _openMetricsModal);

    container.querySelectorAll('.skills-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            container.querySelectorAll('.skills-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            _loadTab(container, tab.dataset.tab);
        });
    });

    await _loadTab(container, 'my-team');
}

async function _loadTab(container, tab) {
    switch (tab) {
        case 'my-team': return _loadMyTeam(container);
        case 'teams':   return _loadTeams(container);
    }
}

// ─── My Team ────────────────────────────────────────────────────────────────

async function _loadMyTeam(container) {
    const content     = container.querySelector('#adminContent');
    content.innerHTML = '<div class="loading-state"><i class="fas fa-spinner fa-spin"></i> Cargando…</div>';

    const isAdmin    = _user?.role === 'admin';
    const viewerRole = _user?.role ?? 'member';
    const viewerNcId = _user?.id;

    try {
        const [allUsers, allTeams] = await Promise.all([fetchAdminUsers().catch(() => []), fetchTeams().catch(() => [])]);

        _allTeams = allTeams ?? [];

        let html = '';

        if (isAdmin) {
            if (!_allTeams.length) {
                content.innerHTML = '<div class="empty-state">No hay equipos registrados.</div>';
                return;
            }
            html = _allTeams.map(t => {
                const members    = (allUsers ?? []).filter(u => u.teamId === t.id);
                const nonMembers = (allUsers ?? []).filter(u => u.teamId !== t.id);
                return _renderTeamCard(t.id, t.name, members, nonMembers, viewerRole, viewerNcId);
            }).join('');
        } else {
            const myTeamId   = _user?.teamId;
            const myTeam     = _allTeams.find(t => t.id === myTeamId);
            const teamName   = myTeam?.name ?? '—';
            const members    = (allUsers ?? []).filter(u => u.teamId === myTeamId);
            const nonMembers = (allUsers ?? []).filter(u =>
                u.teamId !== myTeamId && u.ncUserId !== viewerNcId
            );

            if (!myTeamId) {
                content.innerHTML = '<div class="empty-state">No estás asignado a ningún equipo.</div>';
                return;
            }
            html = _renderTeamCard(myTeamId, teamName, members, nonMembers, viewerRole, viewerNcId);
        }

        content.innerHTML = html;

        if (isAdmin) {
            _allTeams.forEach(t => _bindTeamEvents(content, t.id, container, allUsers ?? []));
        } else {
            _bindTeamEvents(content, _user?.teamId, container, allUsers ?? []);
        }

    } catch (err) {
        content.innerHTML = `<div class="error-state"><i class="fas fa-exclamation-circle"></i> ${_esc(err.message)}</div>`;
    }
}

function _renderTeamCard(teamId, teamName, members, nonMembers, viewerRole, viewerNcId) {
    const tid = teamId;
    return `
        <div class="section-card" style="margin-bottom:1.5rem">
            <div class="section-title-row">
                <h3 class="section-title"><i class="fas fa-users"></i> ${_esc(teamName)}</h3>
                <button class="btn btn-primary btn-sm" id="btnShowAddMember_${tid}">
                    <i class="fas fa-user-plus"></i> Añadir miembro
                </button>
            </div>

            ${nonMembers.length ? `
            <div id="addMemberRow_${tid}" class="add-member-row" style="display:none">
                <select class="form-select form-select-sm" id="selectAddUser_${tid}">
                    <option value="">— Selecciona usuario —</option>
                    ${nonMembers.map(u => {
                        const val  = _esc(u.ncUserId ?? u.id ?? '');
                        const name = _esc(u.displayName || u.displayname || u.ncUserId || u.id || '');
                        return `<option value="${val}">${name}</option>`;
                    }).join('')}
                </select>
                <button class="btn btn-success btn-sm" id="btnConfirmAdd_${tid}">Añadir</button>
                <button class="btn btn-secondary btn-sm" id="btnCancelAdd_${tid}">Cancelar</button>
            </div>` : ''}

            <div class="table-wrapper">
                <table class="data-table">
                    <thead><tr>
                        <th>Miembro</th>
                        <th>Rol principal</th>
                        <th>Rol secundario</th>
                        <th></th>
                    </tr></thead>
                    <tbody>
                        ${members.length
                            ? members.map(m => _memberRow(m, tid, viewerRole, viewerNcId)).join('')
                            : `<tr><td colspan="4" style="text-align:center;padding:1rem;color:var(--color-muted)">Sin miembros</td></tr>`}
                    </tbody>
                </table>
            </div>
        </div>`;
}

function _memberRow(m, teamId, viewerRole, viewerNcId) {
    const uid      = _esc(m.id ?? '');
    const name     = _esc(m.displayName || m.displayname || m.ncUserId || '');
    const role     = m.role ?? 'member';
    const jobTitle = _esc(m.jobTitle ?? '—');
    const isSelf   = m.ncUserId === viewerNcId;

    const showMenu = !isSelf && (
        viewerRole === 'admin' ||
        (viewerRole === 'leader' && role === 'member')
    );

    const roleBadge = `<span class="role-badge role-${role}">${role}</span>`;

    const menuHtml = showMenu ? `
        <div class="action-menu-wrapper">
            <button class="btn-dots" data-action="toggle-member-menu" data-uid="${uid}" data-team-id="${teamId}">
                <i class="fas fa-ellipsis-v"></i>
            </button>
            <div class="action-dropdown" id="memberMenu_${uid}">
                <button class="dropdown-item" data-action="move-team" data-uid="${uid}" data-team-id="${teamId}">
                    <i class="fas fa-exchange-alt"></i> Mover de equipo
                </button>
                <button class="dropdown-item" data-action="change-role" data-uid="${uid}" data-team-id="${teamId}">
                    <i class="fas fa-user-tag"></i> Cambiar de rol
                </button>
                <button class="dropdown-item" data-action="sync-nc" data-uid="${uid}" data-team-id="${teamId}">
                    <i class="fas fa-sync-alt"></i> Sincronizar NC
                </button>
                <div class="dropdown-divider"></div>
                <button class="dropdown-item dropdown-item-danger" data-action="remove-member" data-uid="${uid}" data-team-id="${teamId}">
                    <i class="fas fa-user-minus"></i> Eliminar del equipo
                </button>
            </div>
        </div>` : '';

    return `
        <tr>
            <td><div class="member-cell">
                <div class="member-avatar">${_initials(m.displayName || m.ncUserId)}</div>
                <span>${name}</span>
            </div></td>
            <td>${roleBadge}</td>
            <td><span class="text-muted text-sm">${jobTitle}</span></td>
            <td class="actions-cell">${menuHtml}</td>
        </tr>`;
}

function _bindTeamEvents(content, teamId, container, allUsers) {
    const tid = teamId;

    // ── Añadir miembro ────────────────────────────────────────────────────────
    content.querySelector(`#btnShowAddMember_${tid}`)?.addEventListener('click', () => {
        const row = content.querySelector(`#addMemberRow_${tid}`);
        if (row) row.style.display = row.style.display === 'none' ? 'flex' : 'none';
    });
    content.querySelector(`#btnCancelAdd_${tid}`)?.addEventListener('click', () => {
        const row = content.querySelector(`#addMemberRow_${tid}`);
        if (row) row.style.display = 'none';
    });
    content.querySelector(`#btnConfirmAdd_${tid}`)?.addEventListener('click', async () => {
        const sel = content.querySelector(`#selectAddUser_${tid}`);
        const uid = sel?.value;
        if (!uid || !tid) return;
        try {
            await addTeamMember(tid, uid);
            const addedName = sel.options[sel.selectedIndex]?.text ?? uid;
            await _loadMyTeam(container);
            alert(`${addedName} fue agregado al equipo.`);
        } catch (err) { alert('Error: ' + err.message); }
    });

    // ── Toggle ⋮ ──────────────────────────────────────────────────────────────
    content.querySelectorAll(`[data-action="toggle-member-menu"][data-team-id="${tid}"]`).forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const menu = document.getElementById(`memberMenu_${btn.dataset.uid}`);
            const isOpen = menu?.classList.contains('open');
            _closeAllDropdowns(content);
            if (!isOpen && menu) menu.classList.add('open');
        });
    });

    // Prevent clicks inside any open dropdown (including injected sub-forms with <select>)
    // from bubbling to document and triggering the global close-all listener.
    content.querySelectorAll(`.action-dropdown`).forEach(menu => {
        menu.addEventListener('click', e => e.stopPropagation());
    });

    // ── Mover de equipo ───────────────────────────────────────────────────────
    content.querySelectorAll(`[data-action="move-team"][data-team-id="${tid}"]`).forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const uid    = btn.dataset.uid;
            const menu   = document.getElementById(`memberMenu_${uid}`);
            const others = _allTeams.filter(t => t.id !== tid);

            if (!others.length) {
                alert('No hay otros equipos disponibles.');
                menu?.classList.remove('open');
                return;
            }

            menu.innerHTML = `
                <div class="dropdown-sub-form">
                    <span class="dropdown-label">Mover a:</span>
                    <select class="form-select form-select-sm" id="moveTeamSel_${uid}">
                        ${others.map(t => `<option value="${t.id}">${_esc(t.name)}</option>`).join('')}
                    </select>
                    <div class="dropdown-sub-actions">
                        <button class="btn btn-success btn-sm" id="confirmMove_${uid}">Mover</button>
                        <button class="btn btn-secondary btn-sm" id="cancelMove_${uid}">×</button>
                    </div>
                </div>`;

            document.getElementById(`confirmMove_${uid}`)?.addEventListener('click', async () => {
                const newTid = parseInt(document.getElementById(`moveTeamSel_${uid}`)?.value);
                const member = allUsers.find(u => String(u.id) === uid);
                if (!member) return;
                try {
                    await addTeamMember(newTid, member.ncUserId);
                    await _loadMyTeam(container);
                } catch (err) { alert('Error: ' + err.message); }
            });
            document.getElementById(`cancelMove_${uid}`)?.addEventListener('click', () => {
                menu?.classList.remove('open');
            });
        });
    });

    // ── Cambiar de rol ────────────────────────────────────────────────────────
    content.querySelectorAll(`[data-action="change-role"][data-team-id="${tid}"]`).forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const uid       = btn.dataset.uid;
            const menu      = document.getElementById(`memberMenu_${uid}`);
            const member    = allUsers.find(u => String(u.id) === uid);
            const curRole   = member?.role ?? 'member';
            const isAdmin   = _user?.role === 'admin';

            const roles = isAdmin
                ? [{ v: 'member', l: 'Miembro' }, { v: 'leader', l: 'Líder' }, { v: 'admin', l: 'Admin' }]
                : [{ v: 'member', l: 'Miembro' }];

            menu.innerHTML = `
                <div class="dropdown-sub-form">
                    <span class="dropdown-label">Nuevo rol:</span>
                    <select class="form-select form-select-sm" id="changeRoleSel_${uid}">
                        ${roles.map(r => `<option value="${r.v}"${r.v === curRole ? ' selected' : ''}>${r.l}</option>`).join('')}
                    </select>
                    <div class="dropdown-sub-actions">
                        <button class="btn btn-success btn-sm" id="confirmRole_${uid}">Cambiar</button>
                        <button class="btn btn-secondary btn-sm" id="cancelRole_${uid}">×</button>
                    </div>
                </div>`;

            document.getElementById(`confirmRole_${uid}`)?.addEventListener('click', async () => {
                const newRole = document.getElementById(`changeRoleSel_${uid}`)?.value;
                try {
                    await setUserRole(uid, newRole);
                    await _loadMyTeam(container);
                } catch (err) { alert('Error: ' + err.message); }
            });
            document.getElementById(`cancelRole_${uid}`)?.addEventListener('click', () => {
                menu?.classList.remove('open');
            });
        });
    });

    // ── Sincronizar NC ────────────────────────────────────────────────────────
    content.querySelectorAll(`[data-action="sync-nc"][data-team-id="${tid}"]`).forEach(btn => {
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            _closeAllDropdowns(content);
            const uid  = btn.dataset.uid;
            const name = allUsers.find(u => String(u.id) === uid)?.displayName ?? uid;
            try {
                const res = await syncUserFromNC(uid);
                await _loadMyTeam(container);
                alert(`${name} sincronizado: rol → ${res.user.role}`);
            } catch (err) { alert('Error al sincronizar: ' + err.message); }
        });
    });

    // ── Eliminar del equipo ───────────────────────────────────────────────────
    content.querySelectorAll(`[data-action="remove-member"][data-team-id="${tid}"]`).forEach(btn => {
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            if (!confirm('¿Remover a este miembro del equipo?')) return;
            try {
                await removeTeamMember(btn.dataset.teamId, btn.dataset.uid);
                await _loadMyTeam(container);
            } catch (err) { alert('Error: ' + err.message); }
        });
    });
}

function _closeAllDropdowns(root) {
    (root ?? document).querySelectorAll('.action-dropdown.open').forEach(m => m.classList.remove('open'));
}

// Cerrar dropdowns al hacer click fuera
document.addEventListener('click', () => _closeAllDropdowns(document));

// ─── Teams (admin only) ──────────────────────────────────────────────────────

async function _loadTeams(container) {
    const content = container.querySelector('#adminContent');
    content.innerHTML = '<div class="loading-state"><i class="fas fa-spinner fa-spin"></i> Cargando…</div>';
    try {
        const teams = await fetchTeams();
        content.innerHTML = `
            <div class="section-card">
                <div class="section-title-row">
                    <h3 class="section-title"><i class="fas fa-sitemap"></i> Equipos</h3>
                    <button class="btn btn-primary btn-sm" id="btnNewTeam">
                        <i class="fas fa-plus"></i> Nuevo equipo
                    </button>
                </div>
                <div id="newTeamForm" class="inline-form" style="display:none">
                    <input type="text" class="form-input form-input-sm" id="newTeamName" placeholder="Nombre del equipo">
                    <label class="form-check-label">
                        <input type="checkbox" id="newTeamIsTech"> Tech team
                    </label>
                    <button class="btn btn-success btn-sm" id="btnSaveNewTeam">Crear</button>
                    <button class="btn btn-secondary btn-sm" id="btnCancelNewTeam">Cancelar</button>
                </div>
                <div class="table-wrapper">
                    <table class="data-table">
                        <thead><tr>
                            <th>Nombre</th>
                            <th>Tech team</th>
                            <th>Miembros</th>
                            <th>Acciones</th>
                        </tr></thead>
                        <tbody>
                            ${(teams ?? []).map(t => `
                            <tr id="teamRow_${t.id}">
                                <td>
                                    <input type="text" class="form-input form-input-sm team-name-input"
                                        value="${_esc(t.name)}" data-team-id="${t.id}">
                                </td>
                                <td>
                                    <input type="checkbox" class="team-tech-input" data-team-id="${t.id}"
                                        ${t.isTechTeam ? 'checked' : ''}>
                                </td>
                                <td>${t.memberCount ?? 0}</td>
                                <td>
                                    <button class="btn btn-secondary btn-sm" data-action="save-team" data-team-id="${t.id}">
                                        <i class="fas fa-save"></i>
                                    </button>
                                    <button class="btn btn-danger btn-sm" data-action="delete-team" data-team-id="${t.id}">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </td>
                            </tr>`).join('')}
                        </tbody>
                    </table>
                </div>
            </div>`;

        content.querySelector('#btnNewTeam').addEventListener('click', () => {
            content.querySelector('#newTeamForm').style.display = 'flex';
        });
        content.querySelector('#btnCancelNewTeam').addEventListener('click', () => {
            content.querySelector('#newTeamForm').style.display = 'none';
        });
        content.querySelector('#btnSaveNewTeam').addEventListener('click', async () => {
            const name = content.querySelector('#newTeamName').value.trim();
            if (!name) return;
            const isTechTeam = content.querySelector('#newTeamIsTech').checked;
            try {
                await createTeam({ name, isTechTeam });
                _loadTeams(container);
            } catch (err) { alert('Error: ' + err.message); }
        });
        content.querySelectorAll('[data-action="save-team"]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const tid  = btn.dataset.teamId;
                const name = content.querySelector(`.team-name-input[data-team-id="${tid}"]`)?.value.trim();
                const tech = content.querySelector(`.team-tech-input[data-team-id="${tid}"]`)?.checked;
                try { await updateTeam(tid, { name, isTechTeam: tech }); }
                catch (err) { alert('Error: ' + err.message); }
            });
        });
        content.querySelectorAll('[data-action="delete-team"]').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('¿Eliminar este equipo?')) return;
                try { await deleteTeam(btn.dataset.teamId); _loadTeams(container); }
                catch (err) { alert('Error: ' + err.message); }
            });
        });

    } catch (err) {
        content.innerHTML = `<div class="error-state"><i class="fas fa-exclamation-circle"></i> ${_esc(err.message)}</div>`;
    }
}

