/**
 * pages/settings.js
 * Settings & Administration page management
 */

import { esc, formatBytes } from '../core/utils.js';
import { toast, showToast } from '../core/toast.js';
import { api } from '../core/api.js';

// Alias for escapeHtml used throughout settings
const escapeHtml = esc;


', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    , 3500);
    }

    // Header Actions Dropdown Handler
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const appHeader = document.querySelector('.settings-desktop-menu .app-header');
    if (mobileMenuBtn && appHeader) {
      const closeMenu = () => {
        appHeader.classList.remove('mobile-menu-open');
        mobileMenuBtn.setAttribute('aria-expanded', 'false');
        mobileMenuBtn.textContent = '☰';
      };
      mobileMenuBtn.addEventListener('click', e => {
        e.stopPropagation();
        const open = appHeader.classList.toggle('mobile-menu-open');
        mobileMenuBtn.setAttribute('aria-expanded', String(open));
        mobileMenuBtn.textContent = open ? '×' : '☰';
      });
      document.addEventListener('click', e => {
        if (!appHeader.classList.contains('mobile-menu-open') || e.target.closest('.app-header')) return;
        closeMenu();
      });
    }

    // ==========================================
    // TAB NAVIGATION
    // ==========================================
    const tabButtons = document.querySelectorAll('.settings-tab-btn');
    const tabPanes = {
      backup: document.getElementById('paneBackup'),
      security: document.getElementById('paneSecurity'),
      history: document.getElementById('paneHistory'),
      upload: document.getElementById('paneUpload'),
      timezone: document.getElementById('paneTimezone'),
      apilogs: document.getElementById('paneApiLogs'),
      cards: document.getElementById('paneCards'),
      danger: document.getElementById('paneDanger')
    };

    function switchTab(targetTab, options = {}) {
      if (!tabPanes[targetTab]) targetTab = 'backup';

      tabButtons.forEach(btn => {
        const isMatch = btn.dataset.tab === targetTab;
        btn.classList.toggle('active', isMatch);
        btn.setAttribute('aria-selected', isMatch ? 'true' : 'false');
      });

      Object.entries(tabPanes).forEach(([name, pane]) => {
        if (!pane) return;
        const isMatch = name === targetTab;
        pane.classList.toggle('active', isMatch);
        pane.style.display = isMatch ? 'block' : 'none';
      });

      // Update URL query string without page refresh
      const url = new URL(window.location.href);
      url.searchParams.set('tab', targetTab);

      // Clean up filter params when leaving a tab or switching tabs so they don't persist everywhere
      if (!options.preserveFilters) {
        const filterParamsToRemove = [
          'version', 'version_id', 'q', 'history_q', 'date',
          'source', 'history_source', 'device', 'ip', 'status',
          'method', 'limit', 'offset'
        ];
        filterParamsToRemove.forEach(p => url.searchParams.delete(p));
      }

      window.history.replaceState({}, '', url.pathname + url.search);

      // Lazy load tab contents when opened
      if (targetTab === 'backup') loadBackups();
      if (targetTab === 'security') runAudit();
      if (targetTab === 'history') loadVersions();
      if (targetTab === 'timezone') loadTimezoneSettings();
      if (targetTab === 'cards') loadFlightsSummary();
      if (targetTab === 'apilogs') {
        loadApiLogs();
        if (apiLivePollingActive) startApiLivePolling();
      } else {
        stopApiLivePolling();
      }
    }

    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // ==========================================
    // TIMEZONE HELPER
    // ==========================================
    let currentAppTimezoneMode = 'romania';
    let clocksTimer = null;
    let serverTimeSync = {
      serverEpochMs: null,
      serverOffsetSec: 0,
      serverIanaTz: null,
      serverTzLabel: null,
      clientEpochAtFetch: null
    };

    function updateServerSync(data) {
      if (!data) return;
      if (typeof data.server_timestamp_ms === 'number') {
        serverTimeSync.serverEpochMs = data.server_timestamp_ms;
        serverTimeSync.clientEpochAtFetch = Date.now();
      }
      if (typeof data.server_offset_seconds === 'number') {
        serverTimeSync.serverOffsetSec = data.server_offset_seconds;
      }
      if (data.server_iana_tz) {
        serverTimeSync.serverIanaTz = data.server_iana_tz;
      }
      if (data.server_timezone) {
        serverTimeSync.serverTzLabel = data.server_timezone;
        const srvLabel = document.getElementById('serverTzLabel');
        if (srvLabel) srvLabel.textContent = `Sistem: ${data.server_timezone}`;
      }
    }

    function formatAppDateTime(isoString) {
      if (!isoString) return '-';
      try {
        const d = new Date(isoString);
        if (isNaN(d.getTime())) return isoString;

        if (currentAppTimezoneMode === 'romania') {
          return d.toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest' });
        }
        if (currentAppTimezoneMode === 'utc') {
          return d.toLocaleString('ro-RO', { timeZone: 'UTC' });
        }
        // Mode is 'server': format in the server's timezone
        if (serverTimeSync.serverIanaTz) {
          try {
            return d.toLocaleString('ro-RO', { timeZone: serverTimeSync.serverIanaTz });
          } catch (e) {
            // Fall through to offset calculation if browser doesn't recognize IANA tz
          }
        }
        if (typeof serverTimeSync.serverOffsetSec === 'number') {
          const localEpoch = d.getTime() + (serverTimeSync.serverOffsetSec * 1000);
          const ld = new Date(localEpoch);
          const day = String(ld.getUTCDate()).padStart(2, '0');
          const month = String(ld.getUTCMonth() + 1).padStart(2, '0');
          const year = ld.getUTCFullYear();
          const hh = String(ld.getUTCHours()).padStart(2, '0');
          const mm = String(ld.getUTCMinutes()).padStart(2, '0');
          const ss = String(ld.getUTCSeconds()).padStart(2, '0');
          return `${day}.${month}.${year}, ${hh}:${mm}:${ss}`;
        }
        return d.toLocaleString('ro-RO');
      } catch (e) {
        return isoString;
      }
    }

    // ==========================================
    // TAB 1: BACKUP MANAGEMENT
    // ==========================================
    const backupListEl = document.getElementById('backupList');
    const selectAllBackupsEl = document.getElementById('selectAllBackups');
    const deleteSelectedBtn = document.getElementById('deleteSelectedBackups');
    let currentBackups = [];
    let pendingDeleteBackup = null;
    let pendingRestoreBackup = null;

    async function loadBackups() {
      try {
        const res = await fetch('/api/admin/backups');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load backups');
        currentBackups = data.backups || [];
        renderBackups();
      } catch (err) {
        backupListEl.innerHTML = `<div class="error-msg">Error loading backups: ${escapeHtml(err.message)}</div>`;
      }
    }

    function renderBackups() {
      if (!currentBackups.length) {
        backupListEl.innerHTML = '<div class="empty-state" style="padding:24px;text-align:center;color:var(--text-muted);">No backups found for this trip.</div>';
        selectAllBackupsEl.checked = false;
        deleteSelectedBtn.disabled = true;
        return;
      }

      backupListEl.innerHTML = currentBackups.map(b => {
        const sizeKb = Math.round(b.size / 1024);
        const isProtected = b.protected;
        const safeFileId = 'bk_' + String(b.file).replace(/[^a-zA-Z0-9_-]/g, '_');
        return `
        <div class="backup-item ${isProtected ? 'protected-backup' : ''}" data-file="${escapeHtml(b.file)}">
          <label class="backup-item-check" for="${safeFileId}">
            <input type="checkbox" id="${safeFileId}" class="backup-row-checkbox" data-file="${escapeHtml(b.file)}" aria-label="Select backup ${escapeHtml(b.file)}" ${isProtected ? 'disabled title="Protected backup cannot be bulk deleted"' : ''}>
          </label>
          <div class="backup-item-details">
            <div class="backup-item-title">
              <strong>${escapeHtml(b.file)}</strong>
              ${isProtected ? '<span class="backup-pill pill-protected">Protected</span>' : ''}
              <span class="backup-pill">${sizeKb} KB</span>
            </div>
            <div class="backup-item-meta">
              <span>📅 ${escapeHtml(formatAppDateTime(b.created))}</span>
              <span>📍 ${b.location_count || 0} locations</span>
              ${b.date_from ? `<span>🗓️ ${escapeHtml(b.date_from)} → ${escapeHtml(b.date_to)}</span>` : ''}
            </div>
          </div>
          <div class="backup-item-actions">
            <a class="btn-secondary btn-sm" href="/api/admin/backups/${encodeURIComponent(b.file)}" download title="Download ZIP backup">
              ⬇ Download
            </a>
            <button class="btn-secondary btn-sm restore-single-backup" data-file="${escapeHtml(b.file)}" type="button">
              Restore
            </button>
            <button class="btn-danger btn-sm delete-single-backup" data-file="${escapeHtml(b.file)}" type="button" ${isProtected ? 'disabled title="Protected backup cannot be deleted"' : ''}>
              Delete
            </button>
          </div>
        </div>
      `;
      }).join('');

      // Attach row events
      backupListEl.querySelectorAll('.backup-row-checkbox').forEach(chk => {
        chk.addEventListener('change', updateBulkDeleteState);
      });

      backupListEl.querySelectorAll('.restore-single-backup').forEach(btn => {
        btn.addEventListener('click', () => openRestoreBackupModal(btn.dataset.file));
      });

      backupListEl.querySelectorAll('.delete-single-backup').forEach(btn => {
        btn.addEventListener('click', () => openDeleteBackupModal(btn.dataset.file));
      });

      updateBulkDeleteState();
    }

    function updateBulkDeleteState() {
      const checked = backupListEl.querySelectorAll('.backup-row-checkbox:checked');
      deleteSelectedBtn.disabled = checked.length === 0;
      deleteSelectedBtn.textContent = checked.length > 0 ? `Delete selected (${checked.length})` : 'Delete selected';
    }

    selectAllBackupsEl.addEventListener('change', () => {
      const checkBoxes = backupListEl.querySelectorAll('.backup-row-checkbox:not(:disabled)');
      checkBoxes.forEach(cb => cb.checked = selectAllBackupsEl.checked);
      updateBulkDeleteState();
    });

    // Create Backup
    document.getElementById('createBackupBtn')?.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/admin/backup', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not create backup');
        showToast(`Backup created: ${data.file}`, 'success');
        loadBackups();
      } catch (err) {
        showToast(err.message, 'danger');
      }
    });

    // Restore File Upload
    const restoreFileBtn = document.getElementById('restoreFileBtn');
    const restoreFileInput = document.getElementById('restoreFileInput');
    restoreFileBtn?.addEventListener('click', () => restoreFileInput.click());
    restoreFileInput?.addEventListener('change', async () => {
      const file = restoreFileInput.files?.[0];
      if (!file) return;
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch('/api/admin/restore', {
          method: 'POST',
          body: fd
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Restore failed');
        showToast('Trip data restored successfully from file!', 'success');
        loadBackups();
      } catch (err) {
        showToast('Error restoring file: ' + err.message, 'danger');
      } finally {
        restoreFileInput.value = '';
      }
    });

    // Delete Single Backup Modal
    const deleteBackupModal = document.getElementById('deleteBackupModal');
    function openDeleteBackupModal(filename) {
      pendingDeleteBackup = filename;
      document.getElementById('deleteBackupFilename').textContent = filename;
      deleteBackupModal.classList.add('open');
    }
    function closeDeleteBackupModal() {
      pendingDeleteBackup = null;
      deleteBackupModal.classList.remove('open');
    }
    document.getElementById('closeDeleteBackupModal')?.addEventListener('click', closeDeleteBackupModal);
    document.getElementById('cancelDeleteBackup')?.addEventListener('click', closeDeleteBackupModal);
    document.getElementById('confirmDeleteBackup')?.addEventListener('click', async () => {
      if (!pendingDeleteBackup) return;
      try {
        const res = await fetch(`/api/admin/backups/${encodeURIComponent(pendingDeleteBackup)}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to delete backup');
        showToast('Backup deleted', 'success');
        closeDeleteBackupModal();
        loadBackups();
      } catch (err) {
        showToast(err.message, 'danger');
      }
    });

    // Restore Backup Modal
    const restoreBackupModal = document.getElementById('restoreBackupModal');
    function openRestoreBackupModal(filename) {
      pendingRestoreBackup = filename;
      document.getElementById('restoreBackupFilename').textContent = filename;
      restoreBackupModal.classList.add('open');
    }
    function closeRestoreBackupModal() {
      pendingRestoreBackup = null;
      restoreBackupModal.classList.remove('open');
    }
    document.getElementById('closeRestoreBackupModal')?.addEventListener('click', closeRestoreBackupModal);
    document.getElementById('cancelRestoreBackup')?.addEventListener('click', closeRestoreBackupModal);
    document.getElementById('confirmRestoreBackup')?.addEventListener('click', async () => {
      if (!pendingRestoreBackup) return;
      try {
        const res = await fetch(`/api/admin/backups/${encodeURIComponent(pendingRestoreBackup)}/restore`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Restore failed');
        showToast('Backup restored successfully!', 'success');
        closeRestoreBackupModal();
        loadBackups();
      } catch (err) {
        showToast(err.message, 'danger');
      }
    });

    // Bulk Delete Backups
    deleteSelectedBtn?.addEventListener('click', async () => {
      const checked = Array.from(backupListEl.querySelectorAll('.backup-row-checkbox:checked')).map(cb => cb.dataset.file);
      if (!checked.length) return;
      if (!confirm(`Delete ${checked.length} selected backup(s)?`)) return;
      try {
        const res = await fetch('/api/admin/backups/bulk-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filenames: checked })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Bulk delete failed');
        showToast(`${data.deleted_count || checked.length} backup(s) deleted`, 'success');
        loadBackups();
      } catch (err) {
        showToast(err.message, 'danger');
      }
    });

    // ==========================================
    // DANGER ZONE — Confirmation & Execution
    // ==========================================
    const dangerAuthModal = document.getElementById('dangerAuthModal');
    const dangerAuthError = document.getElementById('dangerAuthError');
    let _dangerCallback = null;

    function openDangerAuth(description, callback) {
      _dangerCallback = callback;
      const descEl = document.getElementById('dangerAuthDesc');
      if (descEl && description) descEl.textContent = description;
      if (dangerAuthError) dangerAuthError.textContent = '';
      dangerAuthModal?.classList.add('open');
    }

    function closeDangerAuth() {
      _dangerCallback = null;
      dangerAuthModal?.classList.remove('open');
      if (dangerAuthError) dangerAuthError.textContent = '';
    }

    document.getElementById('closeDangerAuthModal')?.addEventListener('click', closeDangerAuth);
    document.getElementById('cancelDangerAuth')?.addEventListener('click', closeDangerAuth);

    document.getElementById('confirmDangerAuth')?.addEventListener('click', async () => {
      const btn = document.getElementById('confirmDangerAuth');
      btn.disabled = true;
      btn.textContent = 'Se șterge…';
      if (dangerAuthError) dangerAuthError.textContent = '';

      const cb = _dangerCallback;
      try {
        if (cb) {
          await cb();
        }
        closeDangerAuth();
      } catch (err) {
        if (dangerAuthError) dangerAuthError.textContent = 'Eroare: ' + err.message;
        showToast(err.message, 'danger');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Șterge tot';
      }
    });

    // Clear All Locations
    document.getElementById('clearAllBtn')?.addEventListener('click', () => {
      openDangerAuth(
        'Ești sigur că vrei să ștergi TOATE locațiile din trip-ul curent? Un backup de siguranță va fi creat automat înainte. Această acțiune este ireversibilă.',
        async () => {
          const res = await fetch('/api/admin/delete-all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Nu s-au putut șterge locațiile');
          showToast('Toate locațiile au fost șterse. Backup creat automat.', 'success');
          if (document.getElementById('paneBackup')?.classList.contains('active')) loadBackups();
          if (document.getElementById('paneHistory')?.classList.contains('active')) loadVersions();
        }
      );
    });

    // ==========================================
    // TAB 2: SECURITY AUDIT
    // ==========================================
    const securitySummary = document.getElementById('securitySummary');
    const securityRoutesBody = document.getElementById('securityRoutes');

    async function runAudit() {
      securitySummary.textContent = 'Running security audit…';
      securityRoutesBody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;">Inspecting routes…</td></tr>';
      try {
        const res = await fetch('/api/admin/security-audit');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Audit failed');
        const protectedCount = data.routes.filter(r => r.protected).length;
        securitySummary.className = `security-summary ${data.all_protected ? 'security-ok' : 'security-warning'}`;
        securitySummary.textContent = `${protectedCount}/${data.routes.length} API routes protected${data.all_protected ? ' · All checks passed' : ' · Review required'}`;

        securityRoutesBody.innerHTML = data.routes.map(r => `
        <tr>
          <td><code>${escapeHtml(r.path)}</code></td>
          <td>${r.methods.map(m => `<span class="method method-${m.toLowerCase()}">${escapeHtml(m)}</span>`).join(' ')}</td>
          <td><strong>${escapeHtml(r.required_role)}</strong></td>
          <td>${r.destructive ? '<span class="action-warning">Write/Delete</span>' : 'Read-only'}</td>
          <td><span class="route-status ${r.protected ? 'status-ok' : 'status-bad'}">${r.protected ? 'PROTECTED' : 'REVIEW'}</span></td>
        </tr>
      `).join('');
      } catch (err) {
        securitySummary.className = 'security-summary security-warning';
        securitySummary.textContent = err.message;
        securityRoutesBody.innerHTML = `<tr><td colspan="5" class="error-msg">${escapeHtml(err.message)}</td></tr>`;
      }
    }

    document.getElementById('runSecurityAudit')?.addEventListener('click', runAudit);

    // ==========================================
    // TAB 3: VERSION HISTORY
    // ==========================================
    const versionsBody = document.getElementById('versionsBody');
    const restoreVersionModal = document.getElementById('restoreVersionModal');
    const versionRestoredModal = document.getElementById('versionRestoredModal');
    let pendingVersionId = null;
    let currentVersionsData = [];
    let historyState = {
      q: '',
      source: 'all',
      highlight_version_id: ''
    };

    function syncHistoryUrl() {
      const url = new URL(window.location.href);
      if (url.searchParams.get('tab') === 'history') {
        url.searchParams.delete('version');
        url.searchParams.delete('version_id');
        url.searchParams.delete('history_q');
        url.searchParams.delete('date');
        if (historyState.q) {
          url.searchParams.set('q', historyState.q);
        } else {
          url.searchParams.delete('q');
        }
        if (historyState.source && historyState.source !== 'all') {
          url.searchParams.set('source', historyState.source);
        } else {
          url.searchParams.delete('source');
          url.searchParams.delete('history_source');
        }
        window.history.replaceState({}, '', url.pathname + url.search);
      }
    }

    function renderVersionsList() {
      const qLower = (historyState.q || '').trim().toLowerCase();
      const filtered = currentVersionsData.filter(v => {
        if (historyState.source === 'api' && !v.is_api) return false;
        if (historyState.source === 'web' && v.is_api) return false;
        if (qLower) {
          const matchId = (v.version_id || '').toLowerCase().includes(qLower);
          const matchAction = (v.action || '').toLowerCase().includes(qLower);
          const matchRole = (v.role || '').toLowerCase().includes(qLower);
          const matchIp = (v.ip || '').toLowerCase().includes(qLower);
          const matchDev = (v.device || '').toLowerCase().includes(qLower);
          const matchReq = (v.request_id || '').toLowerCase().includes(qLower);
          const matchChanges = (v.changes || []).join(' ').toLowerCase().includes(qLower);
          const matchDate = (v.created || '').toLowerCase().includes(qLower) || formatAppDateTime(v.created).toLowerCase().includes(qLower);
          if (!matchId && !matchAction && !matchRole && !matchIp && !matchDev && !matchReq && !matchChanges && !matchDate) {
            return false;
          }
        }
        return true;
      });

      const countEl = document.getElementById('historyCountInfo');
      if (countEl) {
        countEl.textContent = `Afișare ${filtered.length} din ${currentVersionsData.length} versiuni`;
      }

      const clearBtn = document.getElementById('clearHistoryFilterBtn');
      const activeTag = document.getElementById('historyFilterActiveTag');
      const isFiltered = Boolean(historyState.q || historyState.source !== 'all');
      if (clearBtn) clearBtn.style.display = isFiltered ? 'inline-block' : 'none';
      if (activeTag) {
        activeTag.style.display = isFiltered ? 'inline-block' : 'none';
        activeTag.textContent = historyState.q ? `Filtru: "${historyState.q}"` : 'Filtru activ';
      }

      if (!filtered.length) {
        versionsBody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text-muted);">Nicio versiune găsită pentru filtrul curent.</td></tr>';
        return;
      }

      versionsBody.innerHTML = filtered.map(v => `
        <tr id="versionRow_${escapeHtml(v.version_id)}" style="transition: all 0.3s ease;">
          <td style="white-space:nowrap;">${escapeHtml(formatAppDateTime(v.created))}</td>
          <td><span class="backup-pill">${escapeHtml(v.action)}</span></td>
          <td>${escapeHtml(v.role)}</td>
          <td>
            <div style="display:flex; flex-direction:column; gap:4px;">
              <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                <span style="font-family:monospace; font-size:0.83rem; font-weight:600; color:var(--text-primary);">${escapeHtml(v.ip || '-')}</span>
                ${v.is_api 
                  ? `<span class="backup-pill" style="background:rgba(99,102,241,0.2); color:#818cf8; border:1px solid rgba(99,102,241,0.4); font-size:0.72rem; padding:1px 6px;" title="${escapeHtml(v.method || '')} ${escapeHtml(v.path || '')}">📡 API</span>` 
                  : `<span class="backup-pill" style="background:rgba(16,185,129,0.15); color:#10b981; border:1px solid rgba(16,185,129,0.3); font-size:0.72rem; padding:1px 6px;">💻 Web UI</span>`}
              </div>
              <div style="font-size:0.75rem; color:var(--text-muted);">
                ${escapeHtml(v.device || '')}
              </div>
            </div>
          </td>
          <td>${v.location_count || 0}</td>
          <td>${(v.changes || []).map(c => `<div>${escapeHtml(c)}</div>`).join('')}</td>
          <td style="text-align:right; white-space:nowrap;">
            ${v.request_id ? `
            <button class="btn-secondary btn-sm view-version-api-btn" data-req-id="${escapeHtml(v.request_id)}" type="button" title="Vezi cererea API din monitor" style="margin-right:6px; font-size:0.78rem; padding:4px 8px;">
              📡 Cerere API
            </button>
            ` : ''}
            <button class="btn-secondary btn-sm restore-version-btn" data-version="${escapeHtml(v.version_id)}" type="button">
              Restore
            </button>
          </td>
        </tr>
      `).join('');

      versionsBody.querySelectorAll('.restore-version-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          pendingVersionId = btn.dataset.version;
          document.getElementById('restoreVersionName').textContent = pendingVersionId;
          restoreVersionModal.classList.add('open');
        });
      });

      versionsBody.querySelectorAll('.view-version-api-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const reqId = btn.dataset.reqId;
          if (!reqId) return;
          switchTab('apilogs');
          let foundLog = (apiLogsData || []).find(l => l.id === reqId);
          if (!foundLog) {
            try {
              const res = await fetch(`/api/admin/request-logs?q=${encodeURIComponent(reqId)}`);
              const logData = await res.json();
              if (logData.ok && logData.logs && logData.logs.length) {
                foundLog = logData.logs.find(l => l.id === reqId) || logData.logs[0];
              }
            } catch (e) {
              console.warn('Could not fetch specific log:', e);
            }
          }
          if (foundLog) {
            openRequestDetailModal(foundLog);
          } else {
            showToast(`Cererea API cu ID-ul ${reqId} nu a mai fost găsită în memorie (posibil rotită).`, 'warning');
          }
        });
      });

      if (historyState.highlight_version_id) {
        const targetVer = historyState.highlight_version_id;
        const row = document.getElementById(`versionRow_${targetVer}`);
        if (row) {
          row.scrollIntoView({ behavior: 'smooth', block: 'center' });
          row.style.outline = '2px solid #818cf8';
          row.style.backgroundColor = 'rgba(99, 102, 241, 0.22)';
          setTimeout(() => {
            row.style.outline = 'none';
            row.style.backgroundColor = '';
          }, 3500);
        }
        historyState.highlight_version_id = '';
      }
    }

    async function loadVersions() {
      versionsBody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;">Loading version history…</td></tr>';
      try {
        const res = await fetch('/api/admin/versions');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not load versions');
        currentVersionsData = data.versions || [];

        // Check URL parameters for filtering by version, query, date, or source
        const params = new URLSearchParams(window.location.search);
        const urlQ = params.get('q') || params.get('history_q') || params.get('version') || params.get('version_id') || params.get('date');
        const urlSource = params.get('source') || params.get('history_source');
        if (urlQ) {
          historyState.q = urlQ;
          const sInput = document.getElementById('historySearchInput');
          if (sInput) sInput.value = urlQ;
          if (params.get('version') || params.get('version_id')) {
            historyState.highlight_version_id = urlQ;
          }
        } else {
          historyState.q = '';
          historyState.highlight_version_id = '';
          const sInput = document.getElementById('historySearchInput');
          if (sInput) sInput.value = '';
        }
        if (urlSource) {
          historyState.source = urlSource;
          const sFilter = document.getElementById('historyFilterSource');
          if (sFilter) sFilter.value = urlSource;
        } else {
          historyState.source = 'all';
          const sFilter = document.getElementById('historyFilterSource');
          if (sFilter) sFilter.value = 'all';
        }

        renderVersionsList();
      } catch (err) {
        versionsBody.innerHTML = `<tr><td colspan="7" class="error-msg">${escapeHtml(err.message)}</td></tr>`;
      }
    }

    document.getElementById('historySearchInput')?.addEventListener('input', (e) => {
      historyState.q = e.target.value.trim();
      syncHistoryUrl();
      renderVersionsList();
    });

    document.getElementById('historyFilterSource')?.addEventListener('change', (e) => {
      historyState.source = e.target.value;
      syncHistoryUrl();
      renderVersionsList();
    });

    document.getElementById('clearHistoryFilterBtn')?.addEventListener('click', () => {
      historyState.q = '';
      historyState.source = 'all';
      historyState.highlight_version_id = '';
      const sInput = document.getElementById('historySearchInput');
      if (sInput) sInput.value = '';
      const sFilter = document.getElementById('historyFilterSource');
      if (sFilter) sFilter.value = 'all';
      syncHistoryUrl();
      renderVersionsList();
    });

    document.getElementById('refreshVersions')?.addEventListener('click', loadVersions);
    const closeVersionRestore = () => { pendingVersionId = null; restoreVersionModal?.classList.remove('open'); };
    document.getElementById('closeRestoreVersion')?.addEventListener('click', closeVersionRestore);
    document.getElementById('cancelRestoreVersion')?.addEventListener('click', closeVersionRestore);
    document.getElementById('restoreVersionModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'restoreVersionModal' || e.target.classList.contains('modal-overlay')) closeVersionRestore();
    });

    document.getElementById('confirmRestoreVersion')?.addEventListener('click', async () => {
      if (!pendingVersionId) return;
      const btn = document.getElementById('confirmRestoreVersion');
      const originalText = btn ? btn.textContent : '';
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Restoring…';
      }
      try {
        const res = await fetch(`/api/admin/versions/${encodeURIComponent(pendingVersionId)}/restore`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Restore failed');
        closeVersionRestore();
        versionRestoredModal?.classList.add('open');
        if (data.trip && data.trip.trip_name) {
          document.querySelectorAll('.trip-name-display').forEach(el => {
            el.textContent = data.trip.trip_name;
          });
        }
        showToast('Trip version restored successfully!', 'success');
        loadVersions();
      } catch (err) {
        closeVersionRestore();
        showToast(err.message, 'danger');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = originalText;
        }
      }
    });

    const closeVersionRestored = () => versionRestoredModal?.classList.remove('open');
    document.getElementById('closeVersionRestored')?.addEventListener('click', closeVersionRestored);
    document.getElementById('dismissVersionRestored')?.addEventListener('click', closeVersionRestored);
    document.getElementById('versionRestoredModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'versionRestoredModal' || e.target.classList.contains('modal-overlay')) closeVersionRestored();
    });

    // ==========================================
    // TAB 4: UPLOAD & IMPORT
    // ==========================================
    const subtabFile = document.getElementById('subtabFile');
    const subtabUrl = document.getElementById('subtabUrl');
    const paneFile = document.getElementById('paneFile');
    const paneUrl = document.getElementById('paneUrl');
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');
    const browseBtn = document.getElementById('browseBtn');
    const urlInput = document.getElementById('urlInput');
    const fetchUrlBtn = document.getElementById('fetchUrlBtn');
    const gmapsGuide = document.getElementById('gmapsGuide');
    const uploadPreview = document.getElementById('uploadPreview');
    const previewInfo = document.getElementById('previewInfo');
    const confirmUploadBtn = document.getElementById('confirmUploadBtn');
    const cancelUploadBtn = document.getElementById('cancelUploadBtn');
    let pendingLocations = [];

    function switchUploadSubtab(tab) {
      subtabFile.classList.toggle('active', tab === 'file');
      subtabUrl.classList.toggle('active', tab === 'url');
      paneFile.style.display = tab === 'file' ? 'block' : 'none';
      paneUrl.style.display = tab === 'url' ? 'block' : 'none';
    }

    subtabFile?.addEventListener('click', () => switchUploadSubtab('file'));
    subtabUrl?.addEventListener('click', () => switchUploadSubtab('url'));

    browseBtn?.addEventListener('click', () => fileInput.click());
    dropzone?.addEventListener('click', (e) => {
      if (e.target !== browseBtn) fileInput.click();
    });

    dropzone?.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone?.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      const f = e.dataTransfer?.files?.[0];
      if (f) processUploadFile(f);
    });

    fileInput?.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (f) processUploadFile(f);
    });

    async function processUploadFile(file) {
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        let locs = [];
        let listTitle = file.name;

        if (Array.isArray(parsed)) {
          locs = parsed;
        } else if (parsed.locations && Array.isArray(parsed.locations)) {
          locs = parsed.locations;
          if (parsed.trip_name) listTitle = parsed.trip_name;
        } else if (parsed.features && Array.isArray(parsed.features)) {
          // GeoJSON Takeout
          locs = parsed.features.map(f => {
            const p = f.properties || {};
            const loc = p.location || {};
            const geom = f.geometry || {};
            return {
              id: 'loc_' + Math.random().toString(36).substr(2, 9),
              name: loc.name || p.name || 'Unnamed place',
              address: loc.address || p.address || '',
              coordinates: geom.coordinates || [null, null],
              google_maps_url: p.google_maps_url || '',
              notes: p.comment || ''
            };
          });
        }

        if (!locs.length) throw new Error('No valid locations found in this JSON file.');
        pendingLocations = locs;
        showUploadPreview(locs.length, listTitle);
      } catch (err) {
        showToast('JSON Parse error: ' + err.message, 'danger');
      }
    }

    urlInput?.addEventListener('input', () => {
      const val = urlInput.value.trim().toLowerCase();
      const isGmaps = val.includes('maps.google.') || val.includes('goo.gl/maps') || val.includes('google.com/maps');
      gmapsGuide.style.display = isGmaps ? 'block' : 'none';
    });

    fetchUrlBtn?.addEventListener('click', async () => {
      const url = urlInput.value.trim();
      if (!url) return;
      fetchUrlBtn.disabled = true;
      fetchUrlBtn.textContent = 'Fetching…';
      try {
        const res = await fetch('/api/fetch-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Fetch failed');
        const locs = data.locations || [];
        if (!locs.length) throw new Error('No locations could be extracted from this URL');
        pendingLocations = locs;
        showUploadPreview(locs.length, data.title || url);
      } catch (err) {
        showToast(err.message, 'danger');
      } finally {
        fetchUrlBtn.disabled = false;
        fetchUrlBtn.textContent = 'Fetch';
      }
    });

    function showUploadPreview(count, title) {
      previewInfo.innerHTML = `
      <strong>Ready to import ${count} location(s)</strong>
      <div style="font-size:0.85rem;color:var(--text-muted);margin-top:4px;">Source: ${escapeHtml(title)}</div>
    `;
      uploadPreview.style.display = 'block';
    }

    cancelUploadBtn?.addEventListener('click', () => {
      uploadPreview.style.display = 'none';
      pendingLocations = [];
      fileInput.value = '';
      urlInput.value = '';
      gmapsGuide.style.display = 'none';
    });

    confirmUploadBtn?.addEventListener('click', async () => {
      if (!pendingLocations.length) return;
      const mergeMode = document.querySelector('input[name="mergeMode"]:checked')?.value || 'merge';
      confirmUploadBtn.disabled = true;
      confirmUploadBtn.textContent = 'Importing…';
      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locations: pendingLocations, mode: mergeMode })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Import failed');
        showToast(`Successfully imported ${data.added || pendingLocations.length} locations!`, 'success');
        uploadPreview.style.display = 'none';
        pendingLocations = [];
        fileInput.value = '';
        urlInput.value = '';
      } catch (err) {
        showToast(err.message, 'danger');
      } finally {
        confirmUploadBtn.disabled = false;
        confirmUploadBtn.textContent = 'Import Locations';
      }
    });

    // ==========================================
    // TAB 5: TIMEZONE SETTINGS
    // ==========================================

    async function loadTimezoneSettings() {
      try {
        const res = await fetch('/api/admin/settings');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Nu s-au putut încărca setările de fus orar');
        currentAppTimezoneMode = data.timezone_mode || 'romania';

        const radio = document.querySelector(`input[name="timezoneMode"][value="${currentAppTimezoneMode}"]`);
        if (radio) radio.checked = true;

        updateTimezoneBadges(currentAppTimezoneMode);
        updateServerSync(data);
      } catch (err) {
        console.warn('Could not load timezone settings:', err);
      }
    }

    function updateTimezoneBadges(mode) {
      const bRo = document.getElementById('badgeActiveRomania');
      const bSrv = document.getElementById('badgeActiveServer');
      if (bRo) bRo.style.display = (mode === 'romania') ? 'inline-block' : 'none';
      if (bSrv) bSrv.style.display = (mode === 'server') ? 'inline-block' : 'none';
    }

    function startLiveClocks() {
      if (clocksTimer) return;
      function tick() {
        const cRo = document.getElementById('clockRomania');
        const cSrv = document.getElementById('clockServer');

        if (serverTimeSync.serverEpochMs && serverTimeSync.clientEpochAtFetch) {
          const elapsed = Date.now() - serverTimeSync.clientEpochAtFetch;
          const currentServerUtcEpoch = serverTimeSync.serverEpochMs + elapsed;

          // 1. Romania Clock (Europe/Bucharest)
          const dRo = new Date(currentServerUtcEpoch);
          if (cRo) {
            cRo.textContent = dRo.toLocaleTimeString('ro-RO', { timeZone: 'Europe/Bucharest', hour12: false });
          }

          // 2. Server Clock: calculate based on server offset (pure UTC hours/mins/secs so client browser tz has NO impact)
          const serverLocalMs = currentServerUtcEpoch + (serverTimeSync.serverOffsetSec * 1000);
          const dSrv = new Date(serverLocalMs);
          const hh = String(dSrv.getUTCHours()).padStart(2, '0');
          const mm = String(dSrv.getUTCMinutes()).padStart(2, '0');
          const ss = String(dSrv.getUTCSeconds()).padStart(2, '0');
          if (cSrv) {
            cSrv.textContent = `${hh}:${mm}:${ss}`;
          }
        } else {
          // Fallback before initial sync arrives
          const now = new Date();
          if (cRo) cRo.textContent = now.toLocaleTimeString('ro-RO', { timeZone: 'Europe/Bucharest', hour12: false });
          if (cSrv) cSrv.textContent = now.toLocaleTimeString('ro-RO', { hour12: false });
        }
      }
      tick();
      clocksTimer = setInterval(tick, 1000);
    }

    document.getElementById('saveTimezoneBtn')?.addEventListener('click', async () => {
      const selected = document.querySelector('input[name="timezoneMode"]:checked')?.value || 'romania';
      const btn = document.getElementById('saveTimezoneBtn');
      btn.disabled = true;
      btn.textContent = 'Se salvează…';

      try {
        const res = await fetch('/api/admin/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timezone_mode: selected })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Salvarea a eșuat');
        currentAppTimezoneMode = selected;
        updateTimezoneBadges(selected);
        updateServerSync(data);
        showToast(
          selected === 'romania'
            ? 'Fusul orar a fost setat pe: Ora României (Europe/Bucharest)'
            : (selected === 'utc' ? 'Fusul orar a fost setat pe: UTC' : `Fusul orar a fost setat pe: Ora Serverului (${data.server_timezone || 'Local'})`),
          'success'
        );
        if (document.getElementById('paneBackup')?.classList.contains('active')) renderBackups();
        if (document.getElementById('paneHistory')?.classList.contains('active')) loadVersions();
      } catch (err) {
        showToast(err.message, 'danger');
      } finally {
        btn.disabled = false;
        btn.innerHTML = `
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
          </svg>
          <span>Salvează fusul orar</span>
        `;
      }
    });

    // ==========================================
    // TAB 6: API REQUESTS MONITOR
    // ==========================================
    let apiLogsData = [];
    let apiLogsState = {
      q: '',
      device: 'all',
      ip: 'all',
      method: 'ALL',
      status: 'all',
      sort_by: 'timestamp',
      sort_order: 'desc',
      limit: 100,
      offset: 0
    };
    let apiLivePollingTimer = null;
    let apiLivePollingActive = true;
    let apiSearchDebounceTimer = null;
    let currentLogsCacheById = {};

    function startApiLivePolling() {
      if (apiLivePollingTimer) return;
      apiLivePollingTimer = setInterval(() => {
        const pane = document.getElementById('paneApiLogs');
        if (pane && pane.classList.contains('active') && apiLivePollingActive) {
          loadApiLogs(true);
        }
      }, 3000);
    }

    function stopApiLivePolling() {
      if (apiLivePollingTimer) {
        clearInterval(apiLivePollingTimer);
        apiLivePollingTimer = null;
      }
    }

    async function loadApiLogs(isSilent = false) {
      const tbody = document.getElementById('apiLogsTableBody');
      if (!isSilent && tbody && !tbody.querySelector('tr[data-log-id]')) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:var(--text-muted);">Se încarcă cererile API...</td></tr>`;
      }

      try {
        const params = new URLSearchParams({
          q: apiLogsState.q,
          device: apiLogsState.device,
          ip: apiLogsState.ip,
          method: apiLogsState.method,
          status: apiLogsState.status,
          sort_by: apiLogsState.sort_by,
          sort_order: apiLogsState.sort_order,
          limit: apiLogsState.limit,
          offset: apiLogsState.offset
        });

        const res = await fetch(`/api/admin/request-logs?${params.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Eroare la încărcarea log-urilor');

        apiLogsData = data.logs || [];
        currentLogsCacheById = {};
        apiLogsData.forEach(item => { currentLogsCacheById[item.id] = item; });

        renderApiStats(data.stats, data.total, data.total_unfiltered);
        renderApiDeviceChips(data.stats?.top_devices, data.stats?.top_ips);
        renderApiLogsTable(apiLogsData);
        renderApiPagination(data.total, data.offset, data.limit);
      } catch (err) {
        console.error('Error fetching API request logs:', err);
        if (!isSilent && tbody) {
          tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:20px; color:#ef4444;">Eroare la preluarea cererilor API: ${escapeHtml(err.message)}</td></tr>`;
        }
      }
    }

    function renderApiStats(stats, totalFiltered, totalUnfiltered) {
      if (!stats) return;
      const elTotal = document.getElementById('statTotalReq');
      const el304 = document.getElementById('stat304Req');
      const elDevices = document.getElementById('statDevices');
      const elIps = document.getElementById('statIps');
      const elLatency = document.getElementById('statLatency');

      if (elTotal) elTotal.textContent = stats.total_requests || 0;
      if (el304) el304.textContent = stats.count_304 || 0;
      if (elDevices) elDevices.textContent = stats.unique_devices_count || 0;
      if (elIps) elIps.textContent = `${stats.unique_ips_count || 0} IP-uri unice`;
      if (elLatency) elLatency.textContent = `${stats.avg_duration_ms || 0} ms`;
    }

    function renderApiDeviceChips(devices, ips) {
      const container = document.getElementById('apiDeviceChips');
      const clearBtn = document.getElementById('clearActiveFilterBtn');
      if (!container) return;

      const hasActive = (apiLogsState.device !== 'all' || apiLogsState.ip !== 'all');
      if (clearBtn) clearBtn.style.display = hasActive ? 'inline-block' : 'none';

      if ((!devices || !devices.length) && (!ips || !ips.length)) {
        container.innerHTML = '<span style="font-size:0.82rem; color:var(--text-muted);">Niciun dispozitiv înregistrat încă.</span>';
        return;
      }

      let html = '';
      (devices || []).slice(0, 6).forEach(d => {
        const isSelected = (apiLogsState.device === d.name);
        html += `
          <button type="button" class="api-chip-btn ${isSelected ? 'active' : ''}" data-type="device" data-value="${escapeHtml(d.name)}"
            style="display:inline-flex; align-items:center; gap:6px; padding:5px 12px; border-radius:16px; font-size:0.82rem; cursor:pointer; border:1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}; background:${isSelected ? 'rgba(92, 115, 242, 0.25)' : 'var(--bg-surface)'}; color:${isSelected ? '#fff' : 'var(--text-primary)'}; font-weight:${isSelected ? '700' : '500'}; transition:all 0.15s;">
            <span>${escapeHtml(d.name)}</span>
            <span style="font-size:0.75rem; opacity:0.85; background:rgba(255,255,255,0.08); padding:1px 6px; border-radius:10px;">${d.count}</span>
          </button>
        `;
      });

      (ips || []).slice(0, 5).forEach(ip => {
        const isSelected = (apiLogsState.ip === ip.ip);
        html += `
          <button type="button" class="api-chip-btn ${isSelected ? 'active' : ''}" data-type="ip" data-value="${escapeHtml(ip.ip)}"
            style="display:inline-flex; align-items:center; gap:6px; padding:5px 12px; border-radius:16px; font-size:0.82rem; cursor:pointer; border:1px solid ${isSelected ? 'var(--success)' : 'var(--border)'}; background:${isSelected ? 'rgba(16, 185, 129, 0.25)' : 'var(--bg-surface)'}; color:${isSelected ? '#fff' : 'var(--text-primary)'}; font-weight:${isSelected ? '700' : '500'}; font-family:monospace; transition:all 0.15s;">
            <span>🌐 ${escapeHtml(ip.ip)}</span>
            <span style="font-size:0.75rem; opacity:0.85; background:rgba(255,255,255,0.08); padding:1px 6px; border-radius:10px;">${ip.count}</span>
          </button>
        `;
      });

      container.innerHTML = html;

      container.querySelectorAll('.api-chip-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const type = btn.dataset.type;
          const val = btn.dataset.value;
          if (type === 'device') {
            apiLogsState.device = (apiLogsState.device === val) ? 'all' : val;
            const devSelect = document.getElementById('apiFilterDevice');
            if (devSelect) devSelect.value = apiLogsState.device;
          } else if (type === 'ip') {
            apiLogsState.ip = (apiLogsState.ip === val) ? 'all' : val;
          }
          apiLogsState.offset = 0;
          loadApiLogs();
        });
      });
    }

    function renderApiLogsTable(logs) {
      const tbody = document.getElementById('apiLogsTableBody');
      if (!tbody) return;

      if (!logs || !logs.length) {
        tbody.innerHTML = `
          <tr>
            <td colspan="8" style="text-align:center; padding:35px; color:var(--text-muted);">
              Nu a fost găsită nicio cerere API conform filtrelor selectate.
            </td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = logs.map(item => {
        const code = item.status_code || 200;
        let statusColor = '#10b981';
        let statusBg = 'rgba(16,185,129,0.12)';
        if (code === 304) {
          statusColor = '#3b82f6';
          statusBg = 'rgba(59,130,246,0.14)';
        } else if (code >= 400 && code < 500) {
          statusColor = '#f59e0b';
          statusBg = 'rgba(245,158,11,0.15)';
        } else if (code >= 500) {
          statusColor = '#ef4444';
          statusBg = 'rgba(239,68,68,0.15)';
        }

        const method = item.method || 'GET';
        let methodColor = '#3b82f6';
        if (method === 'POST') methodColor = '#f97316';
        else if (method === 'HEAD') methodColor = '#8b5cf6';
        else if (method === 'DELETE') methodColor = '#ef4444';

        const formattedTime = formatAppDateTime(item.timestamp_iso || item.timestamp);
        const querySnippet = item.query ? `<span style="font-size:0.75rem; color:var(--text-muted); display:block; font-family:monospace; word-break:break-all;">?${escapeHtml(item.query.substring(0, 40))}${item.query.length > 40 ? '…' : ''}</span>` : '';

        return `
          <tr data-log-id="${item.id}" style="border-bottom:1px solid var(--border); transition:background 0.15s;" onmouseover="this.style.background='rgba(255,255,255,0.03)'" onmouseout="this.style.background='transparent'">
            <td style="padding:10px 14px; white-space:nowrap; font-size:0.82rem; color:var(--text-secondary);">
              ${escapeHtml(formattedTime)}
            </td>
            <td style="padding:10px 10px; white-space:nowrap;">
              <span style="display:inline-block; font-weight:700; font-size:0.78rem; padding:2px 7px; border-radius:4px; color:${methodColor}; background:rgba(255,255,255,0.04); border:1px solid currentColor;">
                ${escapeHtml(method)}
              </span>
            </td>
            <td style="padding:10px 14px; max-width:260px;">
              <span style="font-family:monospace; font-weight:600; font-size:0.85rem; color:var(--text-primary); word-break:break-all;">
                ${escapeHtml(item.path)}
              </span>
              ${querySnippet}
            </td>
            <td style="padding:10px 10px; white-space:nowrap;">
              <span style="display:inline-block; font-weight:700; font-size:0.8rem; padding:3px 8px; border-radius:12px; color:${statusColor}; background:${statusBg};">
                ${code} ${code === 304 ? 'Not Mod' : (code === 200 ? 'OK' : '')}
              </span>
            </td>
            <td style="padding:10px 12px; white-space:nowrap;">
              <button type="button" class="btn-filter-ip" data-ip="${escapeHtml(item.ip)}" title="Filtrează după acest IP"
                style="background:none; border:none; color:var(--accent-light, #818cf8); cursor:pointer; font-family:monospace; font-size:0.84rem; text-decoration:underline; padding:0;">
                ${escapeHtml(item.ip)}
              </button>
            </td>
            <td style="padding:10px 14px; font-size:0.82rem; white-space:nowrap; color:var(--text-primary);">
              <span title="${escapeHtml(item.user_agent || '')}" style="cursor:help;">
                ${escapeHtml(item.device_summary || item.client_name || 'Necunoscut')}
              </span>
            </td>
            <td style="padding:10px 12px; white-space:nowrap; font-size:0.82rem; color:${item.duration_ms > 50 ? '#f59e0b' : 'var(--text-muted)'}; font-family:monospace;">
              ${item.duration_ms} ms
            </td>
            <td style="padding:10px 14px; text-align:center; white-space:nowrap;">
              <button type="button" class="btn-secondary btn-inspect-log" data-log-id="${item.id}"
                style="padding:4px 9px; font-size:0.78rem; font-weight:600;">
                Detalii
              </button>
            </td>
          </tr>
        `;
      }).join('');

      tbody.querySelectorAll('.btn-filter-ip').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          apiLogsState.ip = btn.dataset.ip;
          apiLogsState.offset = 0;
          loadApiLogs();
        });
      });

      tbody.querySelectorAll('.btn-inspect-log').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const logId = String(btn.dataset.logId || '');
          const log = currentLogsCacheById[logId] || apiLogsData.find(item => String(item.id) === logId);
          if (log) openRequestDetailModal(log);
        });
      });

      tbody.querySelectorAll('tr[data-log-id]').forEach(tr => {
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', (e) => {
          if (e.target.closest('.btn-filter-ip') || e.target.closest('.btn-inspect-log')) return;
          const logId = String(tr.dataset.logId || '');
          const log = currentLogsCacheById[logId] || apiLogsData.find(item => String(item.id) === logId);
          if (log) openRequestDetailModal(log);
        });
      });
    }

    function renderApiPagination(total, offset, limit) {
      const info = document.getElementById('apiLogsCountInfo');
      const prev = document.getElementById('apiPrevPageBtn');
      const next = document.getElementById('apiNextPageBtn');

      if (info) {
        const start = total === 0 ? 0 : offset + 1;
        const end = Math.min(offset + limit, total);
        info.textContent = `Afișare ${start}–${end} din ${total} cereri`;
      }
      if (prev) {
        prev.disabled = (offset <= 0);
      }
      if (next) {
        next.disabled = (offset + limit >= total);
      }
    }

    function openRequestDetailModal(log) {
      const modal = document.getElementById('requestDetailModal');
      if (!modal) return;

      const mBadge = document.getElementById('modalReqMethod');
      if (mBadge) {
        mBadge.textContent = log.method || 'GET';
        const method = log.method || 'GET';
        let methodColor = '#3b82f6';
        if (method === 'POST') methodColor = '#f97316';
        else if (method === 'HEAD') methodColor = '#8b5cf6';
        else if (method === 'DELETE') methodColor = '#ef4444';
        mBadge.style.color = methodColor;
      }

      const sBadge = document.getElementById('modalReqStatus');
      if (sBadge) {
        const code = log.status_code || 200;
        sBadge.textContent = `${code} ${code === 304 ? 'Not Modified' : (code === 200 ? 'OK' : '')}`;
        let statusColor = '#10b981';
        if (code === 304) statusColor = '#3b82f6';
        else if (code >= 400 && code < 500) statusColor = '#f59e0b';
        else if (code >= 500) statusColor = '#ef4444';
        sBadge.style.color = statusColor;
      }

      document.getElementById('modalReqDuration').textContent = `⏱️ ${log.duration_ms || 0} ms`;
      document.getElementById('modalReqTime').textContent = `🕒 ${formatAppDateTime(log.timestamp_iso || log.timestamp)}`;
      document.getElementById('modalReqPath').textContent = log.path || '-';

      const qWrap = document.getElementById('modalReqQueryWrap');
      const qEl = document.getElementById('modalReqQuery');
      if (log.query) {
        qWrap.style.display = 'block';
        qEl.textContent = log.query;
      } else {
        qWrap.style.display = 'none';
      }

      document.getElementById('modalReqIp').textContent = log.ip || '127.0.0.1';
      document.getElementById('modalReqDevice').textContent = log.device_summary || log.client_name || '-';
      document.getElementById('modalReqOs').textContent = log.os || '-';
      document.getElementById('modalReqRole').textContent = log.role || 'unauth';
      document.getElementById('modalReqUa').textContent = log.user_agent || '-';

      document.getElementById('modalReqEtagReq').textContent = log.etag_req || '(niciunul)';
      document.getElementById('modalReqEtagResp').textContent = log.etag_resp || '(niciunul)';
      document.getElementById('modalReqSize').textContent = log.resp_size ? `${log.resp_size} bytes` : '0 bytes';
      document.getElementById('modalReqTripId').textContent = log.trip_id || '-';

      // Populate Site Changes & Version Association
      const changesBadge = document.getElementById('modalChangesBadge');
      const changesContent = document.getElementById('modalChangesContent');

      if (changesContent) {
        if (log.has_site_changes || log.version_id) {
          if (changesBadge) {
            changesBadge.textContent = 'A modificat călătoria';
            changesBadge.style.background = 'rgba(16, 185, 129, 0.2)';
            changesBadge.style.color = '#10b981';
            changesBadge.style.border = '1px solid rgba(16, 185, 129, 0.4)';
          }
          const changesList = (log.changes && log.changes.length)
            ? log.changes.map(c => `<li style="margin-bottom: 3px;">${escapeHtml(c)}</li>`).join('')
            : '<li>Modificare de date înregistrată în snapshot.</li>';

          changesContent.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 8px;">
              <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px; font-size: 0.85rem;">
                <div>
                  <span style="color: var(--text-muted);">Versiune creată în istoric:</span>
                  <code style="font-family: monospace; font-size: 0.82rem; background: rgba(0,0,0,0.3); color: var(--text-primary); padding: 2px 7px; border-radius: 4px;">${escapeHtml(log.version_id || '-')}</code>
                </div>
                <div>
                  <span class="backup-pill" style="font-size: 0.75rem;">Acțiune: ${escapeHtml(log.version_action || log.method)}</span>
                </div>
              </div>
              <div style="background: rgba(0, 0, 0, 0.2); border-radius: 6px; padding: 8px 12px; font-size: 0.82rem; color: var(--text-secondary);">
                <ul style="margin: 0; padding-left: 18px;">
                  ${changesList}
                </ul>
              </div>
              <div style="margin-top: 4px;">
                <button type="button" class="btn-primary btn-sm" id="btnModalJumpToHistory" data-version="${escapeHtml(log.version_id || '')}" style="display: inline-flex; align-items: center; gap: 6px; font-size: 0.82rem; padding: 6px 12px; cursor: pointer;">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                    <path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/>
                  </svg>
                  <span>Deschide în Istoric Versiuni (Tab History)</span>
                </button>
              </div>
            </div>
          `;

          document.getElementById('btnModalJumpToHistory')?.addEventListener('click', () => {
            const targetVer = log.version_id;
            closeRequestDetailModal();

            // Set filter in history state
            historyState.q = targetVer || '';
            historyState.source = 'all';
            historyState.highlight_version_id = targetVer || '';

            const sInput = document.getElementById('historySearchInput');
            if (sInput) sInput.value = targetVer || '';
            const sFilter = document.getElementById('historyFilterSource');
            if (sFilter) sFilter.value = 'all';

            // Switch to History tab, preserving filter
            switchTab('history', { preserveFilters: true });

            // Update URL with ?tab=history&version=...
            const url = new URL(window.location.href);
            url.searchParams.set('tab', 'history');
            if (targetVer) {
              url.searchParams.set('version', targetVer);
              url.searchParams.delete('q');
            } else {
              url.searchParams.delete('version');
            }
            window.history.replaceState({}, '', url.pathname + url.search);

            // Render filtered list immediately
            renderVersionsList();
          });
        } else {
          if (changesBadge) {
            changesBadge.textContent = 'Fără modificări date';
            changesBadge.style.background = 'rgba(148, 163, 184, 0.15)';
            changesBadge.style.color = 'var(--text-secondary)';
            changesBadge.style.border = '1px solid var(--border)';
          }
          changesContent.innerHTML = `
            <div style="font-size: 0.83rem; color: var(--text-muted); line-height: 1.4;">
              Această cerere API nu a modificat datele călătoriei (operațiune de citire / sincronizare GET sau HEAD).
            </div>
          `;
        }
      }

      const headersObj = {
        'Antete Cerere (Request)': log.headers_req || {},
        'Antete Răspuns (Response)': log.headers_resp || {}
      };
      document.getElementById('modalReqHeaders').textContent = JSON.stringify(headersObj, null, 2);

      modal.classList.add('open');
      modal.style.display = 'flex';
      modal.style.opacity = '1';
      modal.style.visibility = 'visible';
      modal.style.pointerEvents = 'auto';
    }

    function closeRequestDetailModal() {
      const modal = document.getElementById('requestDetailModal');
      if (!modal) return;
      modal.classList.remove('open');
      modal.style.opacity = '0';
      modal.style.visibility = 'hidden';
      modal.style.pointerEvents = 'none';
    }

    document.getElementById('closeRequestDetailModal')?.addEventListener('click', closeRequestDetailModal);
    document.getElementById('dismissRequestDetailModal')?.addEventListener('click', closeRequestDetailModal);
    document.getElementById('requestDetailModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'requestDetailModal' || e.target.classList.contains('modal-overlay')) {
        closeRequestDetailModal();
      }
    });

    // Toolbar event listeners
    document.getElementById('apiSearchInput')?.addEventListener('input', (e) => {
      clearTimeout(apiSearchDebounceTimer);
      apiSearchDebounceTimer = setTimeout(() => {
        apiLogsState.q = e.target.value.trim();
        apiLogsState.offset = 0;
        loadApiLogs();
      }, 250);
    });

    document.getElementById('apiFilterMethod')?.addEventListener('change', (e) => {
      apiLogsState.method = e.target.value;
      apiLogsState.offset = 0;
      loadApiLogs();
    });

    document.getElementById('apiFilterStatus')?.addEventListener('change', (e) => {
      apiLogsState.status = e.target.value;
      apiLogsState.offset = 0;
      loadApiLogs();
    });

    document.getElementById('apiFilterDevice')?.addEventListener('change', (e) => {
      apiLogsState.device = e.target.value;
      apiLogsState.offset = 0;
      loadApiLogs();
    });

    document.getElementById('clearActiveFilterBtn')?.addEventListener('click', () => {
      apiLogsState.device = 'all';
      apiLogsState.ip = 'all';
      const devSelect = document.getElementById('apiFilterDevice');
      if (devSelect) devSelect.value = 'all';
      apiLogsState.offset = 0;
      loadApiLogs();
    });

    document.getElementById('apiRefreshBtn')?.addEventListener('click', () => {
      loadApiLogs();
      showToast('Lista cererilor API a fost reîmprospătată.', 'info');
    });

    document.getElementById('apiLiveToggleBtn')?.addEventListener('click', () => {
      apiLivePollingActive = !apiLivePollingActive;
      const btnText = document.getElementById('apiLiveBtnText');
      const btnIcon = document.getElementById('apiLiveBtnIcon');
      const indicator = document.getElementById('apiLiveIndicator');

      if (apiLivePollingActive) {
        if (btnText) btnText.textContent = 'Pauză Live';
        if (btnIcon) btnIcon.textContent = '⏸️';
        if (indicator) indicator.style.display = 'inline-flex';
        startApiLivePolling();
        showToast('Actualizarea live este activă (la 3 secunde).', 'info');
      } else {
        if (btnText) btnText.textContent = 'Reia Live';
        if (btnIcon) btnIcon.textContent = '▶️';
        if (indicator) indicator.style.display = 'none';
        stopApiLivePolling();
        showToast('Actualizarea automată a fost pusă pe pauză.', 'info');
      }
    });

    document.getElementById('apiClearLogsBtn')?.addEventListener('click', async () => {
      if (!confirm('Ești sigur că vrei să ștergi întregul istoric al cererilor API?')) return;
      try {
        const res = await fetch('/api/admin/request-logs/clear', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Ștergerea a eșuat');
        showToast(data.message || 'Logurile au fost șterse.', 'success');
        loadApiLogs();
      } catch (err) {
        showToast(err.message, 'danger');
      }
    });

    // Column sorting headers
    document.querySelectorAll('#paneApiLogs th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const sortCol = th.dataset.sort;
        if (apiLogsState.sort_by === sortCol) {
          apiLogsState.sort_order = (apiLogsState.sort_order === 'desc') ? 'asc' : 'desc';
        } else {
          apiLogsState.sort_by = sortCol;
          apiLogsState.sort_order = 'desc';
        }

        document.querySelectorAll('#paneApiLogs .sort-icon').forEach(icon => { icon.textContent = ''; });
        const activeIcon = document.getElementById(`sortIcon_${sortCol}`);
        if (activeIcon) {
          activeIcon.textContent = apiLogsState.sort_order === 'asc' ? '▲' : '▼';
        }

        apiLogsState.offset = 0;
        loadApiLogs();
      });
    });

    // Pagination buttons
    document.getElementById('apiPrevPageBtn')?.addEventListener('click', () => {
      if (apiLogsState.offset > 0) {
        apiLogsState.offset = Math.max(0, apiLogsState.offset - apiLogsState.limit);
        loadApiLogs();
      }
    });

    document.getElementById('apiNextPageBtn')?.addEventListener('click', () => {
      apiLogsState.offset += apiLogsState.limit;
      loadApiLogs();
    });

    // ==========================================
    // CARDS & FLIGHTS MANAGEMENT
    // ==========================================
    async function loadFlightsSummary() {
      const loading = document.getElementById('flightSummaryLoading');
      const container = document.getElementById('flightSummaryContent');
      if (loading) loading.style.display = 'block';
      if (container) container.innerHTML = '';

      try {
        const res = await fetch('/api/flights/summary');
        const data = await res.json();
        if (loading) loading.style.display = 'none';

        if (!res.ok || data.status !== 'ok') {
          container.innerHTML = `<div class="error-msg">Eroare la încărcarea zborurilor: ${escapeHtml(data.error || 'Necunoscut')}</div>`;
          return;
        }

        const flights = data.flights || [];
        if (!flights.length) {
          container.innerHTML = `<div class="empty-state" style="padding: 32px; text-align: center; color: var(--text-muted);">
            <div style="font-size: 2rem; margin-bottom: 8px;">✈️</div>
            <p>Nu există carduri de zbor în itinerarul activ.</p>
            <p style="font-size: 0.85rem;">Adaugă un zbor cu număr IATA (ex: W4 3685) din Planner.</p>
          </div>`;
          return;
        }

        let html = `
          <div class="flights-summary-table-wrap">
            <table class="settings-table flights-table" style="width:100%; border-collapse: collapse;">
              <thead>
                <tr>
                  <th style="text-align:left; padding:10px;">Card / Locație</th>
                  <th style="text-align:left; padding:10px;">Număr Zbor</th>
                  <th style="text-align:left; padding:10px;">Rută</th>
                  <th style="text-align:left; padding:10px;">Status Live</th>
                  <th style="text-align:left; padding:10px;">Cache Local</th>
                  <th style="text-align:right; padding:10px;">Acțiuni</th>
                </tr>
              </thead>
              <tbody>
        `;

        flights.forEach(f => {
          const statusBadge = renderFlightStatusBadge(f.status);
          const route = (f.departure && f.arrival) ? `${escapeHtml(f.departure)} ➔ ${escapeHtml(f.arrival)}` : '—';
          const lastUpdated = f.last_updated ? formatFlightDateTime(f.last_updated) : 'Niciodată (fără cache)';
          const cachedClass = f.cached ? 'badge-success' : 'badge-warning';
          const cachedText = f.cached ? 'Salvat local (JSON)' : 'Necacheat';

          html += `
            <tr style="border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.08));">
              <td style="padding: 12px 10px;">
                <div style="font-weight: 600;">${escapeHtml(f.name || 'Zbor')}</div>
                <div style="font-size: 0.8rem; color: var(--text-muted);">${escapeHtml(f.visit_date || '')}</div>
              </td>
              <td style="padding: 12px 10px;">
                <span class="flight-iata-pill" style="display:inline-block; font-family: monospace; font-weight: 700; padding: 2px 8px; border-radius: 6px; background: rgba(59,130,246,0.15); color: #60a5fa; border: 1px solid rgba(59,130,246,0.3);">${escapeHtml(f.flight_number || '—')}</span>
                ${f.airline ? `<div style="font-size: 0.75rem; color: var(--text-muted); margin-top:2px;">${escapeHtml(f.airline)}</div>` : ''}
              </td>
              <td style="padding: 12px 10px; font-weight: 500;">${route}</td>
              <td style="padding: 12px 10px;">${statusBadge}</td>
              <td style="padding: 12px 10px;">
                <span class="cache-pill ${cachedClass}" style="display:inline-block; font-size: 0.75rem; font-weight: 600; padding: 2px 8px; border-radius: 12px; background: ${f.cached ? 'rgba(34,197,94,0.15)' : 'rgba(234,179,8,0.15)'}; color: ${f.cached ? '#4ade80' : '#facc15'}; border: 1px solid ${f.cached ? 'rgba(34,197,94,0.3)' : 'rgba(234,179,8,0.3)'};">${cachedText}</span>
                <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 4px;">${lastUpdated}</div>
              </td>
              <td style="padding: 12px 10px; text-align: right;">
                <button type="button" class="btn-secondary btn-sm refresh-single-flight-btn" data-loc-id="${escapeHtml(f.id)}" style="padding: 4px 10px; font-size: 0.8rem;" title="Actualizează acest zbor de la API">
                  🔄 Reîmprospătează
                </button>
              </td>
            </tr>
          `;
        });

        html += `</tbody></table></div>`;
        container.innerHTML = html;

        container.querySelectorAll('.refresh-single-flight-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            const locId = btn.dataset.locId;
            btn.disabled = true;
            btn.textContent = 'Actualizare…';
            try {
              const r = await fetch(`/api/locations/${encodeURIComponent(locId)}/flight-refresh`, { method: 'POST' });
              const d = await r.json();
              if (r.ok && d.status === 'ok') {
                showToast('Zbor actualizat cu succes de la API!', 'success');
              } else {
                showToast(d.message || d.error || 'Eroare la actualizare', 'danger');
              }
              loadFlightsSummary();
            } catch (err) {
              showToast('Eroare rețea: ' + err.message, 'danger');
              btn.disabled = false;
              btn.textContent = '🔄 Reîmprospătează';
            }
          });
        });

      } catch (e) {
        if (loading) loading.style.display = 'none';
        container.innerHTML = `<div class="error-msg">Eroare de rețea: ${escapeHtml(e.message)}</div>`;
      }
    }

    function renderFlightStatusBadge(status) {
      const s = (status || 'unknown').toLowerCase();
      const map = {
        scheduled: { icon: '🟢', label: 'Programat', color: '#4ade80', bg: 'rgba(34,197,94,0.15)', border: 'rgba(34,197,94,0.3)' },
        active: { icon: '🔵', label: 'În zbor', color: '#60a5fa', bg: 'rgba(59,130,246,0.15)', border: 'rgba(59,130,246,0.3)' },
        landed: { icon: '✓', label: 'Aterizat', color: '#a78bfa', bg: 'rgba(168,85,247,0.15)', border: 'rgba(168,85,247,0.3)' },
        cancelled: { icon: '🔴', label: 'Anulat', color: '#f87171', bg: 'rgba(239,68,68,0.15)', border: 'rgba(239,68,68,0.3)' },
        incident: { icon: '⚠️', label: 'Incident', color: '#fb923c', bg: 'rgba(249,115,22,0.15)', border: 'rgba(249,115,22,0.3)' },
        diverted: { icon: '↩️', label: 'Deviat', color: '#fbbf24', bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.3)' },
        not_cached: { icon: '⚪', label: 'Neinterogat', color: '#94a3b8', bg: 'rgba(148,163,184,0.15)', border: 'rgba(148,163,184,0.3)' }
      };
      const item = map[s] || { icon: '❓', label: s, color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', border: 'rgba(148,163,184,0.2)' };
      return `<span style="display:inline-flex; align-items:center; gap:5px; font-size:0.75rem; font-weight:600; padding:3px 8px; border-radius:12px; background:${item.bg}; color:${item.color}; border:1px solid ${item.border};"><span style="font-size:0.8rem;">${item.icon}</span> <span>${item.label}</span></span>`;
    }

    function formatFlightDateTime(iso) {
      if (!iso) return '—';
      try {
        const d = new Date(iso);
        return d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      } catch {
        return iso.slice(0, 16);
      }
    }

    const refreshAllFlightsBtn = document.getElementById('refreshAllFlightsBtn');
    refreshAllFlightsBtn?.addEventListener('click', async () => {
      const btnText = document.getElementById('refreshAllFlightsBtnText');
      if (refreshAllFlightsBtn.disabled) return;
      refreshAllFlightsBtn.disabled = true;
      if (btnText) btnText.textContent = 'Se actualizează de la API…';

      try {
        const res = await fetch('/api/flights/refresh-all', { method: 'POST' });
        const data = await res.json();
        if (res.ok && data.status === 'ok') {
          let msg = `Actualizare completă: ${data.refreshed_count} zbor(uri) actualizate din ${data.total}.`;
          if (data.failed_count > 0) {
            msg += ` (${data.failed_count} erori, s-a păstrat cache-ul existent)`;
          }
          showToast(msg, data.failed_count > 0 ? 'warning' : 'success');
        } else {
          showToast(data.error || 'Eroare la actualizarea zborurilor', 'danger');
        }
      } catch (err) {
        showToast('Eroare conexiune: ' + err.message, 'danger');
      } finally {
        refreshAllFlightsBtn.disabled = false;
        if (btnText) btnText.textContent = 'Update flight data from API';
        loadFlightsSummary();
      }
    });

    // ==========================================
    // INITIALIZATION & TAB ACTIVATION
    // ==========================================
    startLiveClocks();
    loadTimezoneSettings().finally(() => {
      const currentParams = new URLSearchParams(window.location.search);
      let initialTab = currentParams.get('tab');
      const hasVersionParam = currentParams.has('version') || currentParams.has('version_id');

      if (!initialTab) {
        if (hasVersionParam) {
          initialTab = 'history';
        } else {
          const appEl = document.getElementById('settingsApp') || document.querySelector('.settings-page');
        initialTab = (appEl && appEl.dataset.activeTab) || 'backup';
        }
      }

      // If initial tab is not history, cleanly strip leftover version/filter params from the URL
      if (initialTab !== 'history') {
        switchTab(initialTab, { preserveFilters: false });
      } else {
        // If initial tab is history, preserve filters only if explicitly present
        switchTab(initialTab, { preserveFilters: hasVersionParam || currentParams.has('q') || currentParams.has('source') });
      }
    });
