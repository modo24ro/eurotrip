/**
 * components/summary-banner.js
 * Summary metrics banner and country filter dropdown
 * Includes Samsung Galaxy Z Fold 6 inner screen responsive header integration
 */

import { esc, flagHTML, flagText, formatEur } from '../core/utils.js';
import { fmtDate } from '../core/date-utils.js';

function resolveState(providedState) {
  if (providedState && typeof providedState === 'object') return providedState;
  if (typeof window !== 'undefined' && window.state) return window.state;
  return {};
}

/**
 * Measures the actual inner content width of summary-banner items (.banner-metrics + .banner-secondary)
 * rather than the full-width block container.
 */
export function getBannerContentWidth(banner) {
  if (!banner) return 0;
  const items = Array.from(banner.querySelectorAll('.banner-item')).filter(it => {
    if (it.classList.contains('banner-item-dates')) {
      const headerDates = document.getElementById('tripHeaderDates');
      if (headerDates && window.getComputedStyle && window.getComputedStyle(headerDates).display !== 'none' && headerDates.textContent.trim()) {
        return false;
      }
    }
    return true;
  });
  if (!items.length) return banner.scrollWidth || banner.offsetWidth || 0;
  let w = 0;
  items.forEach(it => {
    w += (it.offsetWidth || it.scrollWidth || 0);
  });
  w += (items.length - 1) * 6 + 20;
  return w;
}

/**
 * Detects if the current device is specifically a Samsung Galaxy Z Fold 6 using its inner/main screen.
 * - Checks UA for SM-F956 (Galaxy Z Fold 6) or Z Fold family SM-F9xx.
 * - Checks Android touch device with unfolded inner display dimensions (width 560-1400px, aspect ratio 0.50-1.90).
 * - Excludes Apple/iPads and outer folded cover screens (width < 560px).
 */
export function isZFold6InnerScreen() {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const model = window.navigator?.userAgentData?.model || '';

  // Exclude Apple devices (iPad/iPhone/Mac)
  if (/iPad|Macintosh|iPhone/i.test(ua)) return false;

  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  const w = window.innerWidth;
  const h = window.innerHeight;

  // Outer cover screen of Z Fold is narrow phone width (< 560px)
  if (w < 560) return false;

  const isZFoldModel = /SM-F9|SM-W9|Galaxy Z Fold/i.test(ua) || /SM-F9|SM-W9/i.test(model);
  if (isZFoldModel) {
    return true;
  }

  // Inner screen range (portrait or landscape): 560px - 1400px
  if (isTouch && w >= 560 && w <= 1400) {
    const ratio = w / h;
    if (ratio >= 0.50 && ratio <= 1.90) return true;
  }

  return false;
}

/**
 * Moves #summaryBanner into .app-header after .trip-brand-details (between .header-brand and .header-nav-group)
 * when there is sufficient horizontal room on the row, maximizing vertical space efficiency.
 * On Z Fold 6 inner screen and capable viewports, ensures seamless fit.
 */
export function syncZFold6SummaryBanner() {
  if (typeof document === 'undefined') return;
  const banner = document.getElementById('summaryBanner');
  const header = document.querySelector('.app-header');
  const brand = header?.querySelector('.header-brand');
  const navGroup = header?.querySelector('.header-nav-group');
  const controlsBar = document.querySelector('.controls-bar');

  if (!banner || !header || !brand) return;

  const restoreToOriginal = () => {
    if (banner.parentElement === header) {
      banner.classList.remove('in-header');
      if (controlsBar && controlsBar.parentNode) {
        controlsBar.parentNode.insertBefore(banner, controlsBar);
      } else {
        header.insertAdjacentElement('afterend', banner);
      }
    }
  };

  const isZFoldInner = isZFold6InnerScreen();
  if (document.body) {
    document.body.classList.toggle('is-zfold-inner', isZFoldInner);
  }

  // Viewports under 560px remain below header
  if (window.innerWidth < 560) {
    restoreToOriginal();
    return;
  }

  // Calculate available space in app-header between brand and navGroup
  const headerWidth = header.clientWidth;
  const brandWidth = brand.offsetWidth || 0;
  const navGroupWidth = navGroup ? navGroup.offsetWidth : 0;

  // Minimum required spacing before and after banner to guarantee it never overlaps addBtn
  const minRequiredSpacing = 36;
  const availableSpace = headerWidth - brandWidth - navGroupWidth - minRequiredSpacing;

  // Measure ACTUAL content width of summary-banner items (excluding dates which are under title)
  const bannerContentWidth = getBannerContentWidth(banner);

  if (bannerContentWidth > 0 && bannerContentWidth <= availableSpace) {
    // Move into app-header after trip-brand-details (inserted before navGroup)
    if (banner.parentElement !== header) {
      if (navGroup) {
        header.insertBefore(banner, navGroup);
      } else {
        header.appendChild(banner);
      }
      banner.classList.add('in-header');
    }
  } else {
    // Not enough space to fit properly without cramping: keep in original position
    restoreToOriginal();
  }
}

export function renderSummary(targetState) {
  const state = resolveState(targetState);
  const locs = state.trip?.locations ?? [];
  const enabled = locs.filter(l => l.enabled);
  const totalCost = enabled.reduce((s, l) => s + (l.cost || 0), 0);
  const countries = [...new Set(enabled.map(l => l.country).filter(Boolean))];
  const scheduled = enabled.filter(l => l.visit_date).length;
  const days = [...new Set(enabled.map(l => l.visit_date).filter(Boolean))].sort();
  const firstDay = days[0] ? fmtDate(days[0], { day: 'numeric', month: 'short' }) : '—';
  const lastDay = days[days.length - 1] ? fmtDate(days[days.length - 1], { day: 'numeric', month: 'short' }) : '—';

  const isFullyScheduled = enabled.length > 0 && scheduled === enabled.length;
  const schedClass = isFullyScheduled ? ' is-scheduled' : '';
  const schedTitle = isFullyScheduled
    ? `All ${enabled.length} active locations are scheduled`
    : `${scheduled} of ${enabled.length} active locations scheduled`;

  const hasTripDays = (days.length > 0 && firstDay !== '—');

  const el = document.getElementById('summaryBanner');
  if (el) {
    el.innerHTML = `
      <div class="banner-metrics">
        <div class="banner-item${schedClass}" title="${schedTitle}"><div class="banner-value">${scheduled}/${enabled.length}</div><div class="banner-label">Scheduled</div></div>
        <div class="banner-item"><div class="banner-value">${days.length}</div><div class="banner-label">Days</div></div>
        <div class="banner-item"><div class="banner-value">${formatEur(totalCost, state.trip?.currency)}</div><div class="banner-label">Budget</div></div>
      </div>
      ${(hasTripDays || countries.length > 0) ? `
        <div class="banner-secondary">
          ${hasTripDays ? `
            <div class="banner-item banner-item-dates">
              <div class="banner-value banner-dates-val">${firstDay} → ${lastDay}</div>
              <div class="banner-label">Dates</div>
            </div>
          ` : ''}
          ${countries.length > 0 ? `
            <div class="banner-item banner-item-countries">
              <div class="banner-countries-flags">
                ${countries.map(c => `
                  <button type="button" class="country-button" data-action="goToCountry" data-country="${esc(c)}" title="View ${esc(c)} in Countries">
                    ${flagHTML(c)}
                  </button>
                `).join('')}
              </div>
              <div class="banner-label">Countries</div>
            </div>
          ` : ''}
        </div>
      ` : ''}
    `;
  }

  let headerDatesEl = document.getElementById('tripHeaderDates');
  if (!headerDatesEl) {
    const brandDetails = document.querySelector('.trip-brand-details');
    if (brandDetails) {
      headerDatesEl = document.createElement('div');
      headerDatesEl.id = 'tripHeaderDates';
      headerDatesEl.className = 'trip-header-dates';
      brandDetails.appendChild(headerDatesEl);
    }
  }
  if (headerDatesEl) {
    if (hasTripDays) {
      headerDatesEl.innerHTML = `<span class="banner-value banner-dates-val trip-header-dates-val">${firstDay} → ${lastDay}</span>`;
      headerDatesEl.style.display = '';
    } else {
      headerDatesEl.innerHTML = '';
      headerDatesEl.style.display = 'none';
    }
  }

  // Sync Z Fold 6 banner placement if applicable
  syncZFold6SummaryBanner();
}

export function renderCountryFilter(targetState) {
  const state = resolveState(targetState);
  const countries = [...new Set((state.trip?.locations ?? []).map(l => l.country).filter(Boolean))].sort();
  const cur = state.filter?.country || 'all';
  const optionsHtml = `<option value="all">All Countries</option>` +
    countries.map(c => `<option value="${esc(c)}"${c === cur ? ' selected' : ''}>${flagText(c)} ${esc(c)}</option>`).join('');
  const sel = document.getElementById('countryFilter');
  if (sel) sel.innerHTML = optionsHtml;
  const selMobile = document.getElementById('countryFilterMobile');
  if (selMobile) selMobile.innerHTML = optionsHtml;
}

if (typeof window !== 'undefined') {
  window.renderSummary = (s) => renderSummary(s || window.state);
  window.renderCountryFilter = (s) => renderCountryFilter(s || window.state);
  window.syncZFold6SummaryBanner = syncZFold6SummaryBanner;
  window.isZFold6InnerScreen = isZFold6InnerScreen;

  // Re-check Z Fold 6 banner placement on resize/orientation changes
  window.addEventListener('resize', () => {
    syncZFold6SummaryBanner();
  }, { passive: true });

  window.addEventListener('orientationchange', () => {
    setTimeout(syncZFold6SummaryBanner, 100);
  }, { passive: true });
}
