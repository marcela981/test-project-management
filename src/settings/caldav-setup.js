/** CalDAV App Password setup — injected into the settings panel. */

import { CONFIG } from '../core/config.js';
import { authedFetch, apiFetch } from '../api/http.js';

const SECTION_ID = 'caldav-setup-section';
const BANNER_ID  = 'caldav-setup-banner';
const BASE       = `${CONFIG.BACKEND_BASE_URL}/api/settings`;

// Register global banner trigger once at module load.
window.addEventListener('caldav-setup-required', () => _ensureBanner());

// ── public API ──────────────────────────────────────────────────────────────

/** Inject the CalDAV section into the settings panel body (idempotent). */
export async function injectCalDAVSection() {
    const body = document.querySelector('#settingsPanel .settings-body');
    if (!body || document.getElementById(SECTION_ID)) return;

    const section = document.createElement('div');
    section.id = SECTION_ID;
    section.innerHTML = `
        <div class="settings-section-title" style="margin-top:1rem">Calendario Nextcloud</div>
        <div id="caldav-status-area" style="font-size:.9rem"><em>Cargando...</em></div>
    `;
    body.appendChild(section);
    await _loadStatus();
}

// ── status rendering ────────────────────────────────────────────────────────

async function _loadStatus() {
    const area = document.getElementById('caldav-status-area');
    if (!area) return;
    try {
        const data = await apiFetch('/api/settings/caldav-credential');
        _renderStatus(area, data);
    } catch {
        area.innerHTML = `<p style="color:#dc2626">Error al cargar el estado del calendario.</p>`;
    }
}

function _renderStatus(area, data) {
    if (data.configured) {
        const dateLabel = data.set_at
            ? new Date(data.set_at).toLocaleDateString('es-CO', {
                year: 'numeric', month: 'short', day: 'numeric',
              })
            : 'fecha desconocida';
        area.innerHTML = `
            <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.75rem">
                <i class="fas fa-check-circle" style="color:#16a34a"></i>
                <span>Conectado desde ${dateLabel}</span>
            </div>
            <div style="display:flex;gap:.5rem">
                <button class="btn btn-secondary" id="btnCalDAVReplace" style="font-size:.85rem">
                    <i class="fas fa-sync-alt"></i> Reemplazar
                </button>
                <button class="btn btn-secondary" id="btnCalDAVDisconnect"
                        style="font-size:.85rem;color:#dc2626;border-color:#dc2626">
                    <i class="fas fa-unlink"></i> Desconectar
                </button>
            </div>
        `;
        document.getElementById('btnCalDAVReplace')
            ?.addEventListener('click', () => _showForm(area, true));
        document.getElementById('btnCalDAVDisconnect')
            ?.addEventListener('click', () => _disconnect(area));
    } else {
        _showForm(area, false);
    }
}

// ── form ────────────────────────────────────────────────────────────────────

function _showForm(area, isReplace) {
    area.innerHTML = `
        <p style="margin-bottom:.75rem;line-height:1.5">
            Genera un App Password en Nextcloud para conectar tu calendario:<br><br>
            <strong>1.</strong> Ve a
            <a href="https://portal.gcf.group/settings/user/security" target="_blank" rel="noopener"
               style="color:var(--color-primary,#4f46e5)">
                Configuración → Seguridad → App passwords
            </a><br>
            <strong>2.</strong> Nombre: <code>Activity Tracker</code> → Generar.<br>
            <strong>3.</strong> Copia y pega la contraseña abajo.
        </p>
        <div class="form-group">
            <label class="form-label" for="caldavAppPassword">App Password</label>
            <input type="password" id="caldavAppPassword" class="form-select"
                   placeholder="xxxx-xxxx-xxxx-xxxx-xxxx"
                   autocomplete="new-password" spellcheck="false">
        </div>
        <div id="caldav-form-msg" style="min-height:1.2em;font-size:.85rem;margin-bottom:.5rem"></div>
        <div style="display:flex;gap:.5rem">
            <button class="btn btn-primary" id="btnCalDAVSave">
                <i class="fas fa-shield-alt"></i> Validar y guardar
            </button>
            ${isReplace
                ? `<button class="btn btn-secondary" id="btnCalDAVCancelReplace">Cancelar</button>`
                : ''}
        </div>
    `;
    document.getElementById('btnCalDAVSave')
        ?.addEventListener('click', () => _save(area));
    document.getElementById('btnCalDAVCancelReplace')
        ?.addEventListener('click', () => _loadStatus());

    // Allow Enter key to submit
    document.getElementById('caldavAppPassword')
        ?.addEventListener('keydown', e => { if (e.key === 'Enter') _save(area); });
}

async function _save(area) {
    const input = document.getElementById('caldavAppPassword');
    const msg   = document.getElementById('caldav-form-msg');
    const btn   = document.getElementById('btnCalDAVSave');
    const pw    = input?.value?.trim() ?? '';

    if (pw.length < 10) {
        _setMsg(msg, 'La contraseña debe tener al menos 10 caracteres.', 'error');
        return;
    }
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Validando...';
    _setMsg(msg, '', '');

    try {
        const res = await authedFetch(`${BASE}/caldav-credential`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ app_password: pw }),
        });
        if (!res) return; // logout occurred

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            _setMsg(msg, err.detail || `Error ${res.status}`, 'error');
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-shield-alt"></i> Validar y guardar';
            return;
        }

        const data = await res.json();
        _hideCalDAVBanner();
        _setMsg(msg, '¡Conectado exitosamente!', 'ok');
        setTimeout(() => _renderStatus(area, { configured: true, set_at: data.set_at }), 900);
    } catch (err) {
        _setMsg(msg, err.message || 'Error de red.', 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-shield-alt"></i> Validar y guardar';
    }
}

async function _disconnect(area) {
    if (!confirm('¿Desconectar el calendario?\nLos eventos de Nextcloud no aparecerán hasta que lo reconectes.')) return;
    try {
        await apiFetch('/api/settings/caldav-credential', { method: 'DELETE' });
        _renderStatus(area, { configured: false, set_at: null });
    } catch {
        alert('Error al desconectar. Intente de nuevo.');
    }
}

// ── banner ──────────────────────────────────────────────────────────────────

function _ensureBanner() {
    if (document.getElementById(BANNER_ID)) return;

    const banner = document.createElement('div');
    banner.id = BANNER_ID;
    Object.assign(banner.style, {
        background: '#fef3c7',
        borderBottom: '1px solid #f59e0b',
        color: '#92400e',
        padding: '.5rem 1rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
        fontSize: '.9rem',
        zIndex: '1000',
        position: 'relative',
    });
    banner.innerHTML = `
        <span>
            <i class="fas fa-calendar-times" style="margin-right:.4rem"></i>
            Conecta tu calendario de Nextcloud para ver eventos en el planeador.
        </span>
        <div style="display:flex;gap:.5rem;align-items:center;flex-shrink:0">
            <button class="btn btn-secondary" data-action="open-settings"
                    style="font-size:.8rem;padding:.2rem .6rem">
                <i class="fas fa-cog"></i> Ajustes
            </button>
            <button id="caldav-banner-close"
                    style="background:none;border:none;cursor:pointer;font-size:1rem;color:#92400e"
                    aria-label="Cerrar aviso">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;
    // Insert right after <header> if present, otherwise at top of body.
    const header = document.querySelector('header.header');
    if (header?.nextSibling) {
        header.parentNode.insertBefore(banner, header.nextSibling);
    } else {
        document.body.prepend(banner);
    }
    document.getElementById('caldav-banner-close')
        ?.addEventListener('click', () => banner.remove());
}

function _hideCalDAVBanner() {
    document.getElementById(BANNER_ID)?.remove();
}

// ── util ─────────────────────────────────────────────────────────────────────

function _setMsg(el, text, type) {
    if (!el) return;
    el.textContent = text;
    el.style.color = type === 'error' ? '#dc2626' : type === 'ok' ? '#16a34a' : '';
}
