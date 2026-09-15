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
 * Detects if the current device is specifically a Samsung Galaxy Z Fold 6 using its inner/main screen.
 * - Checks UA for SM-F956 (Galaxy Z Fold 6) or Z Fold family SM-F9xx.
 * - In DevTools/emulation: checks inner screen dimensions (width 600-960px, near-square aspect ratio 0.72-1.38, touch).
 * - Excludes Apple/iPads and outer folded cover screens (width < 600px).
 */
export function isZFold6InnerScreen() {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const model = window.navigator?.userAgentData?.model || '';
  const isZFoldModel = /SM-F956/i.test(ua) || /SM-F956/i.test(model);
  const isZFoldFamily = /SM-F9/i.test(ua) || /SM-F9/i.test(model);

  const w = window.innerWidth;
  const h = window.innerHeight;

  const isInnerScreenDimensions = w >= 600 && w <= 960;
  const isFoldRatio = (w / h >= 0.72 && w / h <= 1.38);

  if (isZFoldModel || isZFoldFamily) {
    return isInnerScreenDimensions && isFoldRatio;
  }

  // Exclude Apple devices (iPad/iPhone/Mac)
  if (/iPad|Macintosh|iPhone/i.test(ua)) return false;

  // Touch screen with Z Fold 6 inner screen physical characteristics (including Android & DevTools emulation)
  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  return isTouch && isInnerScreenDimensions && isFoldRatio;
}

/**
 * On Samsung Galaxy Z Fold 6 (inner/main screen ONLY):
 * Moves #summaryBanner into .app-header after .trip-brand-details (between .header-brand and .header-nav-group),
 * ONLY if there is enough horizontal space for it to fit properly with equal spacing before & after.
 * On all other devices or on Z Fold 6 outer screen, preserves original position below header.
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
  if (!isZFoldInner) {
    restoreToOriginal();
    return;
  }

  // Calculate available space in app-header between brand and navGroup
  const headerWidth = header.clientWidth;
  const brandWidth = brand.offsetWidth || 0;
  const navGroupWidth = navGroup ? navGroup.offsetWidth : 0;

  // Require minimum equal spacing: at least 24px before (after trip-brand-details) and 24px after = 48px
  const minRequiredSpacing = 48;
  const availableSpace = headerWidth - brandWidth - navGroupWidth - minRequiredSpacing;

  // Measure content width of summary-banner
  const bannerContentWidth = banner.scrollWidth || banner.offsetWidth;

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

  const el = document.getElementById('summaryBanner');
  if (el) {
    el.innerHTML = `
      <div class="banner-metrics">
        <div class="banner-item${schedClass}" title="${schedTitle}"><div class="banner-value">${scheduled}/${enabled.length}</div><div class="banner-label">Scheduled</div></div>
        <div class="banner-item"><div class="banner-value">${days.length}</div><div class="banner-label">Days</div></div>
        <div class="banner-item"><div class="banner-value">${formatEur(totalCost, state.trip?.currency)}</div><div class="banner-label">Budget</div></div>
      </div>
      ${(days.length > 0 || countries.length > 0) ? `
        <div class="banner-secondary">
          ${days.length > 0 ? `<div class="banner-item banner-item-dates"><span class="banner-dates-icon" aria-hidden="true">📅</span><div class="banner-dates-text"><div class="banner-value banner-dates-val">${firstDay} → ${lastDay}</div><div class="banner-label">Dates</div></div></div>` : ''}
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
    if (days.length > 0 && firstDay !== '—') {
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
