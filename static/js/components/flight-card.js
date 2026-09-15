/**
 * components/flight-card.js
 * Flight radar card, flight status badge, and cached telemetry board renderer
 */

import { esc } from '../core/utils.js';
import { formatFlightTime, formatFlightDate, formatFlightDateTime } from '../core/date-utils.js';
import { getLocation } from '../core/state.js';
import { toast } from '../core/toast.js';

export function getFlightStatusVisual(status, delay) {
  const s = (status || 'unknown').toLowerCase();
  const delayMin = Number(delay) || 0;

  if (s === 'cancelled') {
    return { icon: '🔴', label: 'Anulat', className: 'flight-status-cancelled', textClass: 'text-red-400' };
  }
  if (s === 'diverted') {
    return { icon: '↩️', label: 'Deviat', className: 'flight-status-diverted', textClass: 'text-amber-400' };
  }
  if (s === 'incident') {
    return { icon: '⚠️', label: 'Incident', className: 'flight-status-incident', textClass: 'text-orange-400' };
  }
  if (delayMin > 10 && (s === 'scheduled' || s === 'active')) {
    return { icon: '🟡', label: `Întârziat (+${delayMin} min)`, className: 'flight-status-delayed', textClass: 'text-amber-400' };
  }

  const map = {
    scheduled: { icon: '🟢', label: 'Programat / La timp', className: 'flight-status-scheduled', textClass: 'text-emerald-400' },
    active: { icon: '🔵', label: 'În zbor', className: 'flight-status-active', textClass: 'text-blue-400' },
    landed: { icon: '✓', label: 'Aterizat', className: 'flight-status-landed', textClass: 'text-purple-400' },
    unknown: { icon: '⚪', label: 'Status necunoscut', className: 'flight-status-unknown', textClass: 'text-slate-400' },
  };

  return map[s] || { icon: '⚪', label: status || 'Necunoscut', className: 'flight-status-unknown', textClass: 'text-slate-400' };
}

export function renderFlightCardHTML(container, loc, flight, fromCache = true) {
  if (!container || !flight) return;

  const dep = flight.departure || {};
  const arr = flight.arrival || {};
  const depTime = dep.actual || dep.estimated || dep.scheduled;
  const arrTime = arr.actual || arr.estimated || arr.scheduled;
  const delayVal = flight.delay != null ? flight.delay : dep.delay;
  const visual = getFlightStatusVisual(flight.status, delayVal);
  const live = flight.live;

  const lastUpdatedStr = flight.last_updated ? formatFlightDateTime(flight.last_updated) : 'Recent';
  const durationStr = flight.duration ? `<span class="flight-route-duration" title="Durată estimată">⏱️ ${esc(flight.duration)}</span>` : '';

  const detailsItems = [];
  if (flight.airline) detailsItems.push({ label: 'Companie', val: flight.airline });
  if (flight.flight_number || flight.flight_iata) detailsItems.push({ label: 'Număr Zbor', val: (flight.flight_number || flight.flight_iata).toUpperCase() });
  if (dep.terminal) detailsItems.push({ label: 'Terminal Plecare', val: dep.terminal });
  if (dep.gate) detailsItems.push({ label: 'Poartă Plecare', val: dep.gate });
  if (arr.terminal) detailsItems.push({ label: 'Terminal Sosire', val: arr.terminal });
  if (arr.gate) detailsItems.push({ label: 'Poartă Sosire', val: arr.gate });
  if (arr.baggage) detailsItems.push({ label: 'Bandă Bagaje', val: arr.baggage });
  if (flight.aircraft) detailsItems.push({ label: 'Aeronava', val: flight.aircraft });
  if (delayVal) detailsItems.push({ label: 'Întârziere', val: `${delayVal} min` });

  const detailsGridHTML = detailsItems.length ? `
    <div class="flight-details-grid">
      ${detailsItems.map(item => `
        <div class="flight-detail-item">
          <span class="flight-detail-label">${esc(item.label)}</span>
          <span class="flight-detail-value">${esc(item.val)}</span>
        </div>
      `).join('')}
    </div>
  ` : '';

  const liveRowHTML = live ? `
    <div class="flight-live-banner">
      <span class="flight-live-pulse-dot"></span>
      <span class="flight-live-title">Radar Live:</span>
      <span>${live.is_ground ? 'La sol' : 'În aer'}</span>
      ${live.altitude != null ? `<span class="live-sep">·</span><span>Alt: ${live.altitude} m</span>` : ''}
      ${live.speed_horizontal != null ? `<span class="live-sep">·</span><span>Viteză: ${Math.round(live.speed_horizontal)} km/h</span>` : ''}
    </div>
  ` : '';

  container.innerHTML = `
    <div class="drawer-flight-card">
      <div class="drawer-flight-header">
        <div class="drawer-flight-meta">
          <span class="drawer-flight-airline">${esc(flight.airline || 'Zbor')}</span>
          <span class="drawer-flight-code">${esc((flight.flight_number || flight.flight_iata || loc.flight_number || '').toUpperCase())}</span>
        </div>
        <div class="drawer-flight-badge ${visual.className}">
          <span class="status-badge-icon">${visual.icon}</span>
          <span class="status-badge-label">${esc(visual.label)}</span>
        </div>
      </div>

      <div class="drawer-flight-route">
        <div class="flight-route-col departure">
          <div class="flight-route-iata">${esc(dep.iata || 'DEP')}</div>
          <div class="flight-route-time">${formatFlightTime(depTime, dep.timezone)}</div>
          <div class="flight-route-airport" title="${esc(dep.airport || '')}">${esc(dep.airport || 'Plecare')}</div>
          <div class="flight-route-date">${formatFlightDate(dep.scheduled || loc.visit_date)}</div>
        </div>

        <div class="flight-route-graphic">
          ${durationStr}
          <div class="flight-route-vector">
            <span class="vector-line"></span>
            <span class="vector-plane">✈</span>
          </div>
        </div>

        <div class="flight-route-col arrival">
          <div class="flight-route-iata">${esc(arr.iata || 'ARR')}</div>
          <div class="flight-route-time">${formatFlightTime(arrTime, arr.timezone)}</div>
          <div class="flight-route-airport" title="${esc(arr.airport || '')}">${esc(arr.airport || 'Sosire')}</div>
          <div class="flight-route-date">${formatFlightDate(arr.scheduled || loc.visit_date)}</div>
        </div>
      </div>

      ${detailsGridHTML}
      ${liveRowHTML}

      <div class="drawer-flight-footer">
        <div class="drawer-flight-cache-info">
          <span class="cache-shield-icon" title="Date salvate local, fără consum API">🛡️</span>
          <div class="cache-text-wrap">
            <span class="cache-source-label">${flight.source ? `Sursă: ${flight.source}` : (flight.google_enrichment ? 'Snapshot API + Google Flight Status' : 'Snapshot local JSON')}</span>
            <span class="cache-time-label">Actualizat: ${lastUpdatedStr}</span>
          </div>
        </div>
        <button type="button" class="btn-secondary btn-sm drawer-flight-refresh-btn" data-loc-id="${esc(loc.id)}" title="Interoghează API AviationStack pentru date proaspete">
          <span class="btn-refresh-icon">🔄</span>
          <span class="btn-refresh-text">Actualizează de la API</span>
        </button>
      </div>

      <div class="drawer-flight-refresh-notice" style="display:none;"></div>
    </div>
  `;

  const refreshBtn = container.querySelector('.drawer-flight-refresh-btn');
  const noticeEl = container.querySelector('.drawer-flight-refresh-notice');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      const originalText = refreshBtn.querySelector('.btn-refresh-text')?.textContent;
      if (refreshBtn.querySelector('.btn-refresh-text')) {
        refreshBtn.querySelector('.btn-refresh-text').textContent = 'Se preia din API…';
      }
      refreshBtn.classList.add('is-loading');

      try {
        const res = await fetch(`/api/locations/${encodeURIComponent(loc.id)}/flight-refresh`, { method: 'POST' });
        const data = await res.json();

        if (res.ok && data.status === 'ok' && data.flight) {
          loc.flight_data = data.flight;
          const stateLoc = getLocation(loc.id);
          if (stateLoc) stateLoc.flight_data = data.flight;
          renderFlightCardHTML(container, loc, data.flight, false);
          if (window.LocationSubcards) {
            window.LocationSubcards.updateCard(document.querySelector(`.location-card[data-id="${CSS.escape(loc.id)}"]`), loc);
          }
          toast('Datele zborului au fost actualizate de la API!', 'success');
        } else {
          if (noticeEl) {
            noticeEl.style.display = 'block';
            noticeEl.className = 'drawer-flight-refresh-notice notice-warning';
            noticeEl.innerHTML = `⚠️ <strong>Nu s-a putut actualiza:</strong> ${esc(data.message || data.error || 'Eroare API')}. Se afișează datele din cache-ul local salvat la ${lastUpdatedStr}.`;
          }
          toast(data.message || data.error || 'Nu s-a putut actualiza zborul', 'warning');
        }
      } catch (err) {
        if (noticeEl) {
          noticeEl.style.display = 'block';
          noticeEl.className = 'drawer-flight-refresh-notice notice-warning';
          noticeEl.innerHTML = `⚠️ <strong>Eroare rețea:</strong> ${esc(err.message)}. Se afișează datele din cache-ul local salvat la ${lastUpdatedStr}.`;
        }
        toast('Eroare rețea la actualizarea zborului', 'warning');
      } finally {
        refreshBtn.disabled = false;
        refreshBtn.classList.remove('is-loading');
        if (refreshBtn.querySelector('.btn-refresh-text') && originalText) {
          refreshBtn.querySelector('.btn-refresh-text').textContent = originalText;
        }
      }
    });
  }
}

export function renderFlightUnavailableHTML(container, loc, errMsg) {
  if (!container) return;
  const fNum = (loc.flight_number || '').toUpperCase();
  container.innerHTML = `
    <div class="flight-unavailable-box">
      <div class="unavail-icon">✈️</div>
      <div class="unavail-title">Date de zbor indisponibile</div>
      <p class="unavail-desc">${esc(errMsg || `Nu s-au putut prelua automat datele pentru zborul ${fNum}.`)}</p>
      <button type="button" class="btn-primary btn-sm retry-flight-btn" data-loc-id="${esc(loc.id)}">
        🔄 Reîncearcă interogarea API
      </button>
    </div>
  `;

  const retryBtn = container.querySelector('.retry-flight-btn');
  retryBtn?.addEventListener('click', () => {
    retryBtn.disabled = true;
    retryBtn.textContent = 'Se verifică…';
    fetch(`/api/locations/${encodeURIComponent(loc.id)}/flight-refresh`, { method: 'POST' })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'ok' && data.flight) {
          loc.flight_data = data.flight;
          const stateLoc = getLocation(loc.id);
          if (stateLoc) stateLoc.flight_data = data.flight;
          renderFlightCardHTML(container, loc, data.flight, false);
          if (window.LocationSubcards) {
            window.LocationSubcards.updateCard(document.querySelector(`.location-card[data-id="${CSS.escape(loc.id)}"]`), loc);
          }
          toast('Datele zborului au fost preluate și salvate local!', 'success');
        } else {
          renderFlightUnavailableHTML(container, loc, data.message || data.error);
        }
      })
      .catch(err => {
        renderFlightUnavailableHTML(container, loc, err.message);
      });
  });
}

export async function fetchFlightStatus(card, flightIata, forceRefresh = false) {
  const wrap = card.querySelector('.flight-status-card-wrap');
  if (!wrap) return;
  const locId = card.dataset.id;
  const loc = getLocation(locId);

  if (!forceRefresh && loc && loc.flight_data) {
    wrap.style.display = '';
    renderFlightCardHTML(wrap, loc, loc.flight_data, true);
    return;
  }

  wrap.style.display = '';
  wrap.innerHTML = `<div class="flight-status-loading"><span class="flight-loading-spinner"></span> Se verifică zborul ${flightIata}…</div>`;

  try {
    const endpoint = forceRefresh
      ? `/api/locations/${encodeURIComponent(locId)}/flight-refresh`
      : `/api/locations/${encodeURIComponent(locId)}/flight-data`;
    const opts = forceRefresh ? { method: 'POST' } : {};
    const res = await fetch(endpoint, opts);
    const data = await res.json();

    if (!res.ok || (data.error && !data.flight)) {
      wrap.innerHTML = `<div class="flight-status-error">❌ ${esc(data.error || 'Eroare la verificarea zborului')}</div>`;
      return;
    }

    if (loc) loc.flight_data = data.flight;
    renderFlightCardHTML(wrap, loc || { id: locId, flight_number: flightIata }, data.flight, data.from_cache !== false);
  } catch (err) {
    wrap.innerHTML = `<div class="flight-status-error">❌ Eroare rețea: ${esc(err.message)}</div>`;
  }
}

export function openFlightModal(locId) {
  const loc = (typeof window !== 'undefined' && window.state)
    ? window.state.trip?.locations?.find(l => l.id === locId)
    : getLocation(locId);
  if (!loc) return;

  const modal = document.getElementById('flightModal');
  const titleEl = document.getElementById('flightModalTitle');
  const bodyEl = document.getElementById('flightModalBody');
  if (!modal || !bodyEl) return;

  const flightCode = (loc.flight_number || loc.flight_data?.flight_number || loc.flight_data?.flight_iata || 'Zbor').toUpperCase();
  if (titleEl) {
    titleEl.textContent = `Detalii Zbor · ${flightCode}`;
  }

  // Render subcard-inner subcard-flight-content inside the modal
  const f = loc.flight_data || null;
  const dep = f?.departure || {};
  const arr = f?.arrival || {};
  const depIata = dep.iata || (loc.departure_airport || '').toUpperCase() || 'DEP';
  const arrIata = arr.iata || (loc.arrival_airport || '').toUpperCase() || 'ARR';
  const depTime = dep.scheduled ? dep.scheduled.slice(11, 16) : (loc.visit_time || '');
  const arrTime = arr.scheduled ? arr.scheduled.slice(11, 16) : '';
  const status = f?.status || '';
  const delay = f?.delay != null ? f.delay : dep.delay;

  let statusBadge = '';
  if (status) {
    const isLanded = status === 'landed';
    const isCancelled = status === 'cancelled';
    const isDelayed = delay > 0;
    const dotColor = isCancelled ? '#ef4444' : isDelayed ? '#f59e0b' : isLanded ? '#3b82f6' : '#10b981';
    const statusLabel = isCancelled ? 'Anulat' : isDelayed ? `+${delay}m` : isLanded ? 'Aterizat' : 'La timp';
    statusBadge = `<span class="subcard-flight-status" style="--dot-color:${dotColor};"><span class="subcard-flight-dot"></span>${esc(statusLabel)}</span>`;
  }
  const durationStr = f?.duration ? `<span class="subcard-flight-dur">⏱️ ${esc(f.duration)}</span>` : '';
  const gateInfo = (dep.gate || arr.gate) ? `<span class="subcard-flight-gate">Gate ${esc(dep.gate || arr.gate)}</span>` : '';

  bodyEl.innerHTML = `
    <div class="subcard-inner subcard-flight-content flight-modal-subcard" style="cursor: default;">
      <div class="subcard-flight-main">
        <span class="subcard-icon">✈️</span>
        <span class="subcard-flight-code">${esc(flightCode)}</span>
        <span class="subcard-flight-route">${esc(depIata)} → ${esc(arrIata)}</span>
        ${(depTime || arrTime) ? `<span class="subcard-flight-times">${esc(depTime)}${arrTime ? ` - ${esc(arrTime)}` : ''}</span>` : ''}
      </div>
      <div class="subcard-flight-meta">
        ${statusBadge}
        ${durationStr}
        ${gateInfo}
      </div>
    </div>
    <div class="flight-status-card-wrap flight-modal-radar-wrap" id="flightModalRadarWrap"></div>
  `;

  const radarWrap = document.getElementById('flightModalRadarWrap');
  if (radarWrap) {
    if (f) {
      renderFlightCardHTML(radarWrap, loc, f, true);
    } else if (loc.flight_number) {
      fetchFlightStatus({ dataset: { id: loc.id }, querySelector: () => radarWrap }, loc.flight_number, false);
    }
  }

  modal.classList.add('open');
  document.body.classList.add('modal-open');
  document.documentElement.classList.add('modal-open');
}

export function closeFlightModal() {
  const modal = document.getElementById('flightModal');
  if (modal) {
    modal.classList.remove('open');
    if (typeof window.updateModalOpenState === 'function') {
      window.updateModalOpenState();
    } else {
      const hasOpenModal = !!document.querySelector('.modal-overlay.open');
      document.body.classList.toggle('modal-open', hasOpenModal);
      document.documentElement.classList.toggle('modal-open', hasOpenModal);
    }
  }
}

if (typeof window !== 'undefined') {
  window.openFlightModal = openFlightModal;
  window.closeFlightModal = closeFlightModal;
  window.fetchFlightStatus = fetchFlightStatus;
  window.renderFlightCardHTML = renderFlightCardHTML;
}

