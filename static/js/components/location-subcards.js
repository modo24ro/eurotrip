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
   * 1. Subcard: Notes
   */
  function renderNotesCard(loc) {
    const notes = (loc.notes || '').trim();
    if (!notes) return null;
    return `
      <div class="subcard-slide subcard-slide-notes" data-subcard-type="notes">
        <div class="subcard-inner subcard-notes-content" title="${esc(notes)}">
          <span class="subcard-icon">📝</span>
          <span class="subcard-text subcard-notes-text">${esc(notes)}</span>
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
    const gateInfo = (dep.gate || arr.gate) ? `<span class="subcard-flight-gate">Gate ${esc(dep.gate || arr.gate)}</span>` : '';

    return `
      <div class="subcard-slide subcard-slide-flight" data-subcard-type="flight">
        <div class="subcard-inner subcard-flight-content" data-action="openFlightModal" data-loc-id="${esc(loc.id)}" role="button" tabindex="0" title="Vezi detaliile complete pentru zborul ${esc(flightCode)}">
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
      </div>
    `;
  }

  /**
   * 3. Subcard: Attachments + Confirmation
   */
  function renderAttachmentsAndConfCard(loc) {
    const hasAttachments = loc.attachments && loc.attachments.length > 0;
    const confUrl = (loc.confirmation_url || '').trim();
    const hasConf = confUrl && (confUrl.startsWith('http://') || confUrl.startsWith('https://'));

    if (!hasAttachments && !hasConf) return null;

    let confMarkup = '';
    if (hasConf) {
      const confLabel = (loc.confirmation_label || '').trim() || 'Confirmare';
      confMarkup = `
        <a class="strip-chip strip-confirmation confirmation-link subcard-chip"
           href="${esc(confUrl)}"
           target="_blank"
           rel="noopener noreferrer"
           data-action="openConfirmationDoc"
           data-canonical-url="${esc(confUrl)}"
           title="${esc(confLabel)}">
          <span class="chip-icon">📑</span>
          <span class="chip-label">${esc(confLabel)}</span>
        </a>
      `;
    }

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
          ${confMarkup}
          ${attMarkup}
        </div>
      </div>
    `;
  }

  /**
   * Generates the entire subcards viewport HTML
   */
  function renderHTML(loc) {
    if (!loc) return '';

    const slides = [];

    // 1. Notes (if any)
    const notesSlide = renderNotesCard(loc);
    if (notesSlide) slides.push(notesSlide);

    // 2. Flight (ONLY if category === 'transport_flight')
    const flightSlide = renderFlightCard(loc);
    if (flightSlide) slides.push(flightSlide);

    // 3. Attachments + Confirmation
    const mediaSlide = renderAttachmentsAndConfCard(loc);
    if (mediaSlide) slides.push(mediaSlide);

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
  function updateCard(cardEl, loc) {
    if (!cardEl || !loc) return;
    const existing = cardEl.querySelector('.subcards-viewport');
    const newHTML = renderHTML(loc);

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
