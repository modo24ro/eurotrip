/**
 * location-subcards.js
 * Swipeable Secondary Cards for Location Cards
 * Handles dynamic sub-cards: Notes, Flight Details (transport_flight only), Attachments + Confirmation
 */
(function() {
  'use strict';

  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Left & Right tall, elegant, narrow SVG chevrons
  const CHEVRON_LEFT_SVG = `<svg viewBox="0 0 10 24" width="10" height="24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2L2 12l6 10"/></svg>`;
  const CHEVRON_RIGHT_SVG = `<svg viewBox="0 0 10 24" width="10" height="24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 2l6 10-6 10"/></svg>`;

  /**
   * Helper: Get schedule conflict for location
   */
  function getConflict(loc, conflictData) {
    if (conflictData) return conflictData;
    if (loc && loc._conflict) return loc._conflict;
    if (!loc || !loc.visit_date || !loc.visit_time) return null;
    if (typeof window !== 'undefined' && typeof window.checkTimeConflict === 'function') {
      const allLocs = (window.state && window.state.trip && window.state.trip.locations) || [];
      return window.checkTimeConflict(loc, allLocs);
    }
    return null;
  }

  /**
   * 0. Subcard: Schedule Conflict (Priority 0 - shown first until resolved)
   */
  function renderConflictCard(loc, conflictData) {
    const conflict = getConflict(loc, conflictData);
    if (!conflict || !conflict.conflictingWith || !conflict.conflictingWith.length) return null;

    const overlapMins = conflict.overlapMinutes || 0;
    const names = conflict.conflictingWith.map(c => c.name || 'Altă locație').join(', ');
    const titleText = `Conflict de program: suprapunere de ${overlapMins} min cu ${names} • Apasă pentru a edita programul`;

    return `
      <div class="subcard-slide subcard-slide-conflict" data-subcard-type="conflict">
        <div class="subcard-inner subcard-conflict-content" data-action="openLocationModal" data-drawer-tab="schedule" data-loc-id="${esc(loc.id)}" role="button" tabindex="0" title="${esc(titleText)}">
          <span class="subcard-icon subcard-conflict-icon" aria-hidden="true">⚠️</span>
          <div class="subcard-conflict-text">
            <span class="subcard-conflict-badge">Conflict (+${overlapMins} min):</span>
            <span class="subcard-conflict-names">Suprapunere cu ${esc(names)}</span>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 1. Subcard: Notes
   */
  function renderNotesCard(loc) {
    const notes = (loc.notes || '').trim();
    if (!notes) return null;
    return `
      <div class="subcard-slide subcard-slide-notes" data-subcard-type="notes">
        <div class="subcard-inner subcard-notes-content" title="${esc(notes)}">
          <div class="subcard-notes-badge" aria-hidden="true">
            <svg class="subcard-notes-svg" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
          </div>
          <span class="subcard-text subcard-notes-text">${(typeof window !== 'undefined' && window.renderFormattedNotes) ? window.renderFormattedNotes(notes) : esc(notes)}</span>
        </div>
      </div>
    `;
  }

  /**
   * 2. Subcard: Flight Details (ONLY for transport_flight)
   */
  function renderFlightCard(loc) {
    if (loc.category !== 'transport_flight') return null;

    const fCode = (loc.flight_number || '').trim().toUpperCase();
    const flight = loc.flight_data || null;

    if (!fCode && !flight) return null;

    const dep = flight?.departure || {};
    const arr = flight?.arrival || {};
    const depIata = dep.iata || (loc.departure_airport || '').toUpperCase() || 'DEP';
    const arrIata = arr.iata || (loc.arrival_airport || '').toUpperCase() || 'ARR';
    const flightCode = fCode || (flight?.flight_number || flight?.flight_iata || 'ZBOR').toUpperCase();

    // Time formatting
    const depTime = dep.scheduled ? dep.scheduled.slice(11, 16) : (loc.visit_time || '');
    const arrTime = arr.scheduled ? arr.scheduled.slice(11, 16) : '';
    const status = flight?.status || '';
    const delay = flight?.delay != null ? flight.delay : dep.delay;

    let statusBadge = '';
    if (status) {
      const isLanded = status === 'landed';
      const isCancelled = status === 'cancelled';
      const isDelayed = delay > 0;
      const dotColor = isCancelled ? '#ef4444' : isDelayed ? '#f59e0b' : isLanded ? '#3b82f6' : '#10b981';
      const statusLabel = isCancelled ? 'Anulat' : isDelayed ? `+${delay}m` : isLanded ? 'Aterizat' : 'La timp';
      statusBadge = `<span class="subcard-flight-status" style="--dot-color:${dotColor};"><span class="subcard-flight-dot"></span>${esc(statusLabel)}</span>`;
    }

    const durationStr = flight?.duration ? `<span class="subcard-flight-dur">⏱️ ${esc(flight.duration)}</span>` : '';

    // Gate & Belt logistics
    const gateVal = dep.gate || loc?.flight_gate || '';
    const beltVal = arr.belt || arr.baggage || flight?.belt || flight?.baggage || '';
    const gateBadge = gateVal ? `<span class="subcard-flight-gate">Gate ${esc(gateVal)}</span>` : '';
    let beltBadge = beltVal ? `<span class="subcard-flight-gate subcard-flight-belt">Belt ${esc(beltVal)}</span>` : '';

    // If both exist, on narrow screens hide belt so it doesn't wrap, on wide screens show both
    if (gateVal && beltVal) {
      beltBadge = `<span class="subcard-flight-gate subcard-flight-belt subcard-wide-info">Belt ${esc(beltVal)}</span>`;
    }

    const depTerminal = dep.terminal ? String(dep.terminal) : (loc?.flight_terminal ? String(loc.flight_terminal) : '');
    const terminalBadge = depTerminal ? `<span class="subcard-flight-terminal" title="Terminal plecare">T${esc(depTerminal)}</span>` : '';

    const aircraft = (flight?.aircraft || '').trim();
    const aircraftBadge = aircraft ? `<span class="subcard-flight-aircraft subcard-wide-info" title="Aeronava"><span class="aircraft-icon" aria-hidden="true">✈</span><span>${esc(aircraft)}</span></span>` : '';

    let rightColHTML = '';
    if (statusBadge || aircraftBadge) {
      rightColHTML = `
        <div class="subcard-flight-right">
          ${statusBadge}
          ${aircraftBadge}
        </div>
      `;
    }

    const timesStr = (depTime || arrTime) ? `${esc(depTime)}${arrTime ? ` - ${esc(arrTime)}` : ''}` : '';

    return `
      <div class="subcard-slide subcard-slide-flight" data-subcard-type="flight">
        <div class="subcard-inner subcard-flight-content flight-status-card-wrap" data-action="openFlightModal" data-loc-id="${esc(loc.id)}" role="button" tabindex="0" title="Vezi detaliile complete pentru zborul ${esc(flightCode)}">
          <div class="subcard-flight-badge" aria-hidden="true">
            <svg class="subcard-flight-svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21 4 19 4c-.7 0-1.5.2-2 .7L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>
            </svg>
          </div>
          <div class="subcard-flight-body">
            <div class="subcard-flight-main">
              <span class="subcard-flight-code">${esc(flightCode)}</span>
              <span class="subcard-flight-route">${esc(depIata)} → ${esc(arrIata)}</span>
              ${terminalBadge}
              ${timesStr ? `<span class="subcard-flight-times subcard-times-wide subcard-wide-info">${timesStr}</span>` : ''}
            </div>
            <div class="subcard-flight-meta">
              ${timesStr ? `<span class="subcard-flight-times subcard-times-narrow subcard-narrow-only">${timesStr}</span>` : ''}
              ${durationStr}
              ${gateBadge}
              ${beltBadge}
            </div>
          </div>
          ${rightColHTML}
        </div>
      </div>
    `;
  }

  /**
   * 3. Subcard: Attachments + Multi-Links / Confirmation
   */
  function renderAttachmentsAndConfCard(loc) {
    const hasAttachments = loc.attachments && loc.attachments.length > 0;

    let linksMarkup = '';
    if (typeof window !== 'undefined' && typeof window.renderMultiLinksHTML === 'function') {
      linksMarkup = window.renderMultiLinksHTML(loc, { extraClasses: 'subcard-chip' });
    } else {
      const rawLinks = Array.isArray(loc.links) ? loc.links.filter(l => l && l.url && l.url.trim()) : [];
      if (rawLinks.length === 0 && loc.confirmation_url && loc.confirmation_url.trim()) {
        rawLinks.push({ url: loc.confirmation_url, label: loc.confirmation_label || 'Confirmare' });
      }
      linksMarkup = rawLinks.slice(0, 3).map(link => {
        const url = (link.url || '').trim();
        const label = (link.label || '').trim() || 'Confirmare';
        return `
        <a class="strip-chip strip-confirmation confirmation-link subcard-chip"
           href="${esc(url)}"
           target="_blank"
           rel="noopener noreferrer"
           data-action="openConfirmationDoc"
           data-canonical-url="${esc(url)}"
           title="${esc(label)}"
           aria-label="${esc(label)}">
          <span class="chip-icon">🔗</span>
          <span class="chip-label">${esc(label)}</span>
        </a>
      `;
      }).join('');
    }

    if (!hasAttachments && !linksMarkup) return null;

    let attMarkup = '';
    if (hasAttachments) {
      const count = loc.attachments.length;
      const label = `${count} ${count === 1 ? 'Fișier' : 'Fișiere'}`;
      attMarkup = `
        <button type="button"
                class="strip-chip strip-attachments attachment-count-btn subcard-chip"
                data-action="viewAttachments"
                data-id="${esc(loc.id)}"
                title="Vezi ${count} atașamente">
          <span class="chip-icon">📎</span>
          <span class="chip-label">${label}</span>
        </button>
      `;
    }

    return `
      <div class="subcard-slide subcard-slide-media" data-subcard-type="media">
        <div class="subcard-inner subcard-media-content">
          <div class="subcard-media-badge" aria-hidden="true">
            <svg class="subcard-media-svg" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
          </div>
          <div class="subcard-media-chips">
            ${linksMarkup}
            ${attMarkup}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 4. Subcard: Address (Modern structured design with vector icon badge)
   */
  function renderAddressCard(loc) {
    const address = (loc.address || '').trim();
    if (!address) return null;

    return `
      <div class="subcard-slide subcard-slide-address" data-subcard-type="address">
        <div class="subcard-inner subcard-address-content" data-action="copyAddress" data-address="${esc(address)}" role="button" tabindex="0" title="${esc(address)} • Apasă pentru a copia adresa">
          <div class="subcard-address-badge" aria-hidden="true">
            <svg class="subcard-address-svg" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
              <line x1="8" y1="2" x2="8" y2="18"/>
              <line x1="16" y1="6" x2="16" y2="22"/>
            </svg>
          </div>
          <div class="subcard-address-body">
            <div class="subcard-address-text card-address" title="${esc(address)}">${esc(address)}</div>
          </div>
          <button type="button" class="subcard-address-copy-btn" data-action="copyAddress" data-address="${esc(address)}" title="Copiază adresa" aria-label="Copiază adresa" tabindex="-1">
            <svg class="copy-svg" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect width="13" height="13" x="9" y="9" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Generates the entire subcards viewport HTML
   */
  function renderHTML(loc, options = {}) {
    if (!loc) return '';

    const conflictSlide = renderConflictCard(loc, options?.conflict);
    const flightSlide = renderFlightCard(loc);
    const notesSlide = renderNotesCard(loc);
    const mediaSlide = renderAttachmentsAndConfCard(loc);
    const addressSlide = renderAddressCard(loc);

    const slides = [];

    // 0. Conflict is top priority (0) - appears first until resolved
    if (conflictSlide) slides.push(conflictSlide);

    // 1. Flight is top priority if present
    if (flightSlide) slides.push(flightSlide);

    // 2. Notes
    if (notesSlide) slides.push(notesSlide);

    // 3. Attachments + Confirmation
    if (mediaSlide) slides.push(mediaSlide);

    // 4. Address (lowest priority when media/notes/flight present)
    if (addressSlide) slides.push(addressSlide);

    // Case G: Nothing available -> Do not render secondary area
    if (slides.length === 0) return '';

    const count = slides.length;

    // Case E/F: Exactly 1 sub-card -> No arrows, static
    if (count === 1) {
      return `
        <div class="subcards-viewport is-single" data-count="1" data-current-index="0">
          <div class="subcards-track">
            ${slides[0]}
          </div>
        </div>
      `;
    }

    // 2 or more sub-cards -> Interactive swipeable carousel with arrows
    return `
      <div class="subcards-viewport" data-count="${count}" data-current-index="0" tabindex="0" role="region" aria-label="Card details carousel">
        <button type="button" class="subcard-nav-arrow subcard-nav-prev" data-nav="prev" aria-label="Anterior" style="display:none;" tabindex="-1">
          ${CHEVRON_LEFT_SVG}
        </button>
        <div class="subcards-track">
          ${slides.join('')}
        </div>
        <button type="button" class="subcard-nav-arrow subcard-nav-next" data-nav="next" aria-label="Următor" tabindex="-1">
          ${CHEVRON_RIGHT_SVG}
        </button>
        <div class="subcards-indicators" aria-hidden="true">
          ${slides.map((_, i) => `<span class="subcard-dot${i === 0 ? ' is-active' : ''}"></span>`).join('')}
        </div>
      </div>
    `;
  }

  /**
   * Navigate carousel to target index
   */
  function goTo(viewportEl, targetIndex) {
    if (!viewportEl) return;
    const count = parseInt(viewportEl.dataset.count, 10) || 1;
    if (count <= 1) return;

    const clampedIndex = Math.max(0, Math.min(targetIndex, count - 1));
    viewportEl.dataset.currentIndex = clampedIndex;

    const track = viewportEl.querySelector('.subcards-track');
    if (track) {
      track.style.transform = `translateX(-${clampedIndex * 100}%)`;
    }

    // Update navigation arrows according to rules:
    // First sub-card -> hide left arrow completely
    // Last sub-card -> hide right arrow completely
    const prevBtn = viewportEl.querySelector('.subcard-nav-prev');
    const nextBtn = viewportEl.querySelector('.subcard-nav-next');

    if (prevBtn) {
      prevBtn.style.display = clampedIndex === 0 ? 'none' : 'flex';
    }
    if (nextBtn) {
      nextBtn.style.display = clampedIndex === count - 1 ? 'none' : 'flex';
    }

    // Update dots
    const dots = viewportEl.querySelectorAll('.subcard-dot');
    dots.forEach((dot, idx) => {
      dot.classList.toggle('is-active', idx === clampedIndex);
    });
  }

  /**
   * Attach swipe and desktop event listeners to a viewport element
   */
  function bindViewportEvents(viewportEl) {
    if (!viewportEl || viewportEl._subcardsBound) return;
    viewportEl._subcardsBound = true;

    const count = parseInt(viewportEl.dataset.count, 10) || 1;
    if (count <= 1) return;

    // 1. Desktop Arrow Clicks
    viewportEl.addEventListener('click', (e) => {
      const navBtn = e.target.closest('.subcard-nav-arrow');
      if (!navBtn) return;
      e.preventDefault();
      e.stopPropagation();

      const current = parseInt(viewportEl.dataset.currentIndex, 10) || 0;
      if (navBtn.dataset.nav === 'prev') {
        goTo(viewportEl, current - 1);
      } else if (navBtn.dataset.nav === 'next') {
        goTo(viewportEl, current + 1);
      }
    });

    // 2. Keyboard Navigation when focused
    viewportEl.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const current = parseInt(viewportEl.dataset.currentIndex, 10) || 0;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goTo(viewportEl, current - 1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goTo(viewportEl, current + 1);
      }
    });

    // 3. Mobile Touch Swipe
    let touchStartX = 0;
    let touchStartY = 0;
    let isHorizontalGesture = false;

    viewportEl.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      isHorizontalGesture = false;
    }, { passive: true });

    viewportEl.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 1) return;
      const currentX = e.touches[0].clientX;
      const currentY = e.touches[0].clientY;
      const deltaX = currentX - touchStartX;
      const deltaY = currentY - touchStartY;

      // If predominantly vertical movement, do NOT interfere with page scrolling
      if (!isHorizontalGesture) {
        if (Math.abs(deltaY) > Math.abs(deltaX)) {
          return;
        }
        if (Math.abs(deltaX) > 10) {
          isHorizontalGesture = true;
        }
      }
    }, { passive: true });

    viewportEl.addEventListener('touchend', (e) => {
      if (!isHorizontalGesture) return;
      const touchEndX = e.changedTouches[0].clientX;
      const deltaX = touchEndX - touchStartX;
      const current = parseInt(viewportEl.dataset.currentIndex, 10) || 0;

      // 40px threshold to avoid accidental navigation
      if (deltaX < -40) {
        // Swipe left -> next
        goTo(viewportEl, current + 1);
      } else if (deltaX > 40) {
        // Swipe right -> prev
        goTo(viewportEl, current - 1);
      }
    }, { passive: true });
  }

  /**
   * Initialize carousels inside container
   */
  function initCarousels(container) {
    const root = container || document;
    root.querySelectorAll('.subcards-viewport:not(.is-single)').forEach(bindViewportEvents);
  }

  /**
   * Update subcard area on a location card DOM node
   */
  function updateCard(cardEl, loc, options) {
    if (!cardEl || !loc) return;
    const existing = cardEl.querySelector('.subcards-viewport');
    const newHTML = renderHTML(loc, options);

    if (!newHTML) {
      if (existing) existing.remove();
      return;
    }

    if (existing) {
      existing.outerHTML = newHTML;
    } else {
      const actions = cardEl.querySelector('.card-actions');
      if (actions && actions.parentNode) {
        actions.insertAdjacentHTML('beforebegin', newHTML);
      }
    }

    const updatedEl = cardEl.querySelector('.subcards-viewport:not(.is-single)');
    if (updatedEl) bindViewportEvents(updatedEl);
  }

  // Export to window
  window.LocationSubcards = {
    renderHTML,
    initCarousels,
    goTo,
    updateCard
  };
})();
