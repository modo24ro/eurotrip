/**
 * components/summary-banner.js
 * Summary metrics banner and country filter dropdown
 */

import { esc, flagHTML, flagText, formatEur } from '../core/utils.js';
import { fmtDate } from '../core/date-utils.js';

export function renderSummary(state) {
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
}

export function renderCountryFilter(state) {
  const countries = [...new Set((state.trip?.locations ?? []).map(l => l.country).filter(Boolean))].sort();
  const cur = state.filter.country;
  const optionsHtml = `<option value="all">All Countries</option>` +
    countries.map(c => `<option value="${esc(c)}"${c === cur ? ' selected' : ''}>${flagText(c)} ${esc(c)}</option>`).join('');
  const sel = document.getElementById('countryFilter');
  if (sel) sel.innerHTML = optionsHtml;
  const selMobile = document.getElementById('countryFilterMobile');
  if (selMobile) selMobile.innerHTML = optionsHtml;
}

if (typeof window !== 'undefined') {
  window.renderSummary = () => renderSummary(window.state);
  window.renderCountryFilter = () => renderCountryFilter(window.state);
}
