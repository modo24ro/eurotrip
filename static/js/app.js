'use strict';

// ============================================================
// STATE
// ============================================================
// Persisted UI prefs (survive refresh)
const PREFS_KEY = 'tripPlannerPrefs';
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); } catch { return {}; }
}
function savePrefs(patch) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...patch })); } catch { }
}

const _prefs = loadPrefs();

function isNarrowScreen() {
  return typeof window !== 'undefined' && window.innerWidth <= 768;
}

function getInitialView() {
  if (typeof window !== 'undefined') {
    const isMobile = window.innerWidth <= 980;
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('view');
    if (isMobile) {
      // On mobile, Days is ALWAYS the default initial navigation mode.
      // Do not restore another previously selected mobile navigation mode as the default.
      if (fromUrl && fromUrl !== 'list') {
        return fromUrl;
      }
      return 'day';
    }
    if (fromUrl) {
      return fromUrl;
    }
  }
  return _prefs.view || 'list';
}

function getInitialMapDay() {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('day') || params.get('mapDay');
    if (fromUrl) return fromUrl;
  }
  return _prefs.mapDay || null;
}

function updateMapDayUrl(day) {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    if (day && day !== 'all') {
      url.searchParams.set('day', day);
    } else {
      url.searchParams.delete('day');
      url.searchParams.delete('mapDay');
    }
    window.history.replaceState({}, '', url.toString());
  } catch (e) {
    console.warn('Could not update map day in URL:', e);
  }
}

function getInitialMapFullscreen() {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    if (params.get('fullscreen') === '1' || params.get('fs') === '1') return true;
    if (params.get('fullscreen') === '0' || params.get('fs') === '0') return false;
  }
  return !!_prefs.isMapFullscreen;
}

function updateMapFullscreenUrl(isFs) {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    if (isFs && state.view === 'map') {
      url.searchParams.set('fullscreen', '1');
    } else {
      url.searchParams.delete('fullscreen');
      url.searchParams.delete('fs');
    }
    window.history.replaceState({}, '', url.toString());
  } catch (e) {
    console.warn('Could not update map fullscreen in URL:', e);
  }
}

const appRoot = document.getElementById('app');
document.body.dataset.role = (appRoot && appRoot.dataset.role) || document.body.dataset.role || 'admin';
const state = {
  trip: null,
  role: (appRoot && appRoot.dataset.role) || document.body.dataset.role || 'admin',
  view: getInitialView(),
  filter: { search: '', category: 'all', country: 'all', showDisabled: true },
  sortBy: _prefs.sortBy || 'added',
  hideVisited: !!_prefs.hideVisited,
  cardsPerRow: _prefs.cardsPerRow ? parseInt(_prefs.cardsPerRow, 10) : (_prefs.singleCol ? 1 : undefined),
  singleCol: _prefs.singleCol !== undefined ? !!_prefs.singleCol : (typeof window !== 'undefined' && window.innerWidth >= 600 && window.innerWidth <= 960),
  unsaved: false,
  uploadPreviewData: null,
  installPrompt: null,
  map: null,
  mapRouteLayers: [],
  isMapFullscreen: getInitialView() === 'map' && getInitialMapFullscreen(),
  mapDay: getInitialMapDay(),
  routeDay: null,
  timelineDay: _prefs.timelineDay || 'all',
  mapExcluded: new Set(_prefs.mapExcluded || []),
  mapRouteType: _prefs.mapRouteType || 'streets',
  mapOptimized: false,
  routeOptimized: false,
  routeMode: _prefs.routeMode || 'transit',
  routeOrigin: _prefs.routeOrigin || 'itinerary',
  routeScope: _prefs.routeScope || 'all',
  currentCoords: null,
  routeTimes: null,
  notifications: [],
};

const CATEGORY_ICONS = {
  hotel: '🏨', transport: '✈️', restaurant: '🍽️',
  attraction: '🏛️', education: '📚', shopping: '🛍️',
  services: '🔧', club: '🎵', other: '📍',
};

const VALID_CATEGORIES = Object.keys(CATEGORY_ICONS);

function getFileMeta(filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  const isPdf = ext === 'pdf';
  const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'bmp'].includes(ext);
  let icon = '📎';
  if (isPdf) icon = '📄';
  else if (isImage) icon = '🖼️';
  else if (['xls', 'xlsx', 'csv'].includes(ext)) icon = '📊';
  else if (['doc', 'docx', 'txt', 'rtf'].includes(ext)) icon = '📝';
  return { ext, isPdf, isImage, icon };
}

function formatFileSize(bytes) {
  if (!bytes || isNaN(bytes)) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ISO-3166-1 alpha-2 codes — used to fetch real flag images
const COUNTRY_CODES = {
  'Germany': 'de', 'Spain': 'es', 'Romania': 'ro',
  'France': 'fr', 'Italy': 'it', 'Netherlands': 'nl',
  'Belgium': 'be', 'Austria': 'at', 'Switzerland': 'ch',
  'Czech Republic': 'cz', 'Poland': 'pl', 'Hungary': 'hu',
  'Portugal': 'pt', 'Greece': 'gr', 'Croatia': 'hr',
  'Slovenia': 'si', 'Slovakia': 'sk', 'Denmark': 'dk',
  'Sweden': 'se', 'Norway': 'no', 'Finland': 'fi',
  'United Kingdom': 'gb', 'Ireland': 'ie', 'Serbia': 'rs',
  'Bulgaria': 'bg', 'Moldova': 'md', 'Ukraine': 'ua',
  'Latvia': 'lv', 'Lithuania': 'lt', 'Estonia': 'ee',
  'Luxembourg': 'lu', 'Malta': 'mt', 'Cyprus': 'cy',
  'Iceland': 'is', 'Bosnia': 'ba', 'Montenegro': 'me',
  'Albania': 'al', 'North Macedonia': 'mk', 'Andorra': 'ad',
};

/**
 * Returns an <img> flag from flagcdn.com for HTML contexts.
 * Falls back to globe emoji if the code is unknown or image fails.
 */
function flagHTML(country, countryCode) {
  const code = ((countryCode && countryCode.length === 2 ? countryCode : null)
    || COUNTRY_CODES[country] || '').toLowerCase();
  if (!code) return '<span class="flag-fallback">🌍</span>';
  return `<img src="https://flagcdn.com/20x15/${code}.png"
       srcset="https://flagcdn.com/40x30/${code}.png 2x"
       alt="${code.toUpperCase()}" class="flag-img"
       onerror="this.outerHTML='<span class=flag-fallback>🌍</span>'">`;
}

/** Plain text code for <select> options (no HTML tags allowed). */
function flagText(country, countryCode) {
  const code = ((countryCode && countryCode.length === 2 ? countryCode : null)
    || COUNTRY_CODES[country] || '').toUpperCase();
  return code ? `[${code}]` : '';
}

// ============================================================
// API
// ============================================================
const api = {
  async getTrips() {
    const res = await fetch('/api/trips');
    if (!res.ok) throw new Error('Failed to load trips');
    return res.json();
  },
  async createTrip(name) {
    const res = await fetch('/api/trips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not create trip');
    return data;
  },
  async selectTrip(id) {
    const res = await fetch('/api/trips/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not switch trip');
    return data;
  },
  async deleteTrip(id) {
    const res = await fetch(`/api/trips/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not delete trip');
    return data;
  },
  async getTrip() {
    const res = await fetch('/api/trip');
    if (!res.ok) throw new Error('Failed to load trip data');
    return res.json();
  },
  async saveTrip(trip) {
    const res = await fetch('/api/trip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(trip),
    });
    if (!res.ok) throw new Error('Save failed');
    return res.json();
  },
  async uploadFile(file) {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Upload failed');
    }
    return res.json();
  },
};

// ============================================================
// MUTATIONS
// ============================================================
function updateLocation(id, fields) {
  const loc = state.trip.locations.find(l => l.id === id);
  if (!loc) return;
  Object.assign(loc, fields);
  markUnsaved();
  renderStats();
  renderSummary();
}

function deleteLocation(id) {
  const idx = state.trip.locations.findIndex(l => l.id === id);
  if (idx === -1) return;
  const card = document.querySelector(`.location-card[data-id="${CSS.escape(id)}"]`);
  if (card) {
    card.style.transition = 'all 0.22s ease';
    card.style.opacity = '0';
    card.style.transform = 'scale(0.94)';
    setTimeout(() => {
      state.trip.locations.splice(idx, 1);
      markUnsaved();
      renderMain();
      renderStats();
      renderSummary();
    }, 230);
  } else {
    state.trip.locations.splice(idx, 1);
    markUnsaved();
    renderMain();
    renderStats();
    renderSummary();
  }
  closeLocationModal();
}

function closeLocationModal() {
  document.getElementById('locationModal')?.classList.remove('open');
  document.getElementById('notificationLocationModal')?.classList.remove('open');
}

let pendingDeleteLocationId = '';

function closeDeleteLocationModal() {
  pendingDeleteLocationId = '';
  document.getElementById('deleteLocationModal')?.classList.remove('open');
}

function openDeleteLocationModal(id) {
  const location = state.trip?.locations.find(item => item.id === id);
  if (!location) return;
  pendingDeleteLocationId = id;
  const name = document.getElementById('deleteLocationName');
  if (name) name.textContent = location.name || 'Unnamed location';
  document.getElementById('deleteLocationModal')?.classList.add('open');
}

function duplicateLocation(id) {
  const idx = state.trip.locations.findIndex(l => l.id === id);
  if (idx === -1) return;
  const copy = { ...state.trip.locations[idx], id: genId(), visited: false };
  state.trip.locations.splice(idx + 1, 0, copy);
  markUnsaved();
  renderMain();
  renderStats();
  renderSummary();
  setTimeout(() => {
    const newCard = document.querySelector(`.location-card[data-id="${CSS.escape(copy.id)}"]`);
    if (newCard) newCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 60);
}

function addBlankLocation() {
  const loc = {
    id: genId(),
    name: 'New Location',
    address: '',
    country: 'Unknown',
    city: 'Unknown',
    country_code: '',
    coordinates: [null, null],
    google_maps_url: '',
    enabled: true,
    visit_date: '',
    visit_time: '',
    cost: 0,
    notes: '',
    category: 'other',
    original_date: '',
    place_info: '',
  };
  state.trip.locations.unshift(loc);
  state.sortBy = 'added';
  state.filter.search = '';
  state.filter.category = 'all';
  state.filter.country = 'all';
  savePrefs({ sortBy: 'added' });
  const sortSelect = document.getElementById('sortSelect');
  if (sortSelect) sortSelect.value = 'added';
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.value = '';
  const categoryFilter = document.getElementById('categoryFilter');
  if (categoryFilter) categoryFilter.value = 'all';
  const countryFilter = document.getElementById('countryFilter');
  if (countryFilter) countryFilter.value = 'all';
  markUnsaved();
  renderMain();
  renderStats();
  renderSummary();
  // Scroll to top and focus the name field
  setTimeout(() => {
    const newCard = document.querySelector(`.location-card[data-id="${CSS.escape(loc.id)}"]`);
    if (newCard) {
      newCard.classList.add('editing');
      const editBtn = newCard.querySelector('[data-action="edit"]');
      if (editBtn) {
        editBtn.classList.add('active');
        editBtn.title = 'Close edit';
      }
      newCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const nameField = newCard.querySelector('[data-field="name"]');
      if (nameField) { nameField.focus(); nameField.select(); }
    }
  }, 100);
}

function markUnsaved() {
  if (!state.unsaved) {
    state.unsaved = true;
    document.getElementById('unsavedDot')?.classList.add('visible');
  }
}

// ============================================================
// FILTERING & SORTING
// ============================================================
function getFilteredLocations() {
  let locs = state.trip?.locations ?? [];
  const { search, category, country, showDisabled } = state.filter;

  if (!showDisabled) locs = locs.filter(l => l.enabled);
  if (state.hideVisited) locs = locs.filter(l => !l.visited);
  if (category !== 'all') locs = locs.filter(l => l.category === category);
  if (country !== 'all') locs = locs.filter(l => l.country === country);

  if (search.trim()) {
    const q = search.toLowerCase();
    locs = locs.filter(l =>
      l.name.toLowerCase().includes(q) ||
      (l.city && l.city.toLowerCase().includes(q)) ||
      (l.country && l.country.toLowerCase().includes(q)) ||
      (l.address && l.address.toLowerCase().includes(q)) ||
      (l.notes && l.notes.toLowerCase().includes(q))
    );
  }

  switch (state.sortBy) {
    case 'date':
      locs = [...locs].sort((a, b) => {
        if (!a.visit_date && !b.visit_date) return 0;
        if (!a.visit_date) return 1;
        if (!b.visit_date) return -1;
        const d = a.visit_date.localeCompare(b.visit_date);
        return d !== 0 ? d : (a.visit_time || '').localeCompare(b.visit_time || '');
      });
      break;
    case 'name': locs = [...locs].sort((a, b) => a.name.localeCompare(b.name)); break;
    case 'cost': locs = [...locs].sort((a, b) => (b.cost || 0) - (a.cost || 0)); break;
    case 'city': locs = [...locs].sort((a, b) => {
      const cc = (a.city || '').localeCompare(b.city || '');
      return cc !== 0 ? cc : a.name.localeCompare(b.name);
    }); break;
    case 'country': locs = [...locs].sort((a, b) => {
      const cc = a.country.localeCompare(b.country);
      return cc !== 0 ? cc : a.city.localeCompare(b.city);
    }); break;
    // 'added': original order
  }

  return locs;
}

// ============================================================
// RENDERING
// ============================================================
function render() {
  renderStats();
  renderSummary();
  renderCountryFilter();
  renderMain();
}

function renderStats() {
  // Toate statisticile sunt afișate exclusiv în summary-banner
}

function renderSummary() {
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
        <div class="banner-item"><div class="banner-value">${formatCurrency(totalCost, state.trip?.currency)}</div><div class="banner-label">Budget</div></div>
      </div>
      ${(days.length > 0 || countries.length > 0) ? `
        <div class="banner-secondary">
          ${days.length > 0 ? `<div class="banner-item banner-item-dates"><span class="banner-dates-icon" aria-hidden="true">📅</span><div class="banner-dates-text"><div class="banner-value banner-dates-val">${firstDay} → ${lastDay}</div><div class="banner-label">Dates</div></div></div>` : ''}
          ${countries.length > 0 ? `<div class="banner-countries">${countries.map(c => `<button type="button" class="country-badge" data-action="goToCountry" data-country="${esc(c)}" title="View ${esc(c)} in Countries">${flagHTML(c)}<span class="country-badge-name">${esc(c)}</span></button>`).join('')}</div>` : ''}
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

function renderCountryFilter() {
  const countries = [...new Set((state.trip?.locations ?? []).map(l => l.country).filter(Boolean))].sort();
  const cur = state.filter.country;
  const optionsHtml = `<option value="all">All Countries</option>` +
    countries.map(c => `<option value="${esc(c)}"${c === cur ? ' selected' : ''}>${flagText(c)} ${esc(c)}</option>`).join('');
  const sel = document.getElementById('countryFilter');
  if (sel) sel.innerHTML = optionsHtml;
  const selMobile = document.getElementById('countryFilterMobile');
  if (selMobile) selMobile.innerHTML = optionsHtml;
}

function renderMain() {
  const el = document.getElementById('mainContent');
  if (!el) return;
  if (state.view === 'list' && isNarrowScreen()) {
    state.view = 'day';
    savePrefs({ view: 'day' });
    document.querySelectorAll('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === 'day'));
    document.querySelectorAll('.mnav-btn[data-view]').forEach(t => t.classList.toggle('active', t.dataset.view === 'day'));
  }
  if (state.view !== 'map') {
    exitMapFullscreen();
  }
  switch (state.view) {
    case 'list': el.innerHTML = renderListView(); break;
    case 'day': el.innerHTML = renderDayView(); break;
    case 'country': el.innerHTML = renderCountryView(); break;
    case 'timeline': el.innerHTML = renderTimelineView(); break;
    case 'table': el.innerHTML = renderTableView(); break;
    case 'map': el.innerHTML = renderMapView(); break;
    case 'route': el.innerHTML = renderRouteView(); break;
  }
  if (state.view === 'list' || state.view === 'day' || state.view === 'country') {
    scheduleEqualizeCardHeights();
  }
  if (state.view === 'map') requestAnimationFrame(renderMap);
  if (state.view === 'route') requestAnimationFrame(initRouteView);
  updateControlsBarHeight();
  updateDaysToggleLabel();
}

function renderMapView() {
  const allLocations = getFilteredLocations();
  const days = [...new Set(allLocations.map(loc => loc.visit_date).filter(Boolean))].sort();
  const today = getTodayDateString();

  if (state.mapDay === null || state.mapDay === undefined || (state.mapDay !== 'all' && !days.includes(state.mapDay))) {
    const preferred = getInitialMapDay();
    if (preferred && (preferred === 'all' || days.includes(preferred))) {
      state.mapDay = preferred;
    } else {
      state.mapDay = days.includes(today) ? today : 'all';
    }
    savePrefs({ mapDay: state.mapDay });
  }

  updateMapDayUrl(state.mapDay);

  // Pe hartă afișăm doar locațiile rămase active (fără cele marcate Done/visited, excluse din traseu sau inactive)
  const activeMapLocations = allLocations.filter(loc => !loc.visited && !loc.excluded && !state.mapExcluded.has(loc.id) && loc.enabled !== false);
  const locations = state.mapDay === 'all' ? activeMapLocations : activeMapLocations.filter(loc => loc.visit_date === state.mapDay);
  const mapped = locations.filter(loc => hasValidCoordinates(loc.coordinates));
  const fixedCount = locations.filter(loc => loc.visit_time && hasValidCoordinates(loc.coordinates)).length;
  const flexibleCount = mapped.length - fixedCount;
  const missingLocations = locations.filter(loc => !hasValidCoordinates(loc.coordinates));
  const missing = missingLocations.length;
  const isFs = isMapFullscreenActive();
  if (isFs) {
    document.body.classList.add('map-is-fullscreen');
  }

  return `<div class="map-view-wrap${isFs ? ' is-fullscreen' : ''}">
    <div class="map-toolbar">
      <div class="map-toolbar-row map-toolbar-controls">
        <label class="map-day-label" title="Selectează ziua">
          <span class="toolbar-label-txt">Zi:</span>
          <select id="mapDaySelect" class="filter-select">
            <option value="all"${state.mapDay === 'all' ? ' selected' : ''}>Toate zilele</option>
            ${days.map(day => `<option value="${esc(day)}"${day === state.mapDay ? ' selected' : ''}>${esc(fmtDate(day, { day: 'numeric', month: 'short', year: 'numeric' }))}</option>`).join('')}
          </select>
        </label>
        
        <button class="btn-secondary map-optimize-btn" id="optimizeMapBtn" type="button" title="Comută ordinea optimizată a traseului">
          ${state.mapOptimized ? 'Arată orele' : 'Arată ordinea'}
        </button>

        <button class="btn-secondary map-route-mode-btn" id="toggleMapRouteModeBtn" type="button" title="${state.mapRouteType === 'direct' ? 'Comută la traseu pe străzi (varianta nouă)' : 'Comută la linii directe clasice'}">
          ${state.mapRouteType === 'direct' ? '🛣️ Pe străzi' : '📏 Linii directe'}
        </button>
        
        <span class="map-locations-chip">📍 ${mapped.length} pe hartă</span>
        ${mapped.length === 0 ? '<span class="map-all-done-note">🎉 Toate locațiile sunt făcute sau excluse!</span>' : ''}
        
        ${missing ? `<span class="map-missing" title="${missingLocations.map(loc => esc(loc.name)).join(' · ')}">⚠️ ${missing} fără coordonate</span>` : ''}
        ${state.role === 'admin' && missing ? '<button class="btn-secondary geocode-missing-btn" id="geocodeMissingBtn" type="button">Găsește coordonate</button>' : ''}

      </div>
    </div>
    <div class="map-container-relative">
      <button class="map-float-fullscreen-btn" id="mapFloatFullscreenBtn" type="button" title="Comută ecran complet (Full Screen)" aria-label="Comută ecran complet">
        <svg class="fs-enter-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
        <svg class="fs-exit-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>
      </button>
      <div id="tripMap" class="trip-map" aria-label="Trip locations map"></div>
    </div>
  </div>`;
}

function getNextByDayLocation(targetDay = state.routeDay || 'all') {
  // 1. If By Day is currently rendered in the DOM, grab directly from the first visible active card
  const dayCards = document.querySelectorAll('.day-group .location-card');
  for (const card of dayCards) {
    if (!card.classList.contains('row-visited') && !card.classList.contains('card-excluded') && !card.classList.contains('disabled') && card.offsetParent !== null) {
      const cardId = card.dataset.id;
      if (state.mapExcluded.has(cardId)) continue;
      const found = state.trip?.locations.find(l => l.id === cardId);
      if (found && !found.visited && !found.excluded && found.enabled !== false && !state.mapExcluded.has(found.id) && hasValidCoordinates(found.coordinates)) return found;
    }
  }

  // 2. Otherwise compute from data following the exact By Day rules:
  const allLocs = getFilteredLocations();
  const groups = {};
  for (const loc of allLocs) {
    if (loc.enabled === false || loc.visited || loc.excluded || state.mapExcluded.has(loc.id)) continue;
    const key = loc.visit_date || '__none__';
    (groups[key] = groups[key] || []).push(loc);
  }
  const keys = Object.keys(groups).filter(k => k !== '__none__').sort();
  if (groups['__none__']) keys.push('__none__');

  // If a specific day is selected in route view:
  if (targetDay !== 'all' && groups[targetDay]) {
    const dayLocs = [...groups[targetDay]].sort((a, b) => (a.visit_time || '99:99').localeCompare(b.visit_time || '99:99'));
    const nextUnvisited = dayLocs.find(l => !l.visited && !l.excluded && !state.mapExcluded.has(l.id) && hasValidCoordinates(l.coordinates));
    if (nextUnvisited) return nextUnvisited;
    return null;
  }

  // If all days: iterate through sorted days
  for (const key of keys) {
    const dayLocs = [...groups[key]].sort((a, b) => (a.visit_time || '99:99').localeCompare(b.visit_time || '99:99'));
    const nextUnvisited = dayLocs.find(l => !l.visited && !l.excluded && !state.mapExcluded.has(l.id) && hasValidCoordinates(l.coordinates));
    if (nextUnvisited) return nextUnvisited;
  }

  return null;
}

function getNextByDayName(targetDay = state.routeDay || 'all') {
  // 1. If By Day is currently rendered in the DOM, grab directly from the first visible card-name-text
  const dayCards = document.querySelectorAll('.day-group .location-card');
  for (const card of dayCards) {
    if (!card.classList.contains('row-visited') && !card.classList.contains('card-excluded') && !card.classList.contains('disabled') && card.offsetParent !== null) {
      const cardId = card.dataset.id;
      if (state.mapExcluded.has(cardId)) continue;
      const found = state.trip?.locations.find(l => l.id === cardId);
      if (found && (found.visited || found.excluded || found.enabled === false || state.mapExcluded.has(found.id))) continue;
      const nameEl = card.querySelector('.card-name-text') || card.querySelector('.card-name-field');
      const text = (nameEl?.textContent || nameEl?.value || '').trim();
      if (text) return text;
    }
  }

  // 2. Otherwise compute from next location
  const nextLoc = getNextByDayLocation(targetDay);
  if (nextLoc) {
    const safecat = VALID_CATEGORIES.includes(nextLoc.category) ? nextLoc.category : 'other';
    const icon = CATEGORY_ICONS[safecat] || '📍';
    const timeInfo = nextLoc.visit_time ? ` (${nextLoc.visit_time})` : '';
    return `${icon} ${nextLoc.name}${timeInfo}`;
  }
  return 'Următoarea oprire';
}

function renderRouteView() {
  const allLocations = getFilteredLocations();
  const days = [...new Set(allLocations.map(loc => loc.visit_date).filter(Boolean))].sort();
  const today = getTodayDateString();

  if (state.routeDay === null || state.routeDay === undefined || (state.routeDay !== 'all' && !days.includes(state.routeDay))) {
    state.routeDay = days.includes(today) ? today : 'all';
  }
  const currentDay = state.routeDay;
  const activeLocations = allLocations.filter(loc => !loc.visited && !loc.excluded && !state.mapExcluded.has(loc.id) && loc.enabled !== false);
  const locations = currentDay === 'all' ? activeLocations : activeLocations.filter(loc => loc.visit_date === currentDay);
  const mapped = locations.filter(loc => hasValidCoordinates(loc.coordinates));
  const currentOrigin = state.routeOrigin || 'itinerary';
  const currentMode = state.routeMode || 'transit';
  const currentScope = state.routeScope || 'next';

  const nextName = getNextByDayName(currentDay);
  const shortNextName = nextName ? (nextName.length > 18 ? nextName.slice(0, 17) + '…' : nextName) : '';
  const nextOptionLabel = nextName ? `🎯 Următoarea: ${shortNextName}` : '🎯 Următoarea';

  return `<div class="route-view-wrap">
    <div class="route-toolbar">
      <div class="route-toolbar-header">
        <div class="route-toolbar-status">
          <span class="map-locations-chip">📍 ${mapped.length} opriri</span>
          ${nextName ? `<span class="route-next-preview" title="${esc(nextName)}">🎯 <b>${esc(nextName)}</b></span>` : ''}
        </div>
        <button class="btn-secondary route-options-modal-btn" id="openRouteModalBtn" type="button" title="Opțiuni detaliate rută &amp; navigare">
          ⚙️ <span>Opțiuni</span>
        </button>
      </div>

      <div class="route-toolbar-row route-toolbar-controls">
        <label class="map-day-label" title="Selectează ziua">
          <span class="toolbar-label-txt">Zi:</span>
          <select id="routeDaySelect" class="filter-select">
            <option value="all"${currentDay === 'all' ? ' selected' : ''}>Toate zilele</option>
            ${days.map(day => `<option value="${esc(day)}"${day === currentDay ? ' selected' : ''}>${esc(fmtDate(day, { day: 'numeric', month: 'short', year: 'numeric' }))}</option>`).join('')}
          </select>
        </label>

        <label class="map-mode-label" title="Mod de transport">
          <span class="toolbar-label-txt">Mod:</span>
          <select id="routeModeSelect" class="filter-select">
            <option value="transit"${currentMode === 'transit' ? ' selected' : ''}>🚌 Transit</option>
            <option value="walking"${currentMode === 'walking' ? ' selected' : ''}>🚶 Pe jos</option>
            <option value="driving"${currentMode === 'driving' ? ' selected' : ''}>🚗 Mașină</option>
          </select>
        </label>

        <label class="map-origin-label" title="Punct de plecare">
          <span class="toolbar-label-txt">Origine:</span>
          <select id="routeOriginSelect" class="filter-select">
            <option value="itinerary"${currentOrigin === 'itinerary' ? ' selected' : ''}>📌 Anterior</option>
            <option value="current"${currentOrigin === 'current' ? ' selected' : ''}>📍 GPS (Locația mea)</option>
          </select>
        </label>

        <label class="route-scope-label" title="Destinație traseu">
          <span class="toolbar-label-txt">Destinație:</span>
          <select id="routeScopeSelect" class="filter-select">
            <option value="next"${currentScope === 'next' ? ' selected' : ''}>${esc(nextOptionLabel)}</option>
            <option value="all"${currentScope === 'all' ? ' selected' : ''}>Toate (${mapped.length})</option>
          </select>
        </label>
      </div>

      <div class="route-toolbar-row route-toolbar-actions">
        <button class="btn-primary route-calc-btn" id="calculateRouteTimesBtn" type="button" title="Calculează traseul și timpii de deplasare">
          <span class="btn-icon">⚡</span> <span>Calculează</span>
        </button>
        <button class="btn-secondary route-direct-nav-btn" id="directNavActionBtn" type="button" title="Deschide navigația în aplicația Google Maps">
          <span class="btn-icon">🧭</span> <span>Navighează</span>
        </button>
        <button class="btn-secondary route-optimize-btn" id="optimizeRouteBtn" type="button" title="Comută între ordinea optimizată și ordinea orelor">
          <span class="btn-icon">${state.routeOptimized ? '🕒' : '🪄'}</span> <span>${state.routeOptimized ? 'Ordine ore' : 'Optimizează'}</span>
        </button>
      </div>
    </div>

    <div id="routeTimesPanel" class="route-times-panel">
      ${!state.routeTimes ? `
        <div class="route-empty-hint">
          <div class="route-hint-icon">🧭</div>
          <div class="route-hint-body">
            <strong>Calculează traseul și timpii de deplasare</strong>
            <p>Destinație curentă: <b>${esc(nextName || 'Următoarea oprire')}</b>. Mod implicit: <b>Transport public</b>. Apasă <b>Calculează traseu</b> pentru timpi detaliați sau <b>Navighează acum</b> pentru Google Maps.</p>
          </div>
        </div>
      ` : ''}
    </div>
  </div>`;
}

function getUserCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Browserul nu suportă geolocația.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        const coords = [pos.coords.longitude, pos.coords.latitude];
        state.currentCoords = coords;
        resolve(coords);
      },
      err => {
        let msg = 'Nu s-a putut obține locația GPS.';
        if (err.code === 1) msg = 'Accesul la locație a fost refuzat.';
        else if (err.code === 2) msg = 'Locația GPS nu este disponibilă.';
        else if (err.code === 3) msg = 'Timpul pentru GPS a expirat.';
        reject(new Error(msg));
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
  });
}

function updateMapUserGpsMarker(coords) {
  if (!state.map || !coords || !window.L) return;
  const [lon, lat] = coords;
  if (state.userGpsMarker) {
    try { state.userGpsMarker.remove(); } catch (e) { }
    state.userGpsMarker = null;
  }
  const userIcon = L.divIcon({
    className: 'user-gps-marker',
    html: '<div class="user-gps-dot"><div class="user-gps-pulse"></div></div>',
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  });
  state.userGpsMarker = L.marker([lat, lon], { icon: userIcon, zIndexOffset: 1000 }).addTo(state.map);
  state.userGpsMarker.bindTooltip('Locația ta actuală (GPS)', { direction: 'top', offset: [0, -10] });
}

function getRouteLocations() {
  const allLocations = getFilteredLocations();
  const currentDay = state.routeDay || 'all';
  const activeLocations = allLocations.filter(loc => !loc.visited && !loc.excluded && !state.mapExcluded.has(loc.id) && loc.enabled !== false);
  const locations = currentDay === 'all' ? activeLocations : activeLocations.filter(loc => loc.visit_date === currentDay);
  const groups = {};
  locations.forEach(loc => {
    if (hasValidCoordinates(loc.coordinates)) {
      (groups[loc.visit_date || '__none__'] ||= []).push(loc);
    }
  });
  return Object.keys(groups).sort().flatMap(key => state.routeOptimized
    ? optimizeDayRoute(groups[key])
    : groups[key].sort((a, b) => (a.visit_time || '99:99').localeCompare(b.visit_time || '99:99')));
}

async function executeRouteCalculation({ origin = state.routeOrigin || 'itinerary', scope = state.routeScope || 'all', mode = state.routeMode || 'transit' } = {}) {
  const dayLocations = getRouteLocations();
  if (!dayLocations.length) {
    toast('Nu există locații cu coordonate pentru ziua selectată.', 'warning');
    return;
  }

  let points = [];
  if (origin === 'current') {
    let userCoords = state.currentCoords;
    if (!userCoords) {
      toast('Se obține locația GPS curentă...', 'info');
      try {
        userCoords = await getUserCurrentLocation();
      } catch (err) {
        toast(err.message, 'error');
        return;
      }
    }
    updateMapUserGpsMarker(userCoords);

    const startPoint = {
      id: '__user_current__',
      name: 'Locația ta actuală (GPS)',
      coordinates: userCoords,
      isCurrentLocation: true
    };

    if (scope === 'next') {
      const nextStop = getNextByDayLocation(state.routeDay) || dayLocations.find(l => !l.visited) || dayLocations[0];
      points = [startPoint, nextStop];
    } else {
      points = [startPoint, ...dayLocations];
    }
  } else {
    if (scope === 'next') {
      if (dayLocations.length < 2) {
        toast('Sunt necesare cel puțin două locații pentru calculul rutei.', 'warning');
        return;
      }
      const nextStop = getNextByDayLocation(state.routeDay) || dayLocations.find(l => !l.visited) || dayLocations[1];
      const stopIdx = dayLocations.findIndex(l => l.id === nextStop?.id);
      const startIdx = stopIdx > 0 ? stopIdx - 1 : 0;
      const endIdx = stopIdx > 0 ? stopIdx : Math.min(1, dayLocations.length - 1);
      points = [dayLocations[startIdx], dayLocations[endIdx]];
    } else {
      if (dayLocations.length < 2) {
        toast('Sunt necesare cel puțin două locații pentru calculul rutei.', 'warning');
        return;
      }
      points = dayLocations;
    }
  }

  if (points.length < 2) {
    toast('Sunt necesare cel puțin 2 puncte pentru a calcula traseul.', 'warning');
    return;
  }

  const button = document.getElementById('calculateRouteTimesBtn') || document.getElementById('calculateRouteTimes');
  if (button) {
    button.disabled = true;
    button.innerHTML = '<span class="btn-icon">⏳</span> <span>Calcul…</span>';
  }

  try {
    const response = await fetch('/api/route-times', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, points: points.map(loc => loc.coordinates) }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Nu s-a putut calcula traseul');
    state.routeTimes = { data, points, origin, scope, mode };
    renderRouteTimes();

    if (state.map) {
      if (state.mapRouteLine) {
        state.map.removeLayer(state.mapRouteLine);
        state.mapRouteLine = null;
      }
      const streetCoords = (data.coordinates && data.coordinates.length > 0)
        ? data.coordinates
        : points.map(p => [Number(p.coordinates[1]), Number(p.coordinates[0])]);
      state.mapRouteLine = L.polyline(streetCoords, {
        color: origin === 'current' ? '#0ea5e9' : '#5c73f2',
        weight: 5,
        opacity: 0.88,
        dashArray: origin === 'current' ? '6 6' : null
      }).addTo(state.map);
      state.map.fitBounds(L.latLngBounds(streetCoords), { padding: [35, 35] });
    }
    toast(`Traseu calculat (${mode === 'transit' ? 'Transport public' : mode === 'walking' ? 'Pe jos' : 'Mașină'}).`, 'success');
  } catch (error) {
    toast('Calcul traseu eșuat: ' + error.message, 'error');
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = '<span class="btn-icon">⚡</span> <span>Calculează</span>';
    }
  }
}

async function openDirectNavigation(destinationLocation) {
  const dayLocations = getRouteLocations();
  const nextTarget = getNextByDayLocation(state.routeDay);
  const target = destinationLocation || nextTarget || dayLocations.find(l => !l.visited) || dayLocations[0];
  if (!target) {
    toast('Selectează o destinație validă.', 'warning');
    return;
  }

  const mode = state.routeMode === 'transit' ? 'transit' : (state.routeMode === 'walking' ? 'walking' : 'driving');
  toast('Se deschide navigația în Google Maps...', 'info');

  let originParam = '';
  try {
    const coords = state.currentCoords || await getUserCurrentLocation();
    originParam = `&origin=${coords[1]},${coords[0]}`;
  } catch {
    // Default to device native GPS location when origin is omitted in Google Maps
  }

  let destParam = '';
  if (hasValidCoordinates(target.coordinates)) {
    destParam = `${target.coordinates[1]},${target.coordinates[0]}`;
  } else if (target.address) {
    destParam = encodeURIComponent(target.address);
  } else if (target.name) {
    destParam = encodeURIComponent(`${target.name} ${target.city || ''} ${target.country || ''}`.trim());
  }

  if (!destParam) {
    if (target.google_maps_url) {
      window.open(safeMapsUrl(target.google_maps_url), '_blank', 'noopener,noreferrer');
      return;
    }
    toast('Locația nu are o adresă sau coordonate valide.', 'warning');
    return;
  }

  const mapsUrl = `https://www.google.com/maps/dir/?api=1${originParam}&destination=${destParam}&travelmode=${mode}`;
  window.open(mapsUrl, '_blank', 'noopener,noreferrer');
}

function openRouteOptionsModal() {
  const modal = document.getElementById('routeOptionsModal');
  if (!modal) return;
  const originRadio = modal.querySelector(`input[name="routeOriginChoice"][value="${state.routeOrigin || 'itinerary'}"]`);
  if (originRadio) originRadio.checked = true;
  const scopeRadio = modal.querySelector(`input[name="routeScopeChoice"][value="${state.routeScope || 'all'}"]`);
  if (scopeRadio) scopeRadio.checked = true;
  const modeRadio = modal.querySelector(`input[name="routeModeChoice"][value="${state.routeMode || 'transit'}"]`);
  if (modeRadio) modeRadio.checked = true;
  modal.classList.add('open');
}

function closeRouteOptionsModal() {
  document.getElementById('routeOptionsModal')?.classList.remove('open');
}

function isMapFullscreenActive() {
  const wrap = document.querySelector('.map-view-wrap');
  return !!(state.isMapFullscreen || document.fullscreenElement || document.webkitFullscreenElement || wrap?.classList.contains('is-fullscreen') || document.body.classList.contains('map-is-fullscreen'));
}

function updateMapFullscreenButtons(isFullscreen) {
  const floatBtn = document.getElementById('mapFloatFullscreenBtn');
  const toolbarBtn = document.getElementById('toggleMapFullscreenBtn');

  if (floatBtn) {
    floatBtn.classList.toggle('is-active', isFullscreen);
    floatBtn.setAttribute('title', isFullscreen ? 'Ieși din ecran complet' : 'Ecran complet (Full Screen)');
  }
  if (toolbarBtn) {
    toolbarBtn.classList.toggle('active', isFullscreen);
    const enterIcon = toolbarBtn.querySelector('.fs-enter-icon');
    const exitIcon = toolbarBtn.querySelector('.fs-exit-icon');
    const label = toolbarBtn.querySelector('.fs-label');
    if (enterIcon) enterIcon.style.display = isFullscreen ? 'none' : 'inline-block';
    if (exitIcon) exitIcon.style.display = isFullscreen ? 'inline-block' : 'none';
    if (label) label.textContent = isFullscreen ? 'Ieșire ecran complet' : 'Ecran complet';
    toolbarBtn.setAttribute('title', isFullscreen ? 'Ieși din ecran complet' : 'Comută modul ecran complet');
  }
}

async function toggleMapFullscreen() {
  const wrap = document.querySelector('.map-view-wrap');
  if (!wrap) return;
  const currentlyFs = isMapFullscreenActive();

  if (currentlyFs) {
    await exitMapFullscreen();
  } else {
    state.isMapFullscreen = true;
    savePrefs({ isMapFullscreen: true });
    updateMapFullscreenUrl(true);
    wrap.classList.add('is-fullscreen');
    document.body.classList.add('map-is-fullscreen');
    updateMapFullscreenButtons(true);

    if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
      try {
        await document.documentElement.requestFullscreen();
      } catch (err) {
        console.warn('requestFullscreen fallback to CSS overlay:', err);
      }
    } else if (document.documentElement.webkitRequestFullscreen && !document.webkitFullscreenElement) {
      try {
        await document.documentElement.webkitRequestFullscreen();
      } catch (err) {
        console.warn('webkitRequestFullscreen fallback:', err);
      }
    }
  }

  setTimeout(() => {
    if (state.map) state.map.invalidateSize({ pan: false });
  }, 100);
  setTimeout(() => {
    if (state.map) state.map.invalidateSize({ pan: false });
  }, 350);
}

async function exitMapFullscreen() {
  state.isMapFullscreen = false;
  savePrefs({ isMapFullscreen: false });
  updateMapFullscreenUrl(false);
  const wrap = document.querySelector('.map-view-wrap');
  if (wrap) wrap.classList.remove('is-fullscreen');
  document.body.classList.remove('map-is-fullscreen');
  updateMapFullscreenButtons(false);

  if (document.fullscreenElement || document.webkitFullscreenElement) {
    try {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        await document.webkitExitFullscreen();
      }
    } catch (err) {
      console.warn('exitFullscreen fallback:', err);
    }
  }

  setTimeout(() => {
    if (state.map) state.map.invalidateSize({ pan: false });
  }, 100);
  setTimeout(() => {
    if (state.map) state.map.invalidateSize({ pan: false });
  }, 350);
}

function setupMapFullscreenElevation() {
  if (!state.isMapFullscreen || state.view !== 'map') return;
  if (document.fullscreenElement || document.webkitFullscreenElement) return;

  const elevate = async (e) => {
    if (e && e.target && (
      e.target.closest('#mapFloatFullscreenBtn') ||
      e.target.closest('#toggleMapFullscreenBtn') ||
      e.target.closest('.map-fullscreen-btn') ||
      e.target.closest('[data-view]')
    )) {
      return;
    }
    window.removeEventListener('click', elevate, true);
    window.removeEventListener('touchstart', elevate, true);
    if (!state.isMapFullscreen || state.view !== 'map') return;
    if (document.fullscreenElement || document.webkitFullscreenElement) return;

    try {
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      } else if (document.documentElement.webkitRequestFullscreen) {
        await document.documentElement.webkitRequestFullscreen();
      }
    } catch (err) {
      // Handled silently by CSS overlay
    }
  };

  window.addEventListener('click', elevate, { capture: true, once: true });
  window.addEventListener('touchstart', elevate, { capture: true, once: true });
}

const LEG_COLORS = [
  '#3b82f6', // 1 -> 2: Vibrant Blue
  '#10b981', // 2 -> 3: Emerald Green
  '#f59e0b', // 3 -> 4: Amber / Warm Gold
  '#8b5cf6', // 4 -> 5: Purple / Violet
  '#ec4899', // 5 -> 6: Rose Pink
  '#06b6d4', // 6 -> 7: Cyan
  '#ef4444', // 7 -> 8: Crimson Red
  '#14b8a6', // 8 -> 9: Teal
  '#a855f7', // 9 -> 10: Bright Purple
  '#f97316', // 10 -> 11: Vibrant Orange
  '#6366f1', // 11 -> 12: Indigo
  '#84cc16', // 12 -> 13: Lime Green
];
const routeGeometryCache = new Map();

async function renderStreetRouteForDay(orderedLocations, groupIndex, mapInstance) {
  if (!orderedLocations || orderedLocations.length < 2 || !mapInstance) return;

  if (state.mapRouteType === 'direct') {
    // Varianta clasică: linii directe întrerupte între puncte
    const straightLatLngs = orderedLocations.map(loc => [Number(loc.coordinates[1]), Number(loc.coordinates[0])]);
    const casing = L.polyline(straightLatLngs, {
      color: '#0f172a',
      weight: 6,
      opacity: 0.35,
      lineCap: 'round',
      lineJoin: 'round',
      interactive: false,
    }).addTo(mapInstance);

    const mainLine = L.polyline(straightLatLngs, {
      color: '#5c73f2',
      weight: 4,
      opacity: 0.85,
      dashArray: '8 7',
      lineCap: 'round',
      lineJoin: 'round',
      interactive: false,
    }).addTo(mapInstance);

    state.mapRouteLayers.push(casing, mainLine);
    return;
  }

  const points = orderedLocations.map(loc => loc.coordinates);
  const cacheKey = points.map(p => `${Number(p[0]).toFixed(5)},${Number(p[1]).toFixed(5)}`).join(';');

  const drawLegPolyline = (coords, color, legIndex, legMeta, isDefinitive) => {
    if (state.map !== mapInstance || !coords || coords.length < 2) return null;

    // Dark casing outline for contrast over any map tiles
    const casing = L.polyline(coords, {
      color: '#0f172a',
      weight: 6.5,
      opacity: 0.45,
      lineCap: 'round',
      lineJoin: 'round',
      interactive: false,
    }).addTo(mapInstance);

    // Main colored route segment
    const mainLine = L.polyline(coords, {
      color: color,
      weight: 4.5,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round',
      dashArray: isDefinitive ? null : '6 8',
      interactive: isDefinitive,
    }).addTo(mapInstance);

    if (isDefinitive) {
      const fromName = orderedLocations[legIndex]?.name || `Punctul ${legIndex + 1}`;
      const toName = orderedLocations[legIndex + 1]?.name || `Punctul ${legIndex + 2}`;
      const distInfo = legMeta?.distance_km ? `${legMeta.distance_km} km` : '';
      const timeInfo = legMeta?.duration_min ? ` · ${legMeta.duration_min} min` : '';
      mainLine.bindTooltip(`<b>${esc(fromName)} → ${esc(toName)}</b>${distInfo || timeInfo ? `<br><span style="color:${color};font-weight:600;">●</span> ${distInfo}${timeInfo}` : ''}`, {
        sticky: true,
        direction: 'top',
        className: 'route-leg-tooltip'
      });
    }

    state.mapRouteLayers.push(casing, mainLine);
    return [casing, mainLine];
  };

  const drawAllLegs = (legsData, isDefinitive) => {
    const createdLayers = [];
    legsData.forEach((leg, legIndex) => {
      const color = LEG_COLORS[legIndex % LEG_COLORS.length];
      const layers = drawLegPolyline(leg.coordinates, color, legIndex, leg, isDefinitive);
      if (layers) createdLayers.push(...layers);
    });
    return createdLayers;
  };

  // 1. If in cache, draw immediate street polylines with distinct leg colors
  if (routeGeometryCache.has(cacheKey)) {
    const cachedData = routeGeometryCache.get(cacheKey);
    if (cachedData.legs && cachedData.legs.length > 0) {
      drawAllLegs(cachedData.legs, true);
      return;
    }
  }

  // 2. Build straight placeholder legs while fetching street geometry
  const straightLegs = [];
  for (let i = 0; i < orderedLocations.length - 1; i++) {
    straightLegs.push({
      coordinates: [
        [Number(orderedLocations[i].coordinates[1]), Number(orderedLocations[i].coordinates[0])],
        [Number(orderedLocations[i + 1].coordinates[1]), Number(orderedLocations[i + 1].coordinates[0])]
      ]
    });
  }
  const placeholderLayers = drawAllLegs(straightLegs, false);

  try {
    const response = await fetch('/api/route-geometry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points, mode: 'driving' })
    });
    if (!response.ok) throw new Error('Route geometry error');
    const data = await response.json();

    const legs = (data.legs && data.legs.length > 0) ? data.legs : straightLegs;
    routeGeometryCache.set(cacheKey, { ...data, legs });

    if (state.map === mapInstance) {
      if (placeholderLayers && placeholderLayers.length) {
        placeholderLayers.forEach(l => {
          try { mapInstance.removeLayer(l); } catch (e) { }
          const idx = state.mapRouteLayers.indexOf(l);
          if (idx > -1) state.mapRouteLayers.splice(idx, 1);
        });
      }
      drawAllLegs(legs, true);
    }
  } catch (err) {
    console.warn('Street route fallback used:', err);
  }
}

function renderMap() {
  const mapElement = document.getElementById('tripMap');
  if (!mapElement || !window.L) return;

  if (state.mapRouteLayers && state.mapRouteLayers.length) {
    state.mapRouteLayers.forEach(l => {
      try { state.map?.removeLayer(l); } catch (e) { }
    });
  }
  state.mapRouteLayers = [];

  if (state.map) {
    try { state.map.remove(); } catch (e) { }
    state.map = null;
  }

  document.getElementById('toggleMapFullscreenBtn')?.addEventListener('click', event => {
    event.preventDefault();
    toggleMapFullscreen();
  });

  document.getElementById('mapFloatFullscreenBtn')?.addEventListener('click', event => {
    event.preventDefault();
    toggleMapFullscreen();
  });

  document.getElementById('toggleMapRouteModeBtn')?.addEventListener('click', event => {
    event.preventDefault();
    state.mapRouteType = state.mapRouteType === 'direct' ? 'streets' : 'direct';
    savePrefs({ mapRouteType: state.mapRouteType });
    renderMain();
    toast(state.mapRouteType === 'direct' ? 'Linii directe clasice activate.' : 'Traseu pe străzi activat (varianta nouă).', 'info');
  }, { once: true });

  const isFs = isMapFullscreenActive();
  if (isFs) {
    state.isMapFullscreen = true;
    savePrefs({ isMapFullscreen: true });
    updateMapFullscreenUrl(true);
    const wrap = document.querySelector('.map-view-wrap');
    if (wrap) wrap.classList.add('is-fullscreen');
    document.body.classList.add('map-is-fullscreen');
    setupMapFullscreenElevation();
  }
  updateMapFullscreenButtons(isFs);

  document.getElementById('mapDaySelect')?.addEventListener('change', event => {
    state.mapDay = event.target.value;
    savePrefs({ mapDay: state.mapDay });
    updateMapDayUrl(state.mapDay);
    state.mapOptimized = false;
    renderMain();
  }, { once: true });

  document.getElementById('optimizeMapBtn')?.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    state.mapOptimized = !state.mapOptimized;
    renderMain();
    const activeLocations = getFilteredLocations().filter(loc => !loc.visited && !loc.excluded && !state.mapExcluded.has(loc.id) && loc.enabled !== false);
    const dayLocations = state.mapDay === 'all' ? activeLocations : activeLocations.filter(loc => loc.visit_date === state.mapDay);
    const mappedCount = dayLocations.filter(loc => hasValidCoordinates(loc.coordinates)).length;
    toast(state.mapOptimized ? `Traseu optimizat pentru ${mappedCount} locații.` : 'Ordine ore restabilită.', 'success');
  }, { once: true });

  document.getElementById('switchToRouteBtn')?.addEventListener('click', () => {
    exitMapFullscreen();
    state.view = 'route';
    savePrefs({ view: 'route' });
    document.querySelectorAll('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === 'route'));
    document.querySelectorAll('.mnav-btn[data-view]').forEach(t => t.classList.toggle('active', t.dataset.view === 'route'));
    renderMain();
  });

  document.getElementById('geocodeMissingBtn')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Găsire…';
    try {
      const response = await fetch('/api/admin/geocode-missing', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Nu s-au putut găsi coordonate');
      const updated = new Map((data.updated || []).map(item => [item.id, item.coordinates]));
      state.trip.locations.forEach(location => {
        if (updated.has(location.id)) location.coordinates = updated.get(location.id);
      });
      renderMain();
      toast(`${data.updated.length} locații actualizate. ${data.remaining} încă fără coordonate.`, 'success');
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Găsește coordonate';
      toast('Geocodare eșuată: ' + error.message, 'error');
    }
  }, { once: true });

  state.map = L.map(mapElement, { scrollWheelZoom: true });
  state.userGpsMarker = null;
  state.mapRouteLine = null;

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
  }).addTo(state.map);

  if (state.currentCoords) {
    updateMapUserGpsMarker(state.currentCoords, state.map);
  }

  const bounds = [];
  const allLocations = getFilteredLocations();
  // Nu luăm în calcul locațiile marcate Done (visited), excluse din traseu sau inactive
  const activeLocations = allLocations.filter(loc => !loc.visited && !loc.excluded && !state.mapExcluded.has(loc.id) && loc.enabled !== false);
  const locations = state.mapDay === 'all' ? activeLocations : activeLocations.filter(loc => loc.visit_date === state.mapDay);
  const routeGroups = {};
  locations.forEach(loc => {
    if (hasValidCoordinates(loc.coordinates)) {
      const dayKey = loc.visit_date || '__none__';
      (routeGroups[dayKey] ||= []).push(loc);
    }
  });
  const routeOrder = new Map();
  Object.values(routeGroups).forEach((dayLocations, groupIndex) => {
    const orderedLocations = optimizeDayRoute(dayLocations);
    orderedLocations.forEach((location, index) => routeOrder.set(location.id, index + 1));
    if (orderedLocations.length > 1) {
      renderStreetRouteForDay(orderedLocations, groupIndex, state.map);
    }
  });
  locations.forEach(loc => {
    const coordinates = loc.coordinates;
    if (!hasValidCoordinates(coordinates)) return;
    const longitude = Number(coordinates[0]);
    const latitude = Number(coordinates[1]);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return;
    const color = getCategoryColor(loc.category);
    const fixedTime = loc.visit_time ? `<b class="map-time-badge">${esc(loc.visit_time)}</b>` : '';
    const routeNumber = state.mapOptimized ? `<b class="map-route-number">${routeOrder.get(loc.id) || ''}</b>` : '';
    const icon = L.divIcon({ className: `trip-map-marker${loc.visit_time ? ' trip-map-marker-fixed' : ''}`, html: `${fixedTime}${routeNumber}<span style="background:${color}"></span>`, iconSize: [18, 18], iconAnchor: [9, 9] });
    const marker = L.marker([latitude, longitude], { icon }).addTo(state.map);
    if (loc.name) marker.bindTooltip(loc.name, { direction: 'top', offset: [0, -10] });
    marker.on('click', () => {
      openLocationModal(loc.id);
    });
    bounds.push([latitude, longitude]);
  });
  if (bounds.length === 1) state.map.setView(bounds[0], 13);
  else if (bounds.length > 1) state.map.fitBounds(bounds, { padding: [28, 28] });
  else state.map.setView([48, 10], 5);
  setTimeout(() => state.map?.invalidateSize(), 0);
}

function initRouteView() {
  if (state.map) {
    try { state.map.remove(); } catch (e) { }
    state.map = null;
  }

  document.getElementById('routeDaySelect')?.addEventListener('change', event => {
    state.routeDay = event.target.value;
    state.routeTimes = null;
    renderMain();
  }, { once: true });

  document.getElementById('routeModeSelect')?.addEventListener('change', event => {
    state.routeMode = event.target.value;
    savePrefs({ routeMode: state.routeMode });
    state.routeTimes = null;
    const panel = document.getElementById('routeTimesPanel');
    if (panel) panel.innerHTML = '';
  }, { once: true });

  document.getElementById('routeOriginSelect')?.addEventListener('change', async event => {
    state.routeOrigin = event.target.value;
    savePrefs({ routeOrigin: state.routeOrigin });
    if (state.routeOrigin === 'current') {
      try {
        await getUserCurrentLocation();
        toast('Locație GPS obținută.', 'info');
      } catch (err) {
        toast(err.message, 'warning');
      }
    }
    state.routeTimes = null;
    const panel = document.getElementById('routeTimesPanel');
    if (panel) panel.innerHTML = '';
  }, { once: true });

  document.getElementById('routeScopeSelect')?.addEventListener('change', event => {
    state.routeScope = event.target.value;
    savePrefs({ routeScope: state.routeScope });
    state.routeTimes = null;
    const panel = document.getElementById('routeTimesPanel');
    if (panel) panel.innerHTML = '';
  }, { once: true });

  document.getElementById('openRouteModalBtn')?.addEventListener('click', () => {
    openRouteOptionsModal();
  });

  document.getElementById('calculateRouteTimesBtn')?.addEventListener('click', async () => {
    await executeRouteCalculation({
      origin: state.routeOrigin || 'itinerary',
      scope: state.routeScope || 'all',
      mode: state.routeMode || 'transit'
    });
  });

  document.getElementById('directNavActionBtn')?.addEventListener('click', async () => {
    await openDirectNavigation();
  });

  document.getElementById('optimizeRouteBtn')?.addEventListener('click', event => {
    event.preventDefault();
    state.routeOptimized = !state.routeOptimized;
    renderMain();
  }, { once: true });

  if (state.routeTimes) {
    renderRouteTimes();
  }
}

function getMapRouteLocations() {
  const allLocations = getFilteredLocations();
  const activeLocations = allLocations.filter(loc => !loc.visited && !loc.excluded && !state.mapExcluded.has(loc.id) && loc.enabled !== false);
  const locations = state.mapDay === 'all' ? activeLocations : activeLocations.filter(loc => loc.visit_date === state.mapDay);
  const groups = {};
  locations.forEach(loc => {
    if (hasValidCoordinates(loc.coordinates)) {
      (groups[loc.visit_date || '__none__'] ||= []).push(loc);
    }
  });
  return Object.keys(groups).sort().flatMap(key => state.mapOptimized
    ? optimizeDayRoute(groups[key])
    : groups[key].sort((a, b) => (a.visit_time || '99:99').localeCompare(b.visit_time || '99:99')));
}

function fmtDuration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function renderRouteTimes() {
  const panel = document.getElementById('routeTimesPanel');
  if (!panel || !state.routeTimes) return;
  const { data, points, origin, mode } = state.routeTimes;
  const totalDistance = data.legs.reduce((sum, leg) => sum + leg.distance_km, 0);
  const totalDurationMin = data.legs.reduce((sum, leg) => sum + leg.duration_min, 0);
  const modeLabel = data.mode === 'driving' ? '🚗 Traseu mașină (OSRM)'
    : data.mode === 'walking' ? '🚶 Traseu pe jos (OSRM)'
      : '🚌 Transport public (Google Maps & estimare)';
  const hasEstimate = data.legs.some(leg => leg.source === 'estimated');
  const isFromGps = points[0] && (points[0].isCurrentLocation || points[0].id === '__user_current__');

  panel.innerHTML = `
    <div class="route-times-header">
      <div class="route-header-main">
        <strong>${totalDistance.toFixed(1)} km · ${fmtDuration(totalDurationMin)} total</strong>
        <span class="route-header-badge ${isFromGps ? 'origin-gps' : 'origin-itinerary'}">
          ${isFromGps ? '📍 Din locația ta curentă (GPS)' : '📌 Din itinerar'}
        </span>
      </div>
      <span class="route-header-mode">${modeLabel}${hasEstimate ? ' ℹ️' : ''}</span>
    </div>
    <div class="route-legs-list">
      ${data.legs.map((leg, idx) => {
    const fromPoint = points[leg.from];
    const toPoint = points[leg.to];
    const destCoords = toPoint.coordinates;
    const fromCoords = fromPoint.coordinates;
    const gmapsMode = (data.mode === 'transit' || data.mode === 'walking' || data.mode === 'driving') ? data.mode : 'transit';
    const legGmapsUrl = leg.transit_url || `https://www.google.com/maps/dir/?api=1&origin=${fromCoords[1]},${fromCoords[0]}&destination=${destCoords[1]},${destCoords[0]}&travelmode=${gmapsMode}`;
    const gpsGmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${destCoords[1]},${destCoords[0]}&travelmode=${gmapsMode}`;

    return `
          <div class="route-leg">
            <div class="route-leg-header">
              <span class="route-leg-number">${idx + 1}</span>
              <span class="route-leg-name">
                ${fromPoint.isCurrentLocation ? '📍 <strong>Locația ta actuală (GPS)</strong>' : esc(fromPoint.name)}
                <span class="route-arrow">→</span>
                <strong>${esc(toPoint.name)}</strong>
              </span>
            </div>
            <div class="route-leg-actions">
              <span class="route-leg-value">
                ${leg.distance_km.toFixed(1)} km · ${fmtDuration(leg.duration_min)}
                ${leg.source === 'estimated' ? '<span class="route-leg-estimate" title="Estimare urbană">~</span>' : ''}
              </span>
              <a class="route-transit-link" href="${esc(legGmapsUrl)}" target="_blank" rel="noopener" title="Deschide traseul în Google Maps">
                🧭 Deschide ruta
              </a>
              ${!fromPoint.isCurrentLocation ? `
                <a class="route-gps-quick-link" href="${esc(gpsGmapsUrl)}" target="_blank" rel="noopener" title="Navighează din GPS acum">
                  📍 Din GPS acum
                </a>
              ` : ''}
            </div>
          </div>`;
  }).join('')}
    </div>
  `;
}

function distanceBetween(first, second) {
  const dx = Number(first.coordinates[0]) - Number(second.coordinates[0]);
  const dy = Number(first.coordinates[1]) - Number(second.coordinates[1]);
  return Math.sqrt((dx * dx) + (dy * dy));
}

function optimizeDayRoute(locations) {
  const fixed = locations.filter(loc => loc.visit_time).sort((a, b) => a.visit_time.localeCompare(b.visit_time));
  const flexible = locations.filter(loc => !loc.visit_time);
  if (!flexible.length) return fixed;
  if (!fixed.length) {
    const route = [flexible.shift()];
    while (flexible.length) {
      const last = route[route.length - 1];
      let nearestIndex = 0;
      let nearestDistance = distanceBetween(last, flexible[0]);
      flexible.forEach((location, index) => {
        const distance = distanceBetween(last, location);
        if (distance < nearestDistance) { nearestIndex = index; nearestDistance = distance; }
      });
      route.push(flexible.splice(nearestIndex, 1)[0]);
    }
    return route;
  }
  const buckets = fixed.map(() => []);
  flexible.forEach(location => {
    let bucketIndex = 0;
    let nearestDistance = Infinity;
    fixed.forEach((stop, index) => {
      const distance = distanceBetween(location, stop);
      if (distance < nearestDistance) { bucketIndex = index; nearestDistance = distance; }
    });
    buckets[bucketIndex].push(location);
  });
  const result = [];
  fixed.forEach((stop, index) => {
    result.push(...nearestNeighbor(buckets[index], stop));
    result.push(stop);
  });
  return result;
}

function nearestNeighbor(locations, start) {
  const remaining = [...locations];
  const result = [];
  let current = start;
  while (remaining.length) {
    let nearestIndex = 0;
    let nearestDistance = distanceBetween(current, remaining[0]);
    remaining.forEach((location, index) => {
      const distance = distanceBetween(current, location);
      if (distance < nearestDistance) { nearestIndex = index; nearestDistance = distance; }
    });
    current = remaining.splice(nearestIndex, 1)[0];
    result.push(current);
  }
  return result;
}

function hasValidCoordinates(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return false;
  const longitude = Number(coordinates[0]);
  const latitude = Number(coordinates[1]);
  return Number.isFinite(longitude) && Number.isFinite(latitude)
    && longitude >= -180 && longitude <= 180
    && latitude >= -90 && latitude <= 90
    && !(longitude === 0 && latitude === 0);
}

function timeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const parts = timeStr.split(':');
  if (parts.length < 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

function minutesToTime(totalMinutes) {
  if (totalMinutes == null || isNaN(totalMinutes)) return '';
  const normalized = ((Math.floor(totalMinutes) % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function addMinutesToTime(timeStr, mins) {
  const startMins = timeToMinutes(timeStr);
  if (startMins == null) return '';
  return minutesToTime(startMins + (Number(mins) || 0));
}

function formatDuration(minutes) {
  const mins = Number(minutes);
  if (!mins || isNaN(mins) || mins <= 0) return '1h';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function getScheduleTimes(loc) {
  if (!loc || !loc.visit_time) return null;
  const duration = Number(loc.duration_minutes) > 0 ? Number(loc.duration_minutes) : 60;
  const startMinutes = timeToMinutes(loc.visit_time);
  if (startMinutes == null) return null;
  const endMinutes = startMinutes + duration;
  return {
    start: loc.visit_time,
    end: minutesToTime(endMinutes),
    duration,
    startMinutes,
    endMinutes,
  };
}

function detectScheduleConflicts(locations) {
  const conflicts = new Map();
  const scheduled = locations
    .filter(l => l.enabled !== false && l.visit_time)
    .map(l => ({ loc: l, times: getScheduleTimes(l) }))
    .filter(item => item.times != null)
    .sort((a, b) => a.times.startMinutes - b.times.startMinutes);

  for (let i = 0; i < scheduled.length - 1; i++) {
    const current = scheduled[i];
    const next = scheduled[i + 1];
    if (next.times.startMinutes < current.times.endMinutes) {
      const overlap = current.times.endMinutes - next.times.startMinutes;
      const curConflict = conflicts.get(current.loc.id) || { conflictingWith: [], overlapMinutes: 0 };
      curConflict.conflictingWith.push(next.loc);
      curConflict.overlapMinutes = Math.max(curConflict.overlapMinutes, overlap);
      conflicts.set(current.loc.id, curConflict);

      const nextConflict = conflicts.get(next.loc.id) || { conflictingWith: [], overlapMinutes: 0 };
      nextConflict.conflictingWith.push(current.loc);
      nextConflict.overlapMinutes = Math.max(nextConflict.overlapMinutes, overlap);
      conflicts.set(next.loc.id, nextConflict);
    }
  }
  return conflicts;
}

function getCategoryColor(category) {
  const colors = { hotel: '#5c73f2', transport: '#a855f7', restaurant: '#f97316', attraction: '#10b981', education: '#06b6d4', shopping: '#ec4899', services: '#84cc16', club: '#f59e0b', other: '#64748b' };
  return colors[category] || colors.other;
}

function renderListView() {
  const locs = getFilteredLocations();
  if (!locs.length) return emptyStateHTML('No locations found', 'Try adjusting your filters or upload a new JSON file.');
  return `<div class="locations-grid">${locs.map(cardHTML).join('')}</div>`;
}

function getAllTripDays() {
  return [...new Set((state.trip?.locations || []).map(l => l.visit_date).filter(Boolean))].sort();
}

function renderDayView() {
  const locs = getFilteredLocations();
  const groups = {};
  for (const loc of locs) {
    const key = loc.visit_date || '__none__';
    (groups[key] = groups[key] || []).push(loc);
  }
  const keys = Object.keys(groups).filter(k => k !== '__none__').sort();
  if (groups['__none__']) keys.unshift('__none__');
  if (!keys.length) return emptyStateHTML('No locations found', 'Try adjusting your filters.');

  const allTripDays = getAllTripDays();

  return keys.map(key => {
    const dayLocs = [...groups[key]].sort((a, b) => (a.visit_time || '').localeCompare(b.visit_time || ''));
    const unscheduled = key === '__none__';
    const dayIdx = unscheduled ? -1 : allTripDays.indexOf(key);
    const dayNum = dayIdx >= 0 ? (dayIdx + 1) : 1;
    const labelFull = unscheduled ? 'Unscheduled' : fmtDate(key, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const labelAbbr = unscheduled ? 'Unscheduled' : fmtDate(key, { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' });
    const labelCompact = unscheduled ? 'Unscheduled' : fmtDate(key, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
    const allDayLocs = (state.trip?.locations || []).filter(l => (l.visit_date || '__none__') === key);
    const dayCost = allDayLocs.filter(l => l.enabled !== false).reduce((s, l) => s + (l.cost || 0), 0);
    return `
      <div class="day-group">
        <div class="day-header">
          <span class="day-badge" style="${unscheduled ? 'background:var(--text-muted)' : ''}">${unscheduled ? '—' : 'Day ' + dayNum}</span>
          <span class="day-date" title="${esc(labelFull)}">
            <span class="day-date-full">${esc(labelFull)}</span>
            <span class="day-date-abbr">${esc(labelAbbr)}</span>
            <span class="day-date-compact">${esc(labelCompact)}</span>
          </span>
          <span class="day-count">${dayLocs.length} place${dayLocs.length !== 1 ? 's' : ''}</span>
          ${dayCost > 0 ? `<span class="day-total-cost">${formatCurrency(dayCost, state.trip?.currency)}</span>` : ''}
        </div>
        <div class="locations-grid">${dayLocs.map(cardHTML).join('')}</div>
      </div>`;
  }).join('');
}

function renderCountryView() {
  const locs = getFilteredLocations();
  const groups = {};
  for (const loc of locs) {
    const c = loc.country || 'Unknown';
    const cy = loc.city || 'Unknown';
    if (!groups[c]) groups[c] = {};
    (groups[c][cy] = groups[c][cy] || []).push(loc);
  }
  if (!Object.keys(groups).length) return emptyStateHTML('No locations found', 'Try adjusting your filters.');

  return Object.keys(groups).sort().map(country => {
    const cities = groups[country];
    const allLocs = Object.values(cities).flat();
    const enabledCount = allLocs.filter(l => l.enabled).length;
    const totalCost = allLocs.filter(l => l.enabled).reduce((s, l) => s + (l.cost || 0), 0);
    const cityHTML = Object.keys(cities).sort().map(city => `
      <div class="city-group">
        <div class="city-label">${esc(city)} <span style="color:var(--text-muted);font-weight:400">(${cities[city].length})</span></div>
        <div class="locations-grid">${cities[city].map(cardHTML).join('')}</div>
      </div>`).join('');
    return `
      <div class="country-group" data-country="${esc(country)}">
        <div class="country-header">
          <span class="country-flag">${flagHTML(country)}</span>
          <span class="country-name">${esc(country)}</span>
          <span class="country-stats">${enabledCount}/${allLocs.length} locations${totalCost > 0 ? ' · ' + formatCurrency(totalCost, state.trip?.currency) : ''}</span>
        </div>
        ${cityHTML}
      </div>`;
  }).join('');
}

function navigateToCountry(country) {
  if (!country) return;
  // If current filter excludes this country, reset country filter to 'all' so target is visible
  if (state.filter.country && state.filter.country !== 'all' && state.filter.country !== country) {
    state.filter.country = 'all';
    const cf = document.getElementById('countryFilter');
    if (cf) cf.value = 'all';
    const cfm = document.getElementById('countryFilterMobile');
    if (cfm) cfm.value = 'all';
    updateFilterActiveDot();
  }

  // Switch to Countries mode
  if (state.view !== 'country') {
    exitMapFullscreen();
    state.view = 'country';
    savePrefs({ view: 'country' });
    document.querySelectorAll('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === 'country'));
    document.querySelectorAll('.mnav-btn[data-view]').forEach(t => t.classList.toggle('active', t.dataset.view === 'country'));
    renderMain();
    updateControlsBarHeight();
    updateDaysToggleLabel();
  }

  // Automatically navigate/scroll to the corresponding country
  setTimeout(() => {
    const el = document.querySelector(`.country-group[data-country="${CSS.escape(country)}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, 60);
}

function isValidHttpUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function detectPlatform() {
  const ua = (navigator.userAgent || '').toLowerCase();
  if (/android/.test(ua)) return 'android';
  if (/iphone|ipad|ipod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  return 'desktop';
}

function cleanUrlString(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let str = raw.trim();
  // Parse markdown link syntax [text](url) or [url](url)
  const mdMatch = str.match(/\[.*?\]\((https?:\/\/[^\s)]+)\)/i);
  if (mdMatch) {
    str = mdMatch[1];
  }
  // Strip angle brackets <url>
  str = str.replace(/^<|>$/g, '').trim();
  return str;
}

function isValidAndroidPackage(pkg) {
  return typeof pkg === 'string' && /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(pkg);
}

function extractPackageIdFromUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const str = cleanUrlString(rawUrl);
  if (!str) return null;

  try {
    if (/^market:\/\/details\?id=([a-zA-Z0-9._]+)/i.test(str)) {
      const match = str.match(/^market:\/\/details\?id=([a-zA-Z0-9._]+)/i);
      if (match && isValidAndroidPackage(match[1])) return match[1];
    }
    const parsed = new URL(str);
    // 1. Google Play Store URL: https://play.google.com/store/apps/details?id=...
    if (/play\.google\.com$/i.test(parsed.hostname) || /market\.android\.com$/i.test(parsed.hostname)) {
      const id = parsed.searchParams.get('id');
      if (id && isValidAndroidPackage(id)) return id;
    }
    // 2. Query param ?package= or ?package_id= or ?app_id=
    const pkgParam = parsed.searchParams.get('package') || parsed.searchParams.get('package_id') || parsed.searchParams.get('app_id');
    if (pkgParam && isValidAndroidPackage(pkgParam)) return pkgParam;

    // 3. Amazon Appstore: amazon.com/gp/mas/dl/android?p=...
    if (/amazon\.[a-z.]+/i.test(parsed.hostname) && parsed.searchParams.get('p')) {
      const p = parsed.searchParams.get('p');
      if (p && isValidAndroidPackage(p)) return p;
    }
  } catch (_) {
    const match = str.match(/[?&]id=([a-zA-Z0-9._]+)/i);
    if (match && isValidAndroidPackage(match[1])) return match[1];
  }

  return null;
}

function launchConfirmationUrl(rawUrl, explicitPackageId = null) {
  const url = cleanUrlString(rawUrl);
  if (!url) {
    if (typeof toast === 'function') {
      toast('Introduceți un link mai întâi.', 'warning');
    }
    const input = document.querySelector('.doc-link-field-group [data-field="confirmation_url"]') || document.getElementById('docUrlInput');
    input?.focus();
    return;
  }

  let finalUrl = url;
  if (!/^[a-zA-Z0-9._-]+:\/\//i.test(finalUrl)) {
    finalUrl = 'https://' + finalUrl;
  }

  const packageId = explicitPackageId || extractPackageIdFromUrl(finalUrl);
  const platform = detectPlatform();

  if (platform === 'android' && packageId) {
    // Attempt native app open via Android Intent URL before falling back to the web browser
    const encodedFallback = encodeURIComponent(finalUrl);
    const intentUrl = `intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=${packageId};S.browser_fallback_url=${encodedFallback};end`;
    try {
      window.location.href = intentUrl;
    } catch (_) {
      const a = document.createElement('a');
      a.href = finalUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    return;
  }

  // Normal link or on desktop/iOS: ALWAYS open in a new browser window/tab!
  try {
    const win = window.open(finalUrl, '_blank', 'noopener,noreferrer');
    if (win && !win.closed && typeof win.closed !== 'undefined') {
      return;
    }
  } catch (_) { }

  const a = document.createElement('a');
  a.href = finalUrl;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function handleAppDeepLink(event, packageId, customScheme, webUrl) {
  if (event && typeof event.preventDefault === 'function') {
    event.preventDefault();
  }
  if (event && typeof event.stopPropagation === 'function') {
    event.stopPropagation();
  }

  if (!webUrl) return;
  launchConfirmationUrl(webUrl, packageId);
}

if (typeof window !== 'undefined') {
  window.cleanUrlString = cleanUrlString;
  window.extractPackageIdFromUrl = extractPackageIdFromUrl;
  window.launchConfirmationUrl = launchConfirmationUrl;
  window.handleAppDeepLink = handleAppDeepLink;
}

function renderConfirmationLinkHTML(rawUrl, rawLabel, options = {}) {
  const url = cleanUrlString(rawUrl);
  if (!url || !isValidHttpUrl(url)) return '';

  const label = (rawLabel || '').trim();
  const displayTitle = esc(label || 'Document link');
  const safeUrl = esc(url);
  const packageId = extractPackageIdFromUrl(url);

  const extraClasses = options.extraClasses ? ` ${options.extraClasses}` : '';
  const pkgAttr = packageId ? ` data-package-id="${esc(packageId)}"` : '';

  return `<a class="strip-chip strip-confirmation confirmation-link${extraClasses}" href="${safeUrl}" target="_blank" rel="noopener noreferrer" data-action="openConfirmationDoc" data-canonical-url="${safeUrl}"${pkgAttr} title="${displayTitle}" aria-label="${displayTitle}"><span class="chip-icon">📑</span>${label ? `<span class="chip-label">${esc(label)}</span>` : ''}</a>`;
}

function renderAttachmentChipHTML(loc) {
  if (!loc) return '';
  const attCount = loc.attachments?.length || 0;
  const isAdmin = state.role === 'admin';

  if (attCount > 0) {
    const label = `${attCount} ${attCount === 1 ? 'Attachment' : 'Attachments'}`;
    return `<button class="strip-chip strip-attachments attachment-count-btn" data-action="viewAttachments" data-id="${esc(loc.id)}" type="button" title="View attachments"><span class="chip-icon">📎</span><span class="chip-label">${label}</span></button>`;
  }

  if (isAdmin) {
    return `<button class="strip-chip strip-attachments attachment-count-btn is-empty" data-action="addAttachment" data-id="${esc(loc.id)}" type="button" title="Add attachment"><span class="chip-icon">📎</span><span class="chip-label">+ Attachment</span></button>`;
  }

  return '';
}

function renderTimelineView() {
  const locs = getFilteredLocations();
  const allTripDays = getAllTripDays();
  const days = [...new Set(locs.map(loc => loc.visit_date).filter(Boolean))].sort();
  const unscheduledLocs = locs.filter(loc => !loc.visit_date);
  if (!days.length && !unscheduledLocs.length) {
    return emptyStateHTML('No timeline data', 'Add visit dates and times to your locations to view the visual schedule timeline.');
  }

  const activeDay = state.timelineDay || 'all';

  // Day navigation tabs in timeline
  const dayTabs = `
    <div class="timeline-nav-bar">
      <div class="timeline-nav-scroll">
        <button class="timeline-nav-tab${activeDay === 'all' ? ' active' : ''}" data-timeline-day="all" type="button">
          <span class="tnav-title">All Days</span>
          <span class="tnav-count">${locs.filter(l => l.visit_date).length} places</span>
        </button>
        ${days.map(day => {
    const dayIdx = allTripDays.indexOf(day);
    const dayNum = dayIdx >= 0 ? (dayIdx + 1) : 1;
    const count = locs.filter(l => l.visit_date === day).length;
    const dayConflicts = detectScheduleConflicts(locs.filter(l => l.visit_date === day));
    const hasConflict = dayConflicts.size > 0;
    return `<button class="timeline-nav-tab${activeDay === day ? ' active' : ''}" data-timeline-day="${esc(day)}" type="button">
            <span class="tnav-badge">Day ${dayNum}</span>
            <span class="tnav-title">${esc(fmtDate(day, { day: 'numeric', month: 'short' }))}</span>
            <span class="tnav-count">${count} stop${count !== 1 ? 's' : ''}${hasConflict ? ' · <span class="tnav-warn">⚠️</span>' : ''}</span>
          </button>`;
  }).join('')}
        ${unscheduledLocs.length ? `
          <button class="timeline-nav-tab${activeDay === '__unscheduled__' ? ' active' : ''}" data-timeline-day="__unscheduled__" type="button">
            <span class="tnav-badge" style="background:var(--text-muted)">—</span>
            <span class="tnav-title">Unscheduled</span>
            <span class="tnav-count">${unscheduledLocs.length} places</span>
          </button>` : ''}
      </div>
    </div>`;

  const daysToRender = activeDay === 'all'
    ? days
    : activeDay === '__unscheduled__'
      ? []
      : days.filter(d => d === activeDay);

  const daysContent = daysToRender.map(day => {
    const dayLocs = locs.filter(l => l.visit_date === day);
    const dayIdx = allTripDays.indexOf(day);
    const dayNum = dayIdx >= 0 ? (dayIdx + 1) : 1;
    const conflicts = detectScheduleConflicts(dayLocs);

    const scheduled = dayLocs
      .filter(l => l.visit_time)
      .map(l => ({ loc: l, times: getScheduleTimes(l) }))
      .filter(item => item.times != null)
      .sort((a, b) => a.times.startMinutes - b.times.startMinutes);

    const flexible = dayLocs.filter(l => !l.visit_time);

    // Day stats
    const totalDurationMins = scheduled.reduce((sum, item) => sum + item.times.duration, 0);
    const earliestStart = scheduled[0] ? scheduled[0].times.start : null;
    const latestEnd = scheduled[scheduled.length - 1] ? scheduled[scheduled.length - 1].times.end : null;
    const allDayLocs = (state.trip?.locations || []).filter(l => l.visit_date === day);
    const dayCost = allDayLocs.filter(l => l.enabled !== false).reduce((sum, l) => sum + (l.cost || 0), 0);

    const itemsHTML = scheduled.map((item, idx) => {
      const loc = item.loc;
      const times = item.times;
      const safecat = VALID_CATEGORIES.includes(loc.category) ? loc.category : 'other';
      const color = getCategoryColor(safecat);
      const conflict = conflicts.get(loc.id);
      const isVisited = !!loc.visited;
      const isExcluded = state.mapExcluded.has(loc.id);
      const excludeBtn = `<button type="button" class="loc-nav-btn exclude-route-btn${isExcluded ? ' is-excluded' : ''}" data-action="toggleRouteExclude" title="${isExcluded ? 'Include în traseu' : 'Exclude din traseu'}"><svg viewBox="0 0 24 24">${isExcluded ? '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>' : '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8 0-1.85.63-3.55 1.69-4.9L16.9 18.31C15.55 19.37 13.85 20 12 20zm6.31-3.1L7.1 5.69C8.45 4.63 10.15 4 12 4c4.42 0 8 3.58 8 8 0 1.85-.63 3.55-1.69 4.9z"/>'}</svg></button>`;
      const navGpsBtn = `<button type="button" class="loc-nav-btn gps-nav-btn" data-action="navigateFromCurrent" data-loc-id="${esc(loc.id)}" title="Go To (navighează de la locația curentă)"><svg viewBox="0 0 24 24"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg> <span class="nav-btn-text">Go To</span></button>`;
      const sym = getCurrencySymbol(state.trip?.currency);

      // Gap to next item
      let gapHTML = '';
      if (idx < scheduled.length - 1) {
        const nextItem = scheduled[idx + 1];
        const gapMins = nextItem.times.startMinutes - times.endMinutes;
        if (gapMins > 0) {
          gapHTML = `
            <div class="timeline-gap">
              <div class="timeline-gap-line"></div>
              <span class="timeline-gap-pill">
                <svg viewBox="0 0 24 24" width="12" height="12"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 14.59L8.71 12.3a1 1 0 1 1 1.41-1.41L13 13.76l4.88-4.88a1 1 0 0 1 1.41 1.41z"/></svg>
                <span>${formatDuration(gapMins)} free time / transit</span>
              </span>
            </div>`;
        } else if (gapMins < 0) {
          gapHTML = `
            <div class="timeline-gap is-conflict">
              <div class="timeline-gap-line"></div>
              <span class="timeline-gap-pill is-conflict">
                <span>⚠️ Overlap: ${Math.abs(gapMins)} min collision with next place</span>
              </span>
            </div>`;
        }
      }

      return `
        <div class="timeline-item${isVisited ? ' is-visited' : ''}${conflict ? ' has-conflict' : ''}${isExcluded ? ' is-excluded' : ''}" data-id="${esc(loc.id)}">
          <div class="timeline-time-col">
            <div class="timeline-start-time">${esc(times.start)}</div>
            <div class="timeline-end-time">${esc(times.end)}</div>
            <span class="timeline-duration-badge">${formatDuration(times.duration)}</span>
          </div>
          <div class="timeline-node-col">
            <div class="timeline-node-dot" style="--node-color:${color}"></div>
            <div class="timeline-node-line"></div>
          </div>
          <div class="timeline-card${safecat === 'transport' ? ' is-transport-card' : ''}" style="--cat-color:${color}">
            <div class="timeline-card-header${safecat === 'transport' ? ' transport-window-bar' : ''}">
              <div class="timeline-card-title-wrap">
                <div class="timeline-card-title">${CATEGORY_ICONS[safecat]} ${esc(loc.name)}</div>
                ${loc.address ? `<div class="timeline-card-address">${esc(loc.address)}</div>` : ''}
              </div>
              <div class="meta-strip-place" title="${esc(loc.city ? `${loc.city}, ${loc.country}` : (loc.country || ''))}">
                <span class="meta-flag-wrap">${flagHTML(loc.country, loc.country_code)}</span>
                <span class="meta-place-label">${esc((loc.city && loc.city !== 'Unknown') ? loc.city : (loc.country || ''))}</span>
              </div>
            </div>
            ${loc.place_info ? `<div class="place-info-text">${esc(loc.place_info)}</div>` : ''}
            ${conflict ? `<div class="timeline-conflict-alert">⚠️ Schedule conflict: Overlaps by ${conflict.overlapMinutes} min with ${conflict.conflictingWith.map(c => esc(c.name)).join(', ')}</div>` : ''}
            <div class="timeline-card-footer">
              <div class="timeline-chips">
                ${safecat === 'transport' ? '' : `<span class="strip-chip strip-cat cat-${safecat}">${CATEGORY_ICONS[safecat]} ${safecat.charAt(0).toUpperCase() + safecat.slice(1)}</span>`}
                ${loc.cost > 0 ? `<span class="strip-chip strip-cost">${sym}${loc.cost}</span>` : ''}
                ${loc.reservation_status ? `<span class="strip-chip strip-booking">${loc.reservation_status === 'confirmed' ? '✓ Confirmed' : 'Reserved'}</span>` : ''}
                ${renderAttachmentChipHTML(loc)}
                ${renderConfirmationLinkHTML(loc.confirmation_url, loc.confirmation_label)}
                ${loc.notes ? `<span class="strip-chip strip-notes" title="${esc(loc.notes)}">${esc(loc.notes)}</span>` : ''}
              </div>
              <div class="timeline-actions">
                <button type="button" class="card-icon-btn${isVisited ? ' done-active' : ''}" data-action="markVisited" title="${isVisited ? 'Marchează ca nefăcut' : 'Marchează ca făcut'}">
                  <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                </button>
                ${excludeBtn}
                ${navGpsBtn}
                <button type="button" class="loc-nav-btn timeline-open-btn" data-open-card-modal="${esc(loc.id)}">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
                  <span>Details</span>
                </button>
                ${safeMapsUrl(loc.google_maps_url) ? `<a href="${safeMapsUrl(loc.google_maps_url)}" target="_blank" rel="noopener noreferrer" class="loc-nav-btn" title="Maps"><svg viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg></a>` : ''}
              </div>
            </div>
          </div>
        </div>
        ${gapHTML}`;
    }).join('');

    const flexibleHTML = flexible.length ? `
      <div class="timeline-flexible-section">
        <div class="timeline-flexible-header">
          <span>📌 Flexible places for Day ${dayNum} (${flexible.length} without fixed time)</span>
        </div>
        <div class="timeline-flexible-grid">
          ${flexible.map(loc => {
      const safecat = VALID_CATEGORIES.includes(loc.category) ? loc.category : 'other';
      return `
              <div class="timeline-flexible-card" data-id="${esc(loc.id)}">
                <div class="tflex-header">
                  <strong>${CATEGORY_ICONS[safecat]} ${esc(loc.name)}</strong>
                  <span class="tag tag-city">${esc(loc.city || loc.country || '')}</span>
                </div>
                ${loc.notes ? `<div class="tflex-notes">${esc(loc.notes)}</div>` : ''}
                <div class="tflex-actions">
                  <button type="button" class="btn-secondary tflex-btn" data-open-card-modal="${esc(loc.id)}">Set Time / View</button>
                </div>
              </div>`;
    }).join('')}
        </div>
      </div>` : '';

    const timeDateFull = fmtDate(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const timeDateAbbr = fmtDate(day, { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
    const timeDateCompact = fmtDate(day, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

    return `
      <div class="timeline-day-block">
        <div class="timeline-day-header">
          <div class="timeline-day-title-wrap">
            <span class="timeline-day-badge">Day ${dayNum}</span>
            <h2 class="timeline-day-date" title="${esc(timeDateFull)}">
              <span class="day-date-full">${esc(timeDateFull)}</span>
              <span class="day-date-abbr">${esc(timeDateAbbr)}</span>
              <span class="day-date-compact">${esc(timeDateCompact)}</span>
            </h2>
          </div>
          <div class="timeline-day-meta">
            ${earliestStart ? `<span class="tmeta-chip">🌅 ${earliestStart} – ${latestEnd}</span>` : ''}
            ${totalDurationMins > 0 ? `<span class="tmeta-chip">⏱️ ${formatDuration(totalDurationMins)} active</span>` : ''}
            <span class="tmeta-chip">📍 ${dayLocs.length} stop${dayLocs.length !== 1 ? 's' : ''}</span>
            ${dayCost > 0 ? `<span class="tmeta-chip">💰 ${formatCurrency(dayCost, state.trip?.currency)}</span>` : ''}
            ${conflicts.size > 0 ? `<span class="tmeta-chip is-warn">⚠️ ${conflicts.size} conflict${conflicts.size !== 1 ? 's' : ''}</span>` : ''}
          </div>
        </div>
        <div class="timeline-stream">
          ${scheduled.length ? itemsHTML : '<div class="timeline-no-scheduled">No fixed time activities set for this day yet.</div>'}
        </div>
        ${flexibleHTML}
      </div>`;
  }).join('');

  const unscheduledContent = (activeDay === 'all' || activeDay === '__unscheduled__') && unscheduledLocs.length ? `
    <div class="timeline-day-block">
      <div class="timeline-day-header">
        <div class="timeline-day-title-wrap">
          <span class="timeline-day-badge" style="background:var(--text-muted)">—</span>
          <h2 class="timeline-day-date">Unscheduled Locations</h2>
        </div>
        <div class="timeline-day-meta">
          <span class="tmeta-chip">📍 ${unscheduledLocs.length} place${unscheduledLocs.length !== 1 ? 's' : ''}</span>
        </div>
      </div>
      <div class="timeline-flexible-grid">
        ${unscheduledLocs.map(loc => {
    const safecat = VALID_CATEGORIES.includes(loc.category) ? loc.category : 'other';
    return `
            <div class="timeline-flexible-card" data-id="${esc(loc.id)}">
              <div class="tflex-header">
                <strong>${CATEGORY_ICONS[safecat]} ${esc(loc.name)}</strong>
                <span class="tag tag-city">${esc(loc.city || loc.country || '')}</span>
              </div>
              <div class="tflex-actions">
                <button type="button" class="btn-secondary tflex-btn" data-open-card-modal="${esc(loc.id)}">Set Date &amp; Time</button>
              </div>
            </div>`;
  }).join('')}
      </div>
    </div>` : '';

  return `<div class="timeline-container">${dayTabs}${daysContent}${unscheduledContent}</div>`;
}

function bookingStatusBadgeHTML(status) {
  if (!status) return '';
  if (status === 'confirmed') {
    return `<span class="titlebar-status-badge is-confirmed" title="Rezervare confirmată (Confirmed)" aria-label="Confirmed"><svg viewBox="0 0 24 24"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM10.5 15.5l-2.5-2.5 1.41-1.41 1.09 1.09 4.09-4.09 1.41 1.41-5.5 5.5z"/></svg></span>`;
  }
  if (status === 'reserved') {
    return `<span class="titlebar-status-badge is-reserved" title="Rezervat / În așteptare (Reserved)" aria-label="Reserved"><svg viewBox="0 0 24 24"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zm-7-9c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3zm0 4.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg></span>`;
  }
  return '';
}

function paidStatusBadgeHTML(paid) {
  if (!paid) return '';
  return `<span class="titlebar-status-badge is-paid" title="Plătit (Paid)" aria-label="Paid"><svg viewBox="0 0 24 24"><path d="M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2zm-6 8.5l-2-2 1.41-1.41L14 15.67l3.59-3.59L19 13.5l-5 5z"/></svg></span>`;
}

function titlebarMetaHTML(loc, sym) {
  const bookingBadge = bookingStatusBadgeHTML(loc.reservation_status);
  const paidBadge = paidStatusBadgeHTML(loc.paid);
  const hasValidCost = loc.cost != null && loc.cost !== '' && !isNaN(Number(loc.cost)) && Number(loc.cost) > 0;
  const costVal = hasValidCost ? loc.cost : 0;
  const costChip = `<span class="strip-cost card-title-cost">${sym}${costVal}</span>`;
  if (!bookingBadge && !paidBadge && !costChip) return '';
  return `<div class="card-titlebar-meta">${bookingBadge}${paidBadge}${costChip}</div>`;
}

function checkTimeConflict(loc, allLocs) {
  if (!loc || !loc.visit_date) return null;
  const locList = allLocs || state.trip?.locations || [];
  const dayLocs = locList.filter(l => l.visit_date === loc.visit_date && l.enabled !== false);
  const dayConflicts = detectScheduleConflicts(dayLocs);
  return dayConflicts.get(loc.id) || null;
}

function renderCardSubcardHTML(loc) {
  const notes = (loc.notes || '').trim();
  const confirmationLink = renderConfirmationLinkHTML(loc.confirmation_url, loc.confirmation_label);
  const attachmentChip = renderAttachmentChipHTML(loc);
  const conflict = checkTimeConflict(loc, state.trip?.locations || []);
  let conflictChip = '';
  if (conflict) {
    const withNames = [...new Set((conflict.conflictingWith || []).map(c => (c.name || '').trim()).filter(Boolean))];
    const withStr = withNames.join(', ');
    const chipText = withStr
      ? `⚠️ Conflict (${conflict.overlapMinutes}m cu ${withStr})`
      : `⚠️ Conflict (${conflict.overlapMinutes}m)`;
    const titleText = withStr
      ? `Schedule conflict: overlaps by ${conflict.overlapMinutes} min with ${withStr}`
      : `Schedule conflict (${conflict.overlapMinutes} min overlap)`;
    conflictChip = `<span class="strip-chip strip-conflict" title="${esc(titleText)}">${esc(chipText)}</span>`;
  }

  const notesBlock = notes ? `<div class="card-notes-row" title="${esc(notes)}"><span class="notes-row-icon">📝</span><span class="notes-row-text">${esc(notes)}</span></div>` : '';
  const hasChips = !!(confirmationLink || attachmentChip || conflictChip);
  const chipsBlock = hasChips ? `<div class="card-info-strip">${confirmationLink}${attachmentChip}${conflictChip}</div>` : '';

  if (!notesBlock && !chipsBlock) return '';

  return `
    <div class="card-subcard">
      ${notesBlock}
      ${chipsBlock}
    </div>`;
}

function updateCardSubcard(card, loc) {
  if (!card) return;
  const existingSubcard = card.querySelector('.card-subcard');
  const newSubcardHTML = renderCardSubcardHTML(loc);
  if (!newSubcardHTML) {
    existingSubcard?.remove();
    return;
  }
  if (existingSubcard) {
    const temp = document.createElement('div');
    temp.innerHTML = newSubcardHTML;
    const newEl = temp.firstElementChild;
    existingSubcard.replaceWith(newEl);
  } else {
    const actions = card.querySelector('.card-actions');
    if (actions) {
      const temp = document.createElement('div');
      temp.innerHTML = newSubcardHTML;
      const newEl = temp.firstElementChild;
      actions.parentNode.insertBefore(newEl, actions);
    }
  }
}

function cardHTML(loc) {
  const safecat = VALID_CATEGORIES.includes(loc.category) ? loc.category : 'other';
  const icon = CATEGORY_ICONS[safecat];
  const enabled = loc.enabled !== false;
  const isAdmin = state.role === 'admin';
  const schedTimes = getScheduleTimes(loc);
  const schedDateStr = loc.visit_date ? fmtDate(loc.visit_date, { day: 'numeric', month: 'short' }) : '';
  const schedTimeRange = schedTimes ? `${schedTimes.start} – ${schedTimes.end}` : (loc.visit_time || '');
  const durationChip = schedTimes ? `<span class="meta-sched-dur strip-chip strip-time" title="Duration: ${formatDuration(schedTimes.duration)}">⏱️ ${formatDuration(schedTimes.duration)}</span>` : '';
  const placeName = (loc.city && loc.city !== 'Unknown') ? loc.city : (loc.country || '');

  const titleMarkup = isAdmin
    ? `<span class="card-name-text">${esc(loc.name)}</span><input type="text" class="card-name-field" data-field="name" value="${esc(loc.name)}" placeholder="Location name">`
    : `<span class="card-name-text">${esc(loc.name)}</span>`;

  const catOptions = VALID_CATEGORIES.map(c =>
    `<option value="${c}"${c === safecat ? ' selected' : ''}>${CATEGORY_ICONS[c]} ${c.charAt(0).toUpperCase() + c.slice(1)}</option>`
  ).join('');

  const mapsHref = safeMapsUrl(loc.google_maps_url);
  const wazeHref = wazeUrl(loc);

  const sym = getCurrencySymbol(state.trip?.currency);

  const addressLine = loc.address ? `<div class="card-address-row is-open" title="${esc(loc.address)}"><span class="address-row-icon">📍</span><span class="card-address">${esc(loc.address)}</span></div>` : '';

  // Nav buttons in card-actions (dynamic responsive text/icon)
  const mapsBtn = mapsHref ? `<a href="${mapsHref}" target="_blank" rel="noopener noreferrer" class="loc-nav-btn maps-btn" title="Open in Maps"><svg viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg><span class="nav-btn-text">Maps</span></a>` : '';
  const wazeBtn = wazeHref ? `<a href="${wazeHref}" target="_blank" rel="noopener noreferrer" class="loc-nav-btn waze-btn waze" title="Waze"><svg viewBox="0 0 24 24"><path d="M12 2a9 9 0 0 1 9 9c0 3.5-2 6.6-4.9 8.2L15 21l-3 1-3-1-.1-1.8C6 18.6 4 15.5 4 12a9 9 0 0 1 8-8.94V2zm0 2a7 7 0 1 0 0 14A7 7 0 0 0 12 4zm-1 3h2v5.5l3.2 1.9-1 1.7L11 14V7z"/></svg><span class="nav-btn-text">Waze</span></a>` : '';
  const navGpsBtn = `<button type="button" class="loc-nav-btn gps-nav-btn" data-action="navigateFromCurrent" data-loc-id="${esc(loc.id)}" title="Go To (navighează de la locația curentă)"><svg viewBox="0 0 24 24"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg><span class="nav-btn-text">Go To</span></button>`;
  const isExcluded = !!(loc.excluded || state.mapExcluded.has(loc.id));
  const excludeBtn = `<button type="button" class="loc-nav-btn exclude-route-btn${isExcluded ? ' is-excluded' : ''}" data-action="toggleRouteExclude" title="${isExcluded ? 'Include în traseu' : 'Exclude din traseu'}"><svg viewBox="0 0 24 24">${isExcluded ? '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>' : '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8 0-1.85.63-3.55 1.69-4.9L16.9 18.31C15.55 19.37 13.85 20 12 20zm6.31-3.1L7.1 5.69C8.45 4.63 10.15 4 12 4c4.42 0 8 3.58 8 8 0 1.85-.63 3.55-1.69 4.9z"/>'}</svg></button>`;
  const topButtons = isAdmin ? `
    <div class="card-btns-top">
      <button class="card-icon-btn${loc.visited ? ' done-active' : ''}" data-action="markVisited" title="${loc.visited ? 'Marchează ca nefăcut' : 'Marchează ca făcut'}">
        <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
      </button>
      <button class="card-icon-btn edit-btn" data-action="edit" title="Edit details">
        <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
      </button>
      <button class="card-icon-btn duplicate-btn" data-action="duplicate" title="Duplicate location">
        <svg viewBox="0 0 24 24"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg>
      </button>
      <button class="card-icon-btn delete" data-action="delete" title="Remove location">
        <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
      </button>
    </div>` : `
    <div class="card-btns-top">
      <button class="card-icon-btn${loc.visited ? ' done-active' : ''}" data-action="markVisited" title="${loc.visited ? 'Marchează ca nefăcut' : 'Marchează ca făcut'}">
        <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
      </button>
    </div>`;
  const cardFields = isAdmin ? `
    <div class="card-fields">
      <div class="field-group">
        <label class="field-label">Country</label>
        <input type="text" class="field-input" data-field="country" value="${esc(loc.country || '')}" placeholder="Country">
      </div>
      <div class="field-group">
        <label class="field-label">City</label>
        <input type="text" class="field-input" data-field="city" value="${esc(loc.city || '')}" placeholder="City">
      </div>
      <div class="field-group">
        <label class="field-label">Visit Date</label>
        <input type="date" class="field-input" data-field="visit_date" value="${esc(loc.visit_date || '')}">
      </div>
      <div class="field-group">
        <label class="field-label">Time &amp; Duration</label>
        <div class="time-dur-row">
          <input type="time" class="field-input" data-field="visit_time" value="${esc(loc.visit_time || '')}">
          <div class="dur-input-wrap">
            <input type="number" class="field-input dur-input" data-field="duration_minutes" value="${loc.duration_minutes || 60}" min="5" max="720" step="5" placeholder="60">
            <span class="dur-unit">min</span>
          </div>
        </div>
        <div class="dur-presets">
          <button type="button" class="dur-preset-btn" data-action="setDuration" data-dur="30">30m</button>
          <button type="button" class="dur-preset-btn" data-action="setDuration" data-dur="60">1h</button>
          <button type="button" class="dur-preset-btn" data-action="setDuration" data-dur="90">1.5h</button>
          <button type="button" class="dur-preset-btn" data-action="setDuration" data-dur="120">2h</button>
          <button type="button" class="dur-preset-btn" data-action="setDuration" data-dur="180">3h</button>
        </div>
      </div>
      <div class="field-group">
        <label class="field-label">Reservation</label>
        <select class="field-select" data-field="reservation_status">
          <option value=""${!loc.reservation_status ? ' selected' : ''}>Not reserved</option>
          <option value="reserved"${loc.reservation_status === 'reserved' ? ' selected' : ''}>Reserved</option>
          <option value="confirmed"${loc.reservation_status === 'confirmed' ? ' selected' : ''}>Confirmed</option>
        </select>
      </div>
      <div class="field-group">
        <label class="field-label">Payment</label>
        <label class="field-checkbox"><input type="checkbox" data-field="paid"${loc.paid ? ' checked' : ''}> Paid</label>
      </div>
      <div class="field-group">
        <label class="field-label">Cost</label>
        <div class="cost-wrap">
          <span class="cost-symbol">${sym}</span>
          <input type="number" class="field-input cost-input" data-field="cost"
            value="${loc.cost || 0}" min="0" step="0.01" placeholder="0">
        </div>
      </div>
      <div class="field-group">
        <label class="field-label">Category</label>
        <select class="field-select" data-field="category">${catOptions}</select>
      </div>
      <div class="field-group full-width">
        <label class="field-label">Address</label>
        <input type="text" class="field-input" data-field="address" value="${esc(loc.address || '')}" placeholder="Street address">
      </div>
      <div class="field-group full-width">
        <label class="field-label">Notes</label>
        <textarea class="field-textarea" data-field="notes" placeholder="Add notes, booking refs…">${esc(loc.notes || '')}</textarea>
      </div>
      <div class="field-group full-width doc-link-field-group">
        <div class="doc-link-header-row">
          <label class="field-label">Confirmation / document link</label>
          <div class="doc-label-input-wrap">
            <span class="doc-label-prefix">Label:</span>
            <input type="text" class="field-input doc-label-input" data-field="confirmation_label" value="${esc(loc.confirmation_label || '')}" placeholder="e.g. Bilete, Voucher…">
          </div>
        </div>
        <div class="doc-link-input-wrapper">
          <input type="url" id="docUrlInput" class="field-input" data-field="confirmation_url" value="${esc(loc.confirmation_url || '')}" placeholder="https://…">
          <button type="button" class="btn-secondary" id="openAppBtn" data-action="openDocLink">Deschide</button>
        </div>
      </div>
      <div class="field-group full-width">
        <label class="field-label">Attachments</label>
        <input type="file" class="field-input attachment-input" data-attachment-location="${esc(loc.id)}" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.svg,.doc,.docx,.xls,.xlsx">
        <div class="card-attachment-links">
        ${(loc.attachments || []).map(file => {
    const fileUrl = `/api/locations/${encodeURIComponent(loc.id)}/attachments/${encodeURIComponent(file.name)}`;
    const meta = getFileMeta(file.name);
    return `<a class="attachment-link" href="${fileUrl}" data-action="viewAttachment" data-location-id="${esc(loc.id)}" data-attachment-name="${esc(file.name)}" data-attachment-url="${esc(fileUrl)}" title="${esc(file.name)}">${meta.icon} ${esc(file.name)}</a>`;
  }).join('')}
        </div>
      </div>
      <div class="field-group full-width">
        <label class="field-label">Maps Link</label>
        <div class="maps-field-row">
          <input type="url" class="field-input" data-field="google_maps_url"
            value="${esc(loc.google_maps_url || '')}"
            placeholder="https://www.google.com/maps/place/…">
          <button class="btn-secondary maps-details-btn" data-action="findMapsDetails" type="button">Find details</button>
        </div>
      </div>
    </div>` : '';

  return `
    <div class="location-card${enabled ? '' : ' disabled'}${loc.visited ? ' row-visited' : ''}${isExcluded ? ' card-excluded' : ''}" data-id="${esc(loc.id)}" style="--cat-color: var(--cat-${safecat});">
      <div class="card-window-titlebar">
        <span class="window-titlebar-icon">${icon}</span>
        <div class="card-name window-titlebar-title">${titleMarkup}</div>
        ${titlebarMetaHTML(loc, sym)}
      </div>
      <div class="card-body">
        <div class="card-meta-strip">
          <div class="meta-strip-place${loc.address ? ' has-address address-expanded is-open' : ''}"${loc.address ? ' data-action="toggleAddress" role="button" tabindex="0" aria-expanded="true"' : ''} title="${esc(loc.city ? `${loc.city}, ${loc.country}` : (loc.country || ''))}${loc.address ? ' • Apasă pentru a ascunde adresa' : ''}">
            <span class="meta-flag-wrap">${flagHTML(loc.country, loc.country_code)}</span>
            <span class="meta-place-label">${esc(placeName)}</span>
            ${loc.address ? '<span class="meta-address-toggle-icon" title="Apasă pentru a ascunde adresa"></span>' : ''}
          </div>
          ${(loc.visit_date || durationChip) ? `
          <div class="meta-strip-schedule">
            ${loc.visit_date ? `
            <span class="meta-sched-icon">🗓️</span>
            <span class="meta-sched-date">${schedDateStr}</span>
            ${schedTimeRange ? `<span class="meta-sched-divider">·</span><span class="meta-sched-time">${schedTimeRange}</span>` : ''}
            ` : ''}
            ${durationChip ? `${loc.visit_date ? '<span class="meta-sched-divider">·</span>' : ''}${durationChip}` : ''}
          </div>` : ''}
        </div>
        ${addressLine}
        ${loc.place_info ? `<div class="place-info-text">${esc(loc.place_info)}</div>` : ''}
        ${renderCardSubcardHTML(loc)}
        <div class="card-actions">
          ${topButtons}
          ${(mapsBtn || wazeBtn || navGpsBtn || excludeBtn) ? `<div class="card-nav-btns">${excludeBtn}${mapsBtn}${wazeBtn}${navGpsBtn}</div>` : ''}
        </div>
        ${cardFields}
      </div>
    </div>`;
}

function renderTableView() {
  const locs = getFilteredLocations();
  if (!locs.length) return emptyStateHTML('No locations found', 'Try adjusting your filters.');

  const cur = state.trip?.currency;
  const sym = getCurrencySymbol(cur);

  const catOptions = sel => VALID_CATEGORIES.map(c =>
    `<option value="${c}"${c === sel ? ' selected' : ''}>${CATEGORY_ICONS[c]} ${c.charAt(0).toUpperCase() + c.slice(1)}</option>`
  ).join('');

  const rows = locs.map(loc => {
    const cat = VALID_CATEGORIES.includes(loc.category) ? loc.category : 'other';
    const en = loc.enabled !== false;
    const mapLink = safeMapsUrl(loc.google_maps_url);
    return `
      <tr class="loc-row${en ? '' : ' row-disabled'}${loc.visited ? ' row-visited' : ''}${(loc.excluded || state.mapExcluded.has(loc.id)) ? ' row-excluded' : ''}" data-id="${esc(loc.id)}">
        <td class="td-done td-ctrl">
          <button class="card-icon-btn${loc.visited ? ' done-active' : ''}" data-action="markVisited" title="${loc.visited ? 'Marchează ca nefăcut' : 'Marchează ca făcut'}">
            <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
          </button>
        </td>
        <td class="td-date" data-label="Date">
          <input type="date" class="tbl-input" data-field="visit_date" value="${esc(loc.visit_date || '')}">
        </td>
        <td class="td-time" data-label="Time">
          <input type="time" class="tbl-input" data-field="visit_time" value="${esc(loc.visit_time || '')}">
        </td>
        <td class="td-name" data-label="Name">
          <div class="cell-name">
            ${mapLink ? `<a href="${mapLink}" target="_blank" rel="noopener" class="card-icon-btn" style="flex-shrink:0" title="Maps">
              <svg viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>
            </a>` : ''}
            ${wazeUrl(loc) ? `<a href="${wazeUrl(loc)}" target="_blank" rel="noopener noreferrer" class="card-icon-btn waze-btn" style="flex-shrink:0" title="Waze">
              <svg viewBox="0 0 24 24"><path d="M12 2a9 9 0 0 1 9 9c0 3.5-2 6.6-4.9 8.2L15 21l-3 1-3-1-.1-1.8C6 18.6 4 15.5 4 12a9 9 0 0 1 8-8.94V2zm0 2a7 7 0 1 0 0 14A7 7 0 0 0 12 4zm-1 3h2v5.5l3.2 1.9-1 1.7L11 14V7z"/></svg>
            </a>` : ''}
            <span class="cell-name-text" title="${esc(loc.address)}">${CATEGORY_ICONS[cat]} ${esc(loc.name)}</span>
          </div>
        </td>
        <td class="td-country" data-label="Country">
          <input class="tbl-input" data-field="country" value="${esc(loc.country || '')}" placeholder="Country">
        </td>
        <td class="td-city" data-label="City">
          <input class="tbl-input" data-field="city" value="${esc(loc.city || '')}" placeholder="City">
        </td>
        <td class="td-cost" data-label="Cost">
          <div class="cost-cell">
            <span class="cost-sym">${sym}</span>
            <input type="number" class="tbl-input" data-field="cost" value="${loc.cost || 0}" min="0" step="0.01">
          </div>
        </td>
        <td class="td-cat" data-label="Category">
          <select class="tbl-select" data-field="category">${catOptions(cat)}</select>
        </td>
        <td class="td-notes" data-label="Notes">
          <input class="tbl-input" data-field="notes" value="${esc(loc.notes || '')}" placeholder="Notes…">
        </td>
        <td class="td-address" data-label="Address">
          <input class="tbl-input" data-field="address" value="${esc(loc.address || '')}" placeholder="Address…">
        </td>
        <td class="td-mapsurl" data-label="Maps URL">
          <input type="url" class="tbl-input" data-field="google_maps_url" value="${esc(loc.google_maps_url || '')}" placeholder="https://…">
        </td>
        <td class="td-actions td-ctrl">
          <button type="button" class="card-icon-btn gps-nav-btn" data-action="navigateFromCurrent" data-loc-id="${esc(loc.id)}" title="Go To (navighează de la locația curentă)">
            <svg viewBox="0 0 24 24"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>
          </button>
          <button type="button" class="card-icon-btn exclude-route-btn${(loc.excluded || state.mapExcluded.has(loc.id)) ? ' is-excluded' : ''}" data-action="toggleRouteExclude" title="${(loc.excluded || state.mapExcluded.has(loc.id)) ? 'Include în traseu' : 'Exclude din traseu'}">
            <svg viewBox="0 0 24 24">${(loc.excluded || state.mapExcluded.has(loc.id)) ? '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>' : '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8 0-1.85.63-3.55 1.69-4.9L16.9 18.31C15.55 19.37 13.85 20 12 20zm6.31-3.1L7.1 5.69C8.45 4.63 10.15 4 12 4c4.42 0 8 3.58 8 8 0 1.85-.63 3.55-1.69 4.9z"/>'}</svg>
          </button>
          <button class="card-icon-btn delete" data-action="delete" title="Remove">
            <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </td>
      </tr>`;
  }).join('');

  return `
    <div class="table-wrapper">
      <table class="locations-table">
        <thead>
          <tr>
            <th class="td-done" title="Vizitat">✓</th>
            <th class="td-date">Date</th>
            <th class="td-time">Time</th>
            <th class="td-name">Name</th>
            <th class="td-country">Country</th>
            <th class="td-city">City</th>
            <th class="td-cost">Cost</th>
            <th class="td-cat">Category</th>
            <th class="td-notes">Notes</th>
            <th class="td-address">Address</th>
            <th class="td-mapsurl">Maps URL</th>
            <th class="td-actions"></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function emptyStateHTML(title, text) {
  return `<div class="empty-state">
    <div class="empty-state-icon">🗺️</div>
    <div class="empty-state-title">${title}</div>
    <div class="empty-state-text">${text}</div>
  </div>`;
}

function isNarrowViewport() {
  return typeof window !== 'undefined' && window.innerWidth <= 600;
}

function getMaxCardsPerRow() {
  if (typeof window === 'undefined') return 4;
  const width = window.innerWidth;
  // Dynamic maximum based on resolution:
  // Phones (< 700px): max 1
  // Tablets / Fold inner (700px - 1099px): max 2
  // Laptop / medium desktop (1100px - 1549px): max 3
  // Full HD 1920x1080 (1550px - 2099px): max 4 (5 is explicitly too many on 1920x1080)
  // QHD / 4K / Ultrawide (>= 2100px): max 5
  if (width < 700) return 1;
  if (width < 1100) return 2;
  if (width < 1550) return 3;
  if (width < 2100) return 4;
  return 5;
}

function updateCardsPerRowOptions() {
  const max = getMaxCardsPerRow();
  const selects = [
    document.getElementById('cardsPerRowSelect'),
    document.getElementById('cardsPerRowSelectMobile')
  ];

  selects.forEach(sel => {
    if (!sel) return;
    const currentVal = parseInt(sel.value || state.cardsPerRow || '3', 10);

    let html = '';
    for (let i = 1; i <= max; i++) {
      const label = i === 1 ? '1 card / rând' : `${i} carduri / rând`;
      html += `<option value="${i}">${label}</option>`;
    }
    sel.innerHTML = html;

    const clamped = Math.min(Math.max(1, currentVal), max);
    sel.value = String(clamped);
  });
}

function equalizeCardHeights() {
  if (typeof window === 'undefined') return;
  const mainContent = document.getElementById('mainContent');
  if (!mainContent) return;

  const cards = mainContent.querySelectorAll('.location-card:not(.editing)');
  if (!cards.length || window.innerWidth <= 600) {
    document.documentElement.style.removeProperty('--card-uniform-height');
    return;
  }

  // Temporarily reset property so we can measure natural heights
  document.documentElement.style.setProperty('--card-uniform-height', 'auto');

  let maxHeight = 0;
  for (let i = 0; i < cards.length; i++) {
    const h = cards[i].offsetHeight;
    if (h > maxHeight) maxHeight = h;
  }

  if (maxHeight > 0) {
    const targetHeight = Math.max(maxHeight, 175);
    document.documentElement.style.setProperty('--card-uniform-height', `${targetHeight}px`);
  }
}

let _equalizeRaf = null;
function scheduleEqualizeCardHeights() {
  if (typeof window === 'undefined') return;
  cancelAnimationFrame(_equalizeRaf);
  _equalizeRaf = requestAnimationFrame(() => {
    equalizeCardHeights();
  });
}

function applyCardsPerRowMode() {
  const isNarrow = isNarrowViewport();
  const maxAllowed = getMaxCardsPerRow();

  updateCardsPerRowOptions();

  let targetCols = state.cardsPerRow;
  if (!targetCols || isNaN(targetCols)) {
    targetCols = isNarrow ? 1 : Math.min(3, maxAllowed);
    if (state.singleCol) targetCols = 1;
  }

  const effectiveCols = isNarrow ? 1 : Math.min(Math.max(1, targetCols), maxAllowed);
  state.singleCol = (effectiveCols === 1);

  document.documentElement.style.setProperty('--cards-per-row', effectiveCols);
  document.body.setAttribute('data-cards-per-row', effectiveCols);

  const isSingle = isNarrow || (effectiveCols === 1);
  document.body.classList.toggle('single-col-cards', isSingle);

  const select = document.getElementById('cardsPerRowSelect');
  if (select && select.value !== String(effectiveCols)) {
    select.value = String(effectiveCols);
  }
  const selectMob = document.getElementById('cardsPerRowSelectMobile');
  if (selectMob && selectMob.value !== String(effectiveCols)) {
    selectMob.value = String(effectiveCols);
  }
  const toggle = document.getElementById('singleColToggle');
  if (toggle) toggle.checked = isSingle;
  const toggleMobile = document.getElementById('singleColToggleMobile');
  if (toggleMobile) toggleMobile.checked = isSingle;

  const rowMobile = document.getElementById('singleColToggleRowMobile') || toggleMobile?.closest('label');
  if (rowMobile) {
    rowMobile.style.display = isNarrow ? 'none' : '';
  }
  const modalRow = document.getElementById('cardsPerRowModalGroup');
  if (modalRow) {
    modalRow.style.display = isNarrow ? 'none' : '';
  }

  scheduleEqualizeCardHeights();
}

function applySingleColMode() {
  applyCardsPerRowMode();
}

// Mobile filter active dot indicator
function updateFilterActiveDot() {
  const isNarrow = isNarrowViewport();
  const isFiltered = (state.filter.category && state.filter.category !== 'all') ||
    (state.filter.country && state.filter.country !== 'all') ||
    (state.sortBy && state.sortBy !== 'added') ||
    Boolean(state.hideVisited) ||
    (!isNarrow && (Boolean(state.singleCol) || (state.cardsPerRow && state.cardsPerRow !== 3)));
  const dot = document.getElementById('filterActiveDot');
  if (dot) dot.style.display = isFiltered ? 'inline-block' : 'none';
}

// Narrow mobile nav Views toggle cycle
const NARROW_DAYS_CYCLE = [
  {
    view: 'day',
    label: 'Days',
    svg: '<path d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V10h14v10zM9 14H7v-2h2v2zm4 0h-2v-2h2v2zm4 0h-2v-2h2v2zm-8 4H7v-2h2v2zm4 0h-2v-2h2v2zm4 0h-2v-2h2v2zM5 8V6h14v2H5z" />'
  },
  {
    view: 'country',
    label: 'Countries',
    svg: '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" />'
  },
  {
    view: 'table',
    label: 'Table',
    svg: '<path d="M3 3h18v18H3V3zm16 16V5H5v14h14zM7 7h2v2H7V7zm0 4h2v2H7v-2zm0 4h2v2H7v-2zm4-8h6v2h-6V7zm0 4h6v2h-6v-2zm0 4h6v2h-6v-2z" />'
  }
];

function updateControlsBarHeight() {
  const cb = document.querySelector('.controls-bar');
  if (cb && cb.offsetHeight > 0) {
    document.documentElement.style.setProperty('--controls-bar-h', `${cb.offsetHeight}px`);
  }
}

function updateDaysToggleLabel() {
  const nav = document.getElementById('mobileNav');
  if (!nav) return;
  nav.querySelectorAll('.mnav-btn[data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === state.view);
  });
  const activeBtn = nav.querySelector(`.mnav-btn[data-view="${state.view}"]`);
  if (activeBtn) {
    try {
      activeBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    } catch (_) { }
  }
}

function updateAddBtnText() {
  const addBtn = document.getElementById('addBtn');
  if (!addBtn) return;
  const textEl = addBtn.querySelector('.menu-btn-text');
  if (!textEl) return;
  const isNarrow = window.innerWidth <= 480;
  textEl.textContent = isNarrow ? '+' : 'Add';
}

function updateNarrowMobileNav() {
  if (state.view === 'list' && isNarrowScreen()) {
    state.view = 'day';
    savePrefs({ view: 'day' });
    document.querySelectorAll('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === 'day'));
    document.querySelectorAll('.mnav-btn[data-view]').forEach(t => t.classList.toggle('active', t.dataset.view === 'day'));
    renderMain();
  }
  updateAddBtnText();
  updateControlsBarHeight();
  updateDaysToggleLabel();
}
window.updateNarrowMobileNav = updateNarrowMobileNav;
window.updateAddBtnText = updateAddBtnText;

// ============================================================
// EVENT HANDLERS
// ============================================================
function bindEvents() {
  if (state.role !== 'admin') {
    document.getElementById('installBtn')?.remove();
    document.getElementById('addBtn')?.remove();
    document.getElementById('uploadBtn')?.remove();
    document.getElementById('restoreBtn')?.remove();
    document.getElementById('saveBtn')?.remove();
    document.getElementById('backupBtn')?.remove();
    document.getElementById('clearAllBtn')?.remove();
    document.getElementById('modalAddAttachmentBtn')?.remove();
    document.getElementById('modalDeleteAttachmentBtn')?.remove();
    document.getElementById('genericDocEmptyAddBtn')?.remove();
    document.querySelectorAll('.edit-btn, .duplicate-btn, .delete, .attachment-add-btn').forEach(el => el.remove());
    const tripNameInput = document.getElementById('tripNameInput');
    if (tripNameInput) {
      tripNameInput.readOnly = true;
      tripNameInput.title = 'Read-only mode';
    }
  }

  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    window.location.href = '/logout';
  });
  document.getElementById('mobileLogout')?.addEventListener('click', () => {
    window.location.href = '/logout';
  });

  // Admin Login Modal (under /user in hamburger menu)
  const adminPasswordModal = document.getElementById('adminPasswordModal');
  const adminPasswordInput = document.getElementById('adminPasswordInput');
  const adminPasswordError = document.getElementById('adminPasswordError');

  const openAdminPasswordModal = () => {
    if (!adminPasswordModal) return;
    if (adminPasswordInput) adminPasswordInput.value = '';
    if (adminPasswordError) {
      adminPasswordError.style.display = 'none';
      adminPasswordError.textContent = '';
    }
    adminPasswordModal.classList.add('open');
    setTimeout(() => adminPasswordInput?.focus(), 50);
  };

  const closeAdminPasswordModal = () => {
    adminPasswordModal?.classList.remove('open');
    if (adminPasswordInput) adminPasswordInput.value = '';
    if (adminPasswordError) {
      adminPasswordError.style.display = 'none';
      adminPasswordError.textContent = '';
    }
  };

  document.getElementById('adminLoginBtn')?.addEventListener('click', () => {
    closeHamburgerMenu();
    openAdminPasswordModal();
  });

  document.getElementById('closeAdminPasswordModal')?.addEventListener('click', closeAdminPasswordModal);
  document.getElementById('cancelAdminPasswordBtn')?.addEventListener('click', closeAdminPasswordModal);
  adminPasswordModal?.addEventListener('click', e => {
    if (e.target === adminPasswordModal) closeAdminPasswordModal();
  });

  const submitAdminLogin = async () => {
    const password = (adminPasswordInput?.value || '').trim();
    if (!password) {
      if (adminPasswordError) {
        adminPasswordError.textContent = 'Introduceți parola.';
        adminPasswordError.style.display = 'block';
      }
      return;
    }
    const submitBtn = document.getElementById('submitAdminPasswordBtn');
    if (submitBtn) submitBtn.disabled = true;
    try {
      const res = await fetch('/loginadmin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ password })
      });
      if (res.ok) {
        window.location.href = '/admin';
      } else {
        const data = await res.json().catch(() => ({}));
        if (adminPasswordError) {
          adminPasswordError.textContent = data.error || 'Parola este incorectă.';
          adminPasswordError.style.display = 'block';
        }
        if (adminPasswordInput) {
          adminPasswordInput.value = '';
          adminPasswordInput.focus();
        }
      }
    } catch (_) {
      if (adminPasswordError) {
        adminPasswordError.textContent = 'Eroare de rețea. Încercați din nou.';
        adminPasswordError.style.display = 'block';
      }
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  };

  document.getElementById('adminPasswordForm')?.addEventListener('submit', e => {
    e.preventDefault();
    submitAdminLogin();
  });

  const mobileMenuButton = document.getElementById('mobileMenuBtn');
  const appHeader = document.querySelector('.app-header');
  const closeHamburgerMenu = () => {
    appHeader?.classList.remove('mobile-menu-open');
    mobileMenuButton?.setAttribute('aria-expanded', 'false');
    if (mobileMenuButton) mobileMenuButton.textContent = '☰';
  };
  mobileMenuButton?.addEventListener('click', event => {
    event.stopPropagation();
    const open = appHeader?.classList.toggle('mobile-menu-open');
    mobileMenuButton.setAttribute('aria-expanded', String(Boolean(open)));
    mobileMenuButton.textContent = open ? '×' : '☰';
  });
  document.addEventListener('click', event => {
    if (!appHeader?.classList.contains('mobile-menu-open') || event.target.closest('.app-header')) return;
    closeHamburgerMenu();
  });
  document.querySelectorAll('.header-actions .menu-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      closeHamburgerMenu();
    });
  });

  const closeNotifications = () => document.getElementById('notificationsModal')?.classList.remove('open');
  document.getElementById('notificationsBtn')?.addEventListener('click', () => {
    renderNotifications();
    document.getElementById('notificationsModal')?.classList.add('open');
  });
  document.getElementById('notificationsList')?.addEventListener('click', event => {
    const notification = event.target.closest('[data-notification-location]');
    if (notification) openNotificationLocation(notification.dataset.notificationLocation);
  });
  document.getElementById('closeLocationModal')?.addEventListener('click', closeLocationModal);
  document.getElementById('closeNotificationLocation')?.addEventListener('click', closeLocationModal);
  const locationModalEl = document.getElementById('locationModal') || document.getElementById('notificationLocationModal');
  locationModalEl?.addEventListener('click', event => {
    if (event.target === locationModalEl) closeLocationModal();
    else if (event.target.closest('[data-action], .confirmation-link')) handleCardClick(event);
  });
  const locationModalBodyEl = document.getElementById('locationModalBody') || document.getElementById('notificationLocationBody');
  locationModalBodyEl?.addEventListener('change', handleCardChange);

  const handleNameInput = e => {
    if (e.target.dataset?.field === 'name') {
      const card = e.target.closest('[data-id]');
      if (card) {
        const textEl = card.querySelector('.card-name-text');
        if (textEl) {
          textEl.textContent = e.target.value || '';
        }
      }
    }
  };
  locationModalBodyEl?.addEventListener('input', handleNameInput);

  // Global delegation for opening location card in modal or launching confirmation links
  document.addEventListener('click', event => {
    const docBtn = event.target.closest('[data-action="openDocLink"], #openAppBtn');
    if (docBtn) {
      event.preventDefault();
      event.stopPropagation();
      const group = docBtn.closest('.doc-link-field-group');
      const input = group?.querySelector('[data-field="confirmation_url"]') || document.getElementById('docUrlInput');
      const rawUrl = input ? input.value : '';
      launchConfirmationUrl(rawUrl);
      return;
    }
    const confLink = event.target.closest('.confirmation-link, [data-action="openConfirmationDoc"]');
    if (confLink && !confLink.closest('#mainContent') && !confLink.closest('#locationModal') && !confLink.closest('#notificationLocationModal')) {
      handleCardClick(event);
      return;
    }
    const countryBadge = event.target.closest('[data-action="goToCountry"], .country-badge');
    if (countryBadge) {
      event.preventDefault();
      const country = countryBadge.dataset.country;
      if (country) navigateToCountry(country);
      return;
    }
    const cardBtn = event.target.closest('[data-open-card-modal]');
    if (cardBtn && cardBtn.dataset.openCardModal) {
      event.preventDefault();
      openLocationModal(cardBtn.dataset.openCardModal);
    }
    const tdayBtn = event.target.closest('[data-timeline-day]');
    if (tdayBtn) {
      state.timelineDay = tdayBtn.dataset.timelineDay;
      savePrefs({ timelineDay: state.timelineDay });
      renderMain();
    }
  });
  document.getElementById('closeNotifications')?.addEventListener('click', closeNotifications);
  document.getElementById('notificationsModal')?.addEventListener('click', event => {
    if (event.target.id === 'notificationsModal') closeNotifications();
  });
  document.getElementById('enableNotifications')?.addEventListener('click', async () => {
    if (!('Notification' in window)) {
      toast('Acest browser nu suportă notificări de sistem.', 'warning');
      return;
    }
    if (Notification.permission === 'granted') {
      await showNativeNotification('EuroTrip - Test Notificare', {
        body: 'Notificările de sistem funcționează perfect!',
        icon: '/static/icons/icon-192.svg'
      });
      toast('Notificare de test trimisă!', 'success');
      return;
    }
    const perm = await Notification.requestPermission();
    renderNotifications();
    updateNotifications(true);
    if (perm === 'granted') {
      await showNativeNotification('EuroTrip', {
        body: 'Notificările de sistem au fost activate!',
        icon: '/static/icons/icon-192.svg'
      });
      toast('Notificările de sistem au fost activate.', 'success');
    } else {
      toast('Permisiunea pentru notificări a fost refuzată.', 'warning');
    }
  });

  document.getElementById('closeRouteOptionsModal')?.addEventListener('click', closeRouteOptionsModal);
  document.getElementById('routeOptionsModal')?.addEventListener('click', e => {
    if (e.target.id === 'routeOptionsModal') closeRouteOptionsModal();
  });
  document.getElementById('confirmRouteCalcBtn')?.addEventListener('click', async () => {
    const modal = document.getElementById('routeOptionsModal');
    const origin = modal?.querySelector('input[name="routeOriginChoice"]:checked')?.value || 'itinerary';
    const scope = modal?.querySelector('input[name="routeScopeChoice"]:checked')?.value || 'all';
    const mode = modal?.querySelector('input[name="routeModeChoice"]:checked')?.value || 'transit';

    state.routeOrigin = origin;
    state.routeScope = scope;
    state.routeMode = mode;
    savePrefs({ routeOrigin: origin, routeScope: scope, routeMode: mode });

    const originSel = document.getElementById('routeOriginSelect') || document.getElementById('mapRouteOrigin');
    if (originSel) originSel.value = origin;
    const modeSel = document.getElementById('routeModeSelect') || document.getElementById('mapRouteMode');
    if (modeSel) modeSel.value = mode;
    const scopeSel = document.getElementById('routeScopeSelect');
    if (scopeSel) scopeSel.value = scope;

    closeRouteOptionsModal();
    await executeRouteCalculation({ origin, scope, mode });
  });

  document.getElementById('directNavBtn')?.addEventListener('click', async () => {
    closeRouteOptionsModal();
    await openDirectNavigation();
  });

  let pendingDeleteTrip = '';
  const closeTripManagerModal = () => document.getElementById('tripManagerModal')?.classList.remove('open');
  const closeDeleteTripModal = () => {
    pendingDeleteTrip = '';
    document.getElementById('deleteTripModal')?.classList.remove('open');
  };
  const openDeleteTripModal = trip => {
    pendingDeleteTrip = trip.id;
    const name = document.getElementById('deleteTripName');
    if (name) name.textContent = trip.name;
    document.getElementById('deleteTripModal')?.classList.add('open');
  };
  const openTripManagerModal = () => {
    renderTripManager();
    document.getElementById('tripManagerModal')?.classList.add('open');
  };
  document.getElementById('tripSelector')?.addEventListener('click', openTripManagerModal);
  document.getElementById('closeTripManagerModal')?.addEventListener('click', closeTripManagerModal);
  document.getElementById('tripManagerModal')?.addEventListener('click', e => {
    if (e.target.id === 'tripManagerModal') closeTripManagerModal();
    const selectButton = e.target.closest('[data-select-trip]');
    const deleteButton = e.target.closest('[data-delete-trip]');
    if (selectButton) {
      api.selectTrip(selectButton.dataset.selectTrip).then(data => {
        setActiveTrip(data.trip);
        refreshTripSelector(data.active);
        closeTripManagerModal();
        toast(`Switched to ${data.trip.trip_name}.`, 'success');
      }).catch(error => toast('Could not switch trip: ' + error.message, 'error'));
    } else if (deleteButton && state.role === 'admin') {
      const trip = (state.tripCatalog || []).find(item => item.id === deleteButton.dataset.deleteTrip);
      if (trip) openDeleteTripModal(trip);
    }
  });
  document.getElementById('closeDeleteTripModal')?.addEventListener('click', closeDeleteTripModal);
  document.getElementById('cancelDeleteTrip')?.addEventListener('click', closeDeleteTripModal);
  document.getElementById('deleteTripModal')?.addEventListener('click', e => {
    if (e.target.id === 'deleteTripModal') closeDeleteTripModal();
  });
  document.getElementById('confirmDeleteTrip')?.addEventListener('click', async () => {
    if (!pendingDeleteTrip) return;
    try {
      const data = await api.deleteTrip(pendingDeleteTrip);
      setActiveTrip(data.trip);
      await refreshTripSelector(data.active);
      closeDeleteTripModal();
      closeTripManagerModal();
      toast('Trip deleted.', 'success');
    } catch (error) {
      toast('Could not delete trip: ' + error.message, 'error');
    }
  });

  const closeNewTripModal = () => document.getElementById('newTripModal')?.classList.remove('open');
  document.getElementById('newTripBtn')?.addEventListener('click', () => {
    const input = document.getElementById('newTripName');
    if (input) input.value = '';
    document.getElementById('newTripModal')?.classList.add('open');
    input?.focus();
  });
  document.getElementById('closeNewTripModal')?.addEventListener('click', closeNewTripModal);
  document.getElementById('cancelNewTrip')?.addEventListener('click', closeNewTripModal);
  document.getElementById('newTripModal')?.addEventListener('click', e => {
    if (e.target.id === 'newTripModal') closeNewTripModal();
  });
  document.getElementById('confirmNewTrip')?.addEventListener('click', async () => {
    const input = document.getElementById('newTripName');
    const name = input?.value.trim();
    if (!name) { input?.focus(); return; }
    const button = document.getElementById('confirmNewTrip');
    if (button) button.disabled = true;
    try {
      const data = await api.createTrip(name);
      setActiveTrip(data.trip);
      await refreshTripSelector(data.active);
      closeNewTripModal();
      toast(`Created trip: ${data.trip.trip_name}.`, 'success');
    } catch (error) {
      toast('Could not create trip: ' + error.message, 'error');
    } finally {
      if (button) button.disabled = false;
    }
  });

  window.addEventListener('resize', updateNarrowMobileNav);
  window.addEventListener('orientationchange', updateNarrowMobileNav);

  // View tabs (both desktop tabs and mobile nav)
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      let v = btn.dataset.view;
      if (!v) return;
      if (v === 'list' && isNarrowScreen()) {
        v = 'day';
      }
      if (v !== 'map') {
        exitMapFullscreen();
      }
      state.view = v;
      savePrefs({ view: v });
      document.querySelectorAll('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
      document.querySelectorAll('.mnav-btn[data-view]').forEach(t => t.classList.toggle('active', t.dataset.view === v));
      renderMain();
      updateControlsBarHeight();
      updateDaysToggleLabel();
    });
  });

  // Search (debounced)
  let searchTimer;
  document.getElementById('searchInput')?.addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.filter.search = e.target.value; renderMain(); }, 220);
  });


  // Filters (Desktop)
  document.getElementById('categoryFilter')?.addEventListener('change', e => {
    state.filter.category = e.target.value;
    updateFilterActiveDot();
    renderMain();
  });
  document.getElementById('countryFilter')?.addEventListener('change', e => {
    state.filter.country = e.target.value;
    updateFilterActiveDot();
    renderMain();
  });
  document.getElementById('sortSelect')?.addEventListener('change', e => {
    state.sortBy = e.target.value;
    savePrefs({ sortBy: e.target.value });
    updateFilterActiveDot();
    renderMain();
  });
  document.getElementById('showDisabled')?.addEventListener('change', e => {
    state.filter.showDisabled = e.target.checked;
    renderMain();
  });
  document.getElementById('hideVisited')?.addEventListener('change', e => {
    state.hideVisited = e.target.checked;
    savePrefs({ hideVisited: e.target.checked });
    updateFilterActiveDot();
    renderMain();
  });
  document.getElementById('cardsPerRowSelect')?.addEventListener('change', e => {
    const val = parseInt(e.target.value, 10);
    state.cardsPerRow = val;
    state.singleCol = (val === 1);
    savePrefs({ cardsPerRow: val, singleCol: state.singleCol });
    updateFilterActiveDot();
    applyCardsPerRowMode();
    renderMain();
  });
  document.getElementById('cardsPerRowSelectMobile')?.addEventListener('change', e => {
    const val = parseInt(e.target.value, 10);
    state.cardsPerRow = val;
    state.singleCol = (val === 1);
    savePrefs({ cardsPerRow: val, singleCol: state.singleCol });
    updateFilterActiveDot();
    applyCardsPerRowMode();
    renderMain();
  });
  document.getElementById('singleColToggle')?.addEventListener('change', e => {
    state.singleCol = e.target.checked;
    state.cardsPerRow = e.target.checked ? 1 : 3;
    savePrefs({ singleCol: e.target.checked, cardsPerRow: state.cardsPerRow });
    updateFilterActiveDot();
    applyCardsPerRowMode();
    renderMain();
  });

  // Mobile Filter Modal Logic
  const filterModal = document.getElementById('filterModal');
  const openFilterModalBtn = document.getElementById('openFilterModalBtn');
  const closeFilterModal = document.getElementById('closeFilterModal');
  const applyFiltersBtn = document.getElementById('applyFiltersBtn');
  const resetFiltersBtn = document.getElementById('resetFiltersBtn');

  function syncFiltersToMobileModal() {
    const catMob = document.getElementById('categoryFilterMobile');
    if (catMob) catMob.value = state.filter.category || 'all';
    const countryMob = document.getElementById('countryFilterMobile');
    if (countryMob) countryMob.value = state.filter.country || 'all';
    const sortMob = document.getElementById('sortSelectMobile');
    if (sortMob) sortMob.value = state.sortBy || 'added';
    const hvMob = document.getElementById('hideVisitedMobile');
    if (hvMob) hvMob.checked = Boolean(state.hideVisited);
    const isNarrow = isNarrowViewport();
    const scMob = document.getElementById('singleColToggleMobile');
    if (scMob) scMob.checked = isNarrow || Boolean(state.singleCol);
    const scRowMob = document.getElementById('singleColToggleRowMobile') || scMob?.closest('label');
    if (scRowMob) scRowMob.style.display = isNarrow ? 'none' : '';
    const cpMob = document.getElementById('cardsPerRowSelectMobile');
    if (cpMob) {
      updateCardsPerRowOptions();
      cpMob.value = String(state.cardsPerRow || (state.singleCol ? 1 : Math.min(2, getMaxCardsPerRow())));
    }
    const cpGroup = document.getElementById('cardsPerRowModalGroup');
    if (cpGroup) cpGroup.style.display = isNarrow ? 'none' : '';
  }

  const closeFilterModalFn = () => filterModal?.classList.remove('open');

  openFilterModalBtn?.addEventListener('click', () => {
    syncFiltersToMobileModal();
    filterModal?.classList.add('open');
  });

  closeFilterModal?.addEventListener('click', closeFilterModalFn);
  filterModal?.addEventListener('click', e => {
    if (e.target.id === 'filterModal') closeFilterModalFn();
  });

  applyFiltersBtn?.addEventListener('click', () => {
    const catMob = document.getElementById('categoryFilterMobile');
    if (catMob) {
      state.filter.category = catMob.value;
      const dCat = document.getElementById('categoryFilter');
      if (dCat) dCat.value = catMob.value;
    }
    const countryMob = document.getElementById('countryFilterMobile');
    if (countryMob) {
      state.filter.country = countryMob.value;
      const dCountry = document.getElementById('countryFilter');
      if (dCountry) dCountry.value = countryMob.value;
    }
    const sortMob = document.getElementById('sortSelectMobile');
    if (sortMob) {
      state.sortBy = sortMob.value;
      savePrefs({ sortBy: sortMob.value });
      const dSort = document.getElementById('sortSelect');
      if (dSort) dSort.value = sortMob.value;
    }
    const hvMob = document.getElementById('hideVisitedMobile');
    if (hvMob) {
      state.hideVisited = hvMob.checked;
      savePrefs({ hideVisited: hvMob.checked });
      const dHv = document.getElementById('hideVisited');
      if (dHv) dHv.checked = hvMob.checked;
    }
    const scMob = document.getElementById('singleColToggleMobile');
    if (scMob) {
      state.singleCol = scMob.checked;
      if (scMob.checked) state.cardsPerRow = 1;
      savePrefs({ singleCol: scMob.checked, cardsPerRow: state.cardsPerRow });
      const dSc = document.getElementById('singleColToggle');
      if (dSc) dSc.checked = scMob.checked;
    }
    const cpMob = document.getElementById('cardsPerRowSelectMobile');
    if (cpMob) {
      const val = parseInt(cpMob.value, 10);
      if (!isNaN(val)) {
        state.cardsPerRow = val;
        state.singleCol = (val === 1);
        savePrefs({ cardsPerRow: val, singleCol: state.singleCol });
        const dCp = document.getElementById('cardsPerRowSelect');
        if (dCp) dCp.value = String(val);
      }
    }
    applyCardsPerRowMode();
    updateFilterActiveDot();
    closeFilterModalFn();
    renderMain();
  });

  resetFiltersBtn?.addEventListener('click', () => {
    state.filter.category = 'all';
    state.filter.country = 'all';
    state.sortBy = 'added';
    state.hideVisited = false;
    state.cardsPerRow = Math.min(3, getMaxCardsPerRow());
    state.singleCol = false;
    savePrefs({ sortBy: 'added', hideVisited: false, cardsPerRow: state.cardsPerRow, singleCol: false });

    const catMob = document.getElementById('categoryFilterMobile');
    if (catMob) catMob.value = 'all';
    const countryMob = document.getElementById('countryFilterMobile');
    if (countryMob) countryMob.value = 'all';
    const sortMob = document.getElementById('sortSelectMobile');
    if (sortMob) sortMob.value = 'added';
    const hvMob = document.getElementById('hideVisitedMobile');
    if (hvMob) hvMob.checked = false;

    const dCat = document.getElementById('categoryFilter');
    if (dCat) dCat.value = 'all';
    const dCountry = document.getElementById('countryFilter');
    if (dCountry) dCountry.value = 'all';
    const dSort = document.getElementById('sortSelect');
    if (dSort) dSort.value = 'added';
    const dHv = document.getElementById('hideVisited');
    if (dHv) dHv.checked = false;

    applyCardsPerRowMode();
    updateFilterActiveDot();
    closeFilterModalFn();
    renderMain();
  });

  // Responsive fold/unfold and narrow viewport detection
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    applyCardsPerRowMode();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      scheduleEqualizeCardHeights();
    }, 60);
  });

  // Trip name
  document.getElementById('tripNameInput')?.addEventListener('change', e => { state.trip.trip_name = e.target.value; markUnsaved(); updateDocumentTitle(e.target.value); });
  document.getElementById('tripNameInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.target.blur(); }
  });

  // Add location
  const addAction = () => addBlankLocation();
  document.getElementById('addBtn')?.addEventListener('click', addAction);
  document.getElementById('addBtn')?.addEventListener('click', addAction);

  // Save
  const saveAction = async () => {
    const btn = document.getElementById('saveBtn');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.7'; }
    try {
      await api.saveTrip(state.trip);
      state.unsaved = false;
      document.getElementById('unsavedDot')?.classList.remove('visible');
      toast('Trip saved!', 'success');
    } catch (e) {
      toast('Save failed: ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    }
  };
  document.getElementById('saveBtn')?.addEventListener('click', saveAction);
  document.getElementById('mobileSave')?.addEventListener('click', saveAction);

  const closeBackupModal = () => document.getElementById('backupModal')?.classList.remove('open');
  let pendingDeleteBackups = [];
  let pendingRestoreBackup = '';
  let pendingRestoreFile = null;
  const closeDeleteBackupModal = () => {
    pendingDeleteBackups = [];
    document.getElementById('deleteBackupModal')?.classList.remove('open');
  };
  const openDeleteBackupModal = filenames => {
    pendingDeleteBackups = Array.isArray(filenames) ? filenames : [filenames];
    const filenameEl = document.getElementById('deleteBackupFilename');
    if (filenameEl) filenameEl.textContent = pendingDeleteBackups.length === 1
      ? pendingDeleteBackups[0]
      : `${pendingDeleteBackups.length} backups selected`;
    document.getElementById('deleteBackupModal')?.classList.add('open');
  };
  const closeRestoreBackupModal = () => {
    pendingRestoreBackup = '';
    pendingRestoreFile = null;
    document.getElementById('restoreBackupModal')?.classList.remove('open');
  };
  const openRestoreBackupModal = filename => {
    pendingRestoreBackup = filename;
    pendingRestoreFile = null;
    const filenameEl = document.getElementById('restoreBackupFilename');
    const description = document.getElementById('restoreBackupDescription');
    if (filenameEl) filenameEl.textContent = filename;
    if (description) description.textContent = 'Restoring this backup will replace the current trip data:';
    document.getElementById('restoreBackupModal')?.classList.add('open');
  };
  const openRestoreFileModal = file => {
    pendingRestoreBackup = '';
    pendingRestoreFile = file;
    const filenameEl = document.getElementById('restoreBackupFilename');
    const description = document.getElementById('restoreBackupDescription');
    if (filenameEl) filenameEl.textContent = file.name;
    if (description) description.textContent = 'Restoring this file will replace the current trip data:';
    document.getElementById('restoreBackupModal')?.classList.add('open');
  };
  const backupDate = date => date
    ? new Date(`${date}T00:00:00`).toLocaleDateString('ro-RO')
    : '';
  const backupPeriod = backup => {
    if (!backup.date_from) return 'Fără perioadă planificată';
    const period = backup.date_from === backup.date_to
      ? backupDate(backup.date_from)
      : `${backupDate(backup.date_from)} - ${backupDate(backup.date_to)}`;
    const undated = (backup.location_count || 0) - (backup.dated_location_count || 0);
    return `${period}${undated ? ` · ${undated} fără dată` : ''}`;
  };
  const updateBackupSelection = () => {
    const selected = document.querySelectorAll('[data-backup-select]:checked').length;
    const deleteButton = document.getElementById('deleteSelectedBackups');
    if (deleteButton) deleteButton.disabled = selected === 0;
    const all = document.querySelectorAll('[data-backup-select]:not(:disabled)');
    const selectAll = document.getElementById('selectAllBackups');
    if (selectAll) {
      selectAll.checked = all.length > 0 && selected === all.length;
      selectAll.indeterminate = selected > 0 && selected < all.length;
    }
  };
  const renderBackupList = backups => {
    const list = document.getElementById('backupList');
    if (!list) return;
    if (!backups.length) {
      list.innerHTML = '<div class="backup-empty">No backups available.</div>';
      return;
    }
    backups.sort((a, b) => new Date(b.created) - new Date(a.created));
    list.innerHTML = backups.map(backup => `
      <div class="backup-row${backup.protected ? ' backup-row-protected' : ''}">
        <input class="backup-select" type="checkbox" data-backup-select="${esc(backup.file)}"${backup.protected ? ' disabled title="Protected latest backup with records"' : ''}>
        <div class="backup-row-info">
          <div class="backup-row-name">${esc(backup.file)}${backup.protected ? '<span class="backup-protected">Protected</span>' : ''}</div>
          <div class="backup-row-meta">${new Date(backup.created).toLocaleString('ro-RO')} · ${formatBytes(backup.size)}</div>
          <div class="backup-row-period">${backupPeriod(backup)} · ${backup.location_count} înregistrări</div>
        </div>
        <div class="backup-row-actions">
          <a class="btn-secondary backup-action" href="/api/admin/backups/${encodeURIComponent(backup.file)}" download title="Download backup">Download</a>
          <button class="btn-primary backup-action" data-restore-backup="${esc(backup.file)}">Restore</button>
          <button class="btn-secondary backup-action backup-delete" data-delete-backup="${esc(backup.file)}" title="Delete backup"${backup.protected ? ' disabled' : ''}>Delete</button>
        </div>
      </div>`).join('');
    list.querySelectorAll('[data-restore-backup]').forEach(button => {
      button.addEventListener('click', () => restoreServerBackup(button.dataset.restoreBackup));
    });
    list.querySelectorAll('[data-delete-backup]').forEach(button => {
      button.addEventListener('click', () => openDeleteBackupModal(button.dataset.deleteBackup));
    });
    list.querySelectorAll('[data-backup-select]').forEach(checkbox => {
      checkbox.addEventListener('change', updateBackupSelection);
    });
    updateBackupSelection();
  };
  const showBackupList = async () => {
    const list = document.getElementById('backupList');
    if (list) list.innerHTML = '<div class="backup-empty">Loading backups…</div>';
    document.getElementById('backupModal')?.classList.add('open');
    try {
      const res = await fetch('/api/admin/backups');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load backups');
      renderBackupList(data.backups || []);
    } catch (e) {
      if (list) list.innerHTML = `<div class="backup-empty">${esc(e.message)}</div>`;
    }
  };
  const applyRestoredTrip = data => {
    state.trip = data.trip;
    state.unsaved = false;
    document.getElementById('unsavedDot')?.classList.remove('visible');
    const nameInput = document.getElementById('tripNameInput');
    if (nameInput) nameInput.value = state.trip.trip_name || '';
    updateDocumentTitle(state.trip.trip_name);
    renderCountryFilter(); renderMain(); renderStats(); renderSummary();
  };
  const restoreServerBackup = async filename => {
    try {
      const res = await fetch(`/api/admin/backups/${encodeURIComponent(filename)}/restore`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Restore failed');
      applyRestoredTrip(data);
      closeRestoreBackupModal();
      closeBackupModal();
      toast(data.automatic_backup
        ? `Restored ${state.trip.locations.length} locations. Safety backup created: ${data.automatic_backup}`
        : `Restored ${state.trip.locations.length} locations from backup.`, 'success');
    } catch (e) {
      toast('Restore failed: ' + e.message, 'error');
    }
  };
  const restoreUploadedFile = async file => {
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/admin/restore', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Restore failed');
      applyRestoredTrip(data);
      closeRestoreBackupModal();
      closeBackupModal();
      toast(data.automatic_backup
        ? `Restored ${state.trip.locations.length} locations. Safety backup created: ${data.automatic_backup}`
        : `Restored ${state.trip.locations.length} locations.`, 'success');
    } catch (e) {
      toast('Restore failed: ' + e.message, 'error');
    }
  };
  const deleteServerBackups = async filenames => {
    try {
      const res = await fetch('/api/admin/backups/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: filenames }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      closeDeleteBackupModal();
      toast(`Deleted ${filenames.length} backup${filenames.length !== 1 ? 's' : ''}.`, 'success');
      await showBackupList();
    } catch (e) {
      toast('Delete failed: ' + e.message, 'error');
    }
  };

  document.getElementById('backupBtn')?.addEventListener('click', () => {
    showBackupList();
  });
  document.getElementById('createBackupBtn')?.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/admin/backup', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Backup failed');
      toast(data.file ? `Backup created: ${data.file}` : 'Backup folder ready.', 'success');
      await showBackupList();
    } catch (e) {
      toast('Backup failed: ' + e.message, 'error');
    }
  });
  document.getElementById('selectAllBackups')?.addEventListener('change', e => {
    document.querySelectorAll('[data-backup-select]:not(:disabled)').forEach(checkbox => {
      checkbox.checked = e.target.checked;
    });
    updateBackupSelection();
  });
  document.getElementById('deleteSelectedBackups')?.addEventListener('click', () => {
    const filenames = [...document.querySelectorAll('[data-backup-select]:checked')].map(input => input.dataset.backupSelect);
    if (filenames.length) openDeleteBackupModal(filenames);
  });
  document.getElementById('closeBackupModal')?.addEventListener('click', closeBackupModal);
  document.getElementById('backupModal')?.addEventListener('click', e => {
    if (e.target.id === 'backupModal') closeBackupModal();
  });
  document.getElementById('closeDeleteBackupModal')?.addEventListener('click', closeDeleteBackupModal);
  document.getElementById('cancelDeleteBackup')?.addEventListener('click', closeDeleteBackupModal);
  document.getElementById('confirmDeleteBackup')?.addEventListener('click', () => {
    if (pendingDeleteBackups.length) deleteServerBackups(pendingDeleteBackups);
  });
  document.getElementById('deleteBackupModal')?.addEventListener('click', e => {
    if (e.target.id === 'deleteBackupModal') closeDeleteBackupModal();
  });
  document.getElementById('closeRestoreBackupModal')?.addEventListener('click', closeRestoreBackupModal);
  document.getElementById('cancelRestoreBackup')?.addEventListener('click', closeRestoreBackupModal);
  document.getElementById('confirmRestoreBackup')?.addEventListener('click', () => {
    if (pendingRestoreBackup) restoreServerBackup(pendingRestoreBackup);
    else if (pendingRestoreFile) restoreUploadedFile(pendingRestoreFile);
  });
  document.getElementById('restoreBackupModal')?.addEventListener('click', e => {
    if (e.target.id === 'restoreBackupModal') closeRestoreBackupModal();
  });
  document.getElementById('closeDeleteLocationModal')?.addEventListener('click', closeDeleteLocationModal);
  document.getElementById('cancelDeleteLocation')?.addEventListener('click', closeDeleteLocationModal);
  document.getElementById('confirmDeleteLocation')?.addEventListener('click', () => {
    if (pendingDeleteLocationId) {
      const id = pendingDeleteLocationId;
      closeDeleteLocationModal();
      deleteLocation(id);
    }
  });
  document.getElementById('deleteLocationModal')?.addEventListener('click', e => {
    if (e.target.id === 'deleteLocationModal') closeDeleteLocationModal();
  });
  const closeMapsDetailsModal = () => {
    pendingMapsDetails = null;
    document.getElementById('mapsDetailsModal')?.classList.remove('open');
  };
  document.getElementById('closeMapsDetailsModal')?.addEventListener('click', closeMapsDetailsModal);
  document.getElementById('cancelMapsDetails')?.addEventListener('click', closeMapsDetailsModal);
  document.getElementById('mapsDetailsModal')?.addEventListener('click', e => {
    if (e.target.id === 'mapsDetailsModal') closeMapsDetailsModal();
  });
  const closePdfViewer = () => {
    cancelPdfRenderTasks();
    clearTimeout(docViewer.renderDebounceTimer);
    const frame = document.getElementById('pdfViewerFrame');
    if (frame) frame.src = 'about:blank';
    const img = document.getElementById('imageViewerImg');
    if (img) {
      img.src = '';
      img.style.transform = '';
    }
    const container = document.getElementById('pdfViewerCanvasContainer');
    if (container) container.innerHTML = '';
    docViewer.pdfDoc = null;
    docViewer.locationId = null;
    docViewer.files = [];
    docViewer.zoom = 1.0;
    docViewer.renderedZoom = 1.0;
    docViewer.rotation = 0;
    docViewer.imgPanX = 0;
    docViewer.imgPanY = 0;
    document.getElementById('pdfViewerModal')?.classList.remove('open');
  };
  document.getElementById('closePdfViewer')?.addEventListener('click', closePdfViewer);
  document.getElementById('pdfViewerModal')?.addEventListener('click', e => {
    if (e.target.id === 'pdfViewerModal') closePdfViewer();
  });

  // Document & Image Viewer toolbar event listeners
  document.getElementById('docZoomIn')?.addEventListener('click', () => {
    docViewer.zoom = Math.min(Number((docViewer.zoom + 0.25).toFixed(2)), 4.0);
    updateViewerZoom();
  });
  document.getElementById('docZoomOut')?.addEventListener('click', () => {
    docViewer.zoom = Math.max(Number((docViewer.zoom - 0.25).toFixed(2)), 0.25);
    updateViewerZoom();
  });
  document.getElementById('docZoomFit')?.addEventListener('click', () => {
    docViewer.zoom = 1.0;
    docViewer.rotation = 0;
    docViewer.imgPanX = 0;
    docViewer.imgPanY = 0;
    updateViewerZoom();
  });
  document.getElementById('docRotateBtn')?.addEventListener('click', () => {
    docViewer.rotation = (docViewer.rotation + 90) % 360;
    updateViewerZoom();
  });

  // Stage Mouse Wheel Zoom (Ctrl+Wheel on PDF or wheel on image with focal point)
  const docStage = document.getElementById('docViewerStage');
  docStage?.addEventListener('wheel', (e) => {
    const meta = docViewer.files[docViewer.currentIndex] ? getFileMeta(docViewer.files[docViewer.currentIndex].name) : null;
    if (!meta || (!meta.isPdf && !meta.isImage)) return;
    if (e.ctrlKey || e.metaKey || meta.isImage) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.2 : -0.2;
      const oldZoom = docViewer.zoom || 1.0;
      const nextZoom = Math.min(Math.max(Number((oldZoom + delta).toFixed(2)), 0.25), 5.0);
      if (nextZoom === oldZoom) return;

      if (meta.isImage) {
        const imgContainer = document.getElementById('imageViewerContainer');
        if (imgContainer) {
          const rect = imgContainer.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          const fx = e.clientX - centerX;
          const fy = e.clientY - centerY;
          const currentPanX = docViewer.imgPanX || 0;
          const currentPanY = docViewer.imgPanY || 0;
          const zoomRatio = nextZoom / oldZoom;
          docViewer.imgPanX = fx - (fx - currentPanX) * zoomRatio;
          docViewer.imgPanY = fy - (fy - currentPanY) * zoomRatio;
          docViewer.zoom = nextZoom;
          updateViewerZoom();
        }
      } else if (meta.isPdf && docViewer.pdfDoc) {
        const pdfContainer = document.getElementById('pdfViewerCanvasContainer');
        if (pdfContainer && pdfContainer.style.display !== 'none') {
          const rect = pdfContainer.getBoundingClientRect();
          const fx = e.clientX - rect.left;
          const fy = e.clientY - rect.top;
          const s0x = pdfContainer.scrollLeft;
          const s0y = pdfContainer.scrollTop;
          const zoomRatio = nextZoom / oldZoom;
          docViewer.zoom = nextZoom;
          applyCanvasVisualZoom(nextZoom);
          pdfContainer.scrollLeft = (s0x + fx) * zoomRatio - fx;
          pdfContainer.scrollTop = (s0y + fy) * zoomRatio - fy;
          const zoomLevel = document.getElementById('docZoomLevel');
          if (zoomLevel) zoomLevel.textContent = `${Math.round(nextZoom * 100)}%`;
          clearTimeout(docViewer.renderDebounceTimer);
          docViewer.renderDebounceTimer = setTimeout(() => {
            if (docViewer.pdfDoc && pdfContainer.style.display !== 'none') {
              renderPdfDocPages(docViewer.pdfDoc, pdfContainer);
            }
          }, 150);
        }
      }
    }
  }, { passive: false });

  // Mobile 2-Finger Pinch to Zoom (Focal-point centered on fingers)
  let pinchStartDist = 0;
  let pinchStartZoom = 1.0;
  let pinchStartMidX = 0;
  let pinchStartMidY = 0;
  let pinchStartPanX = 0;
  let pinchStartPanY = 0;
  let pinchStartContentX = 0;
  let pinchStartContentY = 0;
  let ignoreSingleTouchUntil = 0;

  const getTouchMetrics = (touches) => {
    const t0 = touches[0];
    const t1 = touches[1];
    return {
      dist: Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY),
      midX: (t0.clientX + t1.clientX) / 2,
      midY: (t0.clientY + t1.clientY) / 2,
    };
  };

  const initPinch = (touches) => {
    docViewer.isPinchZooming = true;
    cancelPdfRenderTasks();
    clearTimeout(docViewer.renderDebounceTimer);
    const m = getTouchMetrics(touches);
    pinchStartDist = m.dist;
    pinchStartZoom = docViewer.zoom || 1.0;
    pinchStartMidX = m.midX;
    pinchStartMidY = m.midY;

    const meta = docViewer.files[docViewer.currentIndex] ? getFileMeta(docViewer.files[docViewer.currentIndex].name) : null;
    if (meta?.isPdf) {
      const pdfContainer = document.getElementById('pdfViewerCanvasContainer');
      if (pdfContainer) {
        const rect = pdfContainer.getBoundingClientRect();
        const pointerX = pinchStartMidX - rect.left;
        const pointerY = pinchStartMidY - rect.top;
        pinchStartContentX = pdfContainer.scrollLeft + pointerX;
        pinchStartContentY = pdfContainer.scrollTop + pointerY;
      }
    } else if (meta?.isImage) {
      pinchStartPanX = docViewer.imgPanX || 0;
      pinchStartPanY = docViewer.imgPanY || 0;
    }

    // Cancel single-finger pan immediately
    if (isImgPanning) {
      isImgPanning = false;
      imgViewerContainer?.classList.remove('is-panning');
      try { imgViewerContainer?.releasePointerCapture(panPointerId); } catch (_) { }
      panPointerId = null;
    }
  };

  docStage?.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      initPinch(e.touches);
      if (e.cancelable) e.preventDefault();
    }
  }, { passive: false });

  docStage?.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2) {
      if (e.cancelable) e.preventDefault();
      const m = getTouchMetrics(e.touches);

      if (!docViewer.isPinchZooming || pinchStartDist <= 5) {
        initPinch(e.touches);
        return;
      }

      const factor = m.dist / pinchStartDist;
      const targetZoom = Math.min(Math.max(Number((pinchStartZoom * factor).toFixed(3)), 0.25), 5.0);
      docViewer.zoom = targetZoom;

      const zoomLevel = document.getElementById('docZoomLevel');
      if (zoomLevel) zoomLevel.textContent = `${Math.round(targetZoom * 100)}%`;

      const meta = docViewer.files[docViewer.currentIndex] ? getFileMeta(docViewer.files[docViewer.currentIndex].name) : null;
      if (meta?.isPdf) {
        const pdfContainer = document.getElementById('pdfViewerCanvasContainer');
        if (pdfContainer && pdfContainer.style.display !== 'none') {
          applyCanvasVisualZoom(targetZoom);
          const rect = pdfContainer.getBoundingClientRect();
          const newPointerX = m.midX - rect.left;
          const newPointerY = m.midY - rect.top;
          const zoomFactor = targetZoom / pinchStartZoom;
          pdfContainer.scrollLeft = pinchStartContentX * zoomFactor - newPointerX;
          pdfContainer.scrollTop = pinchStartContentY * zoomFactor - newPointerY;
        }
      } else if (meta?.isImage) {
        const imgContainer = document.getElementById('imageViewerContainer');
        if (imgContainer && imgContainer.style.display !== 'none') {
          const rect = imgContainer.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          const f0x = pinchStartMidX - centerX;
          const f0y = pinchStartMidY - centerY;
          const f1x = m.midX - centerX;
          const f1y = m.midY - centerY;
          const zoomRatio = targetZoom / pinchStartZoom;
          docViewer.imgPanX = f1x - (f0x - pinchStartPanX) * zoomRatio;
          docViewer.imgPanY = f1y - (f0y - pinchStartPanY) * zoomRatio;

          const img = document.getElementById('imageViewerImg');
          if (img) {
            img.style.transition = 'none';
            img.style.transform = `translate(${docViewer.imgPanX}px, ${docViewer.imgPanY}px) scale(${docViewer.zoom}) rotate(${docViewer.rotation}deg)`;
          }
        }
      }
    } else if (docViewer.isPinchZooming || (e.touches.length === 1 && Date.now() < ignoreSingleTouchUntil)) {
      if (e.cancelable) e.preventDefault();
    }
  }, { passive: false });

  const endPinch = (e) => {
    if (!e.touches || e.touches.length < 2) {
      if (docViewer.isPinchZooming) {
        docViewer.isPinchZooming = false;
        pinchStartDist = 0;
        ignoreSingleTouchUntil = Date.now() + 350;
        if (docViewer.pdfDoc) {
          const container = document.getElementById('pdfViewerCanvasContainer');
          if (container && container.style.display !== 'none') {
            clearTimeout(docViewer.renderDebounceTimer);
            docViewer.renderDebounceTimer = setTimeout(() => {
              if (!docViewer.isPinchZooming && docViewer.pdfDoc) {
                renderPdfDocPages(docViewer.pdfDoc, container);
              }
            }, 500);
          }
        }
      }
    }
  };
  docStage?.addEventListener('touchend', endPinch, { passive: false });
  docStage?.addEventListener('touchcancel', endPinch, { passive: false });

  // Image Panning (Mouse Drag / Touch Drag)
  let isImgPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panStartImgX = 0;
  let panStartImgY = 0;
  let panPointerId = null;
  const imgViewerContainer = document.getElementById('imageViewerContainer');
  const imgViewerElement = document.getElementById('imageViewerImg');

  imgViewerContainer?.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (docViewer.isPinchZooming) return;
    const meta = docViewer.files[docViewer.currentIndex] ? getFileMeta(docViewer.files[docViewer.currentIndex].name) : null;
    if (!meta?.isImage) return;

    isImgPanning = true;
    panPointerId = e.pointerId;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panStartImgX = docViewer.imgPanX || 0;
    panStartImgY = docViewer.imgPanY || 0;

    imgViewerContainer.classList.add('is-panning');
    if (imgViewerElement) imgViewerElement.style.transition = 'none';
    try { imgViewerContainer.setPointerCapture(e.pointerId); } catch (_) { }
  });

  imgViewerContainer?.addEventListener('pointermove', (e) => {
    if (!isImgPanning || docViewer.isPinchZooming) return;
    if (panPointerId !== null && e.pointerId !== panPointerId) return;

    const dx = e.clientX - panStartX;
    const dy = e.clientY - panStartY;
    docViewer.imgPanX = panStartImgX + dx;
    docViewer.imgPanY = panStartImgY + dy;

    if (imgViewerElement) {
      imgViewerElement.style.transition = 'none';
      imgViewerElement.style.transform = `translate(${docViewer.imgPanX}px, ${docViewer.imgPanY}px) scale(${docViewer.zoom}) rotate(${docViewer.rotation}deg)`;
    }
  });

  const stopImgPan = (e) => {
    if (!isImgPanning) return;
    isImgPanning = false;
    imgViewerContainer?.classList.remove('is-panning');
    try { imgViewerContainer?.releasePointerCapture(panPointerId); } catch (_) { }
    panPointerId = null;
  };
  imgViewerContainer?.addEventListener('pointerup', stopImgPan);
  imgViewerContainer?.addEventListener('pointercancel', stopImgPan);

  // PDF Desktop Mouse Drag Pan
  let isPdfPanning = false;
  let pdfPanStartX = 0;
  let pdfPanStartY = 0;
  let pdfPanStartScrollLeft = 0;
  let pdfPanStartScrollTop = 0;
  let pdfPanPointerId = null;
  const pdfViewerCanvasContainer = document.getElementById('pdfViewerCanvasContainer');

  pdfViewerCanvasContainer?.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    if (pdfViewerCanvasContainer.scrollWidth > pdfViewerCanvasContainer.clientWidth || pdfViewerCanvasContainer.scrollHeight > pdfViewerCanvasContainer.clientHeight) {
      isPdfPanning = true;
      pdfPanPointerId = e.pointerId;
      pdfPanStartX = e.clientX;
      pdfPanStartY = e.clientY;
      pdfPanStartScrollLeft = pdfViewerCanvasContainer.scrollLeft;
      pdfPanStartScrollTop = pdfViewerCanvasContainer.scrollTop;
      pdfViewerCanvasContainer.style.cursor = 'grabbing';
      try { pdfViewerCanvasContainer.setPointerCapture(e.pointerId); } catch (_) { }
    }
  });

  pdfViewerCanvasContainer?.addEventListener('pointermove', (e) => {
    if (!isPdfPanning) return;
    if (pdfPanPointerId !== null && e.pointerId !== pdfPanPointerId) return;
    const dx = e.clientX - pdfPanStartX;
    const dy = e.clientY - pdfPanStartY;
    pdfViewerCanvasContainer.scrollLeft = pdfPanStartScrollLeft - dx;
    pdfViewerCanvasContainer.scrollTop = pdfPanStartScrollTop - dy;
  });

  const stopPdfPan = () => {
    if (!isPdfPanning) return;
    isPdfPanning = false;
    if (pdfViewerCanvasContainer) pdfViewerCanvasContainer.style.cursor = '';
    try { pdfViewerCanvasContainer?.releasePointerCapture(pdfPanPointerId); } catch (_) { }
    pdfPanPointerId = null;
  };
  pdfViewerCanvasContainer?.addEventListener('pointerup', stopPdfPan);
  pdfViewerCanvasContainer?.addEventListener('pointercancel', stopPdfPan);

  document.getElementById('pdfPrevPage')?.addEventListener('click', () => {
    scrollPdfToPage(docViewer.pdfPageNum - 1);
  });
  document.getElementById('pdfNextPage')?.addEventListener('click', () => {
    scrollPdfToPage(docViewer.pdfPageNum + 1);
  });
  document.getElementById('modalAddAttachmentBtn')?.addEventListener('click', () => {
    document.getElementById('modalAttachmentInput')?.click();
  });
  document.getElementById('modalAttachmentInput')?.addEventListener('change', async (e) => {
    const files = e.target.files;
    if (!files?.length || !docViewer.locationId) return;
    const locationId = docViewer.locationId;
    const newFileName = files[0].name;
    await uploadLocationAttachments(locationId, files);
    e.target.value = '';
    openDocumentViewer(locationId, newFileName);
  });
  document.getElementById('docOpenNewTabLink')?.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!docViewer.locationId || !docViewer.files[docViewer.currentIndex]) return;
    const file = docViewer.files[docViewer.currentIndex];
    const locId = docViewer.locationId;

    let token = '';
    try {
      const res = await fetch(`/api/locations/${encodeURIComponent(locId)}/attachments/${encodeURIComponent(file.name)}/view-token`);
      if (res.ok) {
        const d = await res.json();
        token = d.token || '';
      }
    } catch (_) { }

    const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';
    const viewerUrl = `/doc-viewer/${encodeURIComponent(locId)}/${encodeURIComponent(file.name)}${tokenParam}`;
    const fullViewerUrl = new URL(viewerUrl, window.location.origin).href;

    const isAndroid = /android/i.test(navigator.userAgent);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

    if (isAndroid && isStandalone) {
      // In Android Standalone PWA, launch external system browser via Android Intent
      const hostPath = fullViewerUrl.replace(/^https?:\/\//, '');
      const scheme = window.location.protocol.replace(':', '');
      const intentUrl = `intent://${hostPath}#Intent;scheme=${scheme};action=android.intent.action.VIEW;end;`;
      try {
        window.location.href = intentUrl;
        return;
      } catch (_) { }
    }

    const win = window.open(fullViewerUrl, '_blank');
    if (!win || win.closed || typeof win.closed === 'undefined') {
      window.location.href = fullViewerUrl;
    }
  });

  const openDocShareModal = (filename, locationName, shareUrl) => {
    const modal = document.getElementById('docShareModal');
    if (!modal) return;

    const fnEl = document.getElementById('docShareFilename');
    if (fnEl) fnEl.textContent = filename;
    const locEl = document.getElementById('docShareLocation');
    if (locEl) locEl.textContent = locationName || 'EuroTrip';

    const ext = filename.split('.').pop().toLowerCase();
    const iconEl = document.getElementById('docShareIcon');
    if (iconEl) {
      if (ext === 'pdf') iconEl.textContent = '📕';
      else if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'].includes(ext)) iconEl.textContent = '🖼️';
      else iconEl.textContent = '📄';
    }

    const waBtn = document.getElementById('docShareOptWhatsApp');
    if (waBtn) waBtn.href = `https://api.whatsapp.com/send?text=${encodeURIComponent('EuroTrip - ' + filename + ':\n' + shareUrl)}`;

    const tgBtn = document.getElementById('docShareOptTelegram');
    if (tgBtn) tgBtn.href = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(filename)}`;

    const emBtn = document.getElementById('docShareOptEmail');
    if (emBtn) emBtn.href = `mailto:?subject=${encodeURIComponent('Document: ' + filename)}&body=${encodeURIComponent('Vezi documentul atașat aici:\n' + shareUrl)}`;

    modal.style.display = 'flex';
  };

  const closeDocShareModal = () => {
    const modal = document.getElementById('docShareModal');
    if (modal) modal.style.display = 'none';
  };

  document.getElementById('closeDocShareModal')?.addEventListener('click', closeDocShareModal);
  document.getElementById('docShareModalBackdrop')?.addEventListener('click', closeDocShareModal);

  document.getElementById('docShareOptCopy')?.addEventListener('click', async () => {
    if (!docViewer.locationId || !docViewer.files[docViewer.currentIndex]) return;
    const filename = docViewer.files[docViewer.currentIndex].name;
    const locId = docViewer.locationId;
    const shareUrl = new URL(`/doc-viewer/${encodeURIComponent(locId)}/${encodeURIComponent(filename)}`, window.location.origin).href;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const input = document.createElement('input');
        input.value = shareUrl;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      }
      toast('Link copiat în clipboard!', 'success');
      closeDocShareModal();
    } catch (_) {
      toast('Nu s-a putut copia linkul.', 'error');
    }
  });

  document.getElementById('docShareOptDownload')?.addEventListener('click', (e) => {
    closeDocShareModal();
    handleAttachmentDownloadClick(e);
  });

  const shareCurrentDocument = async () => {
    if (!docViewer.locationId || !docViewer.files[docViewer.currentIndex]) {
      toast('Niciun document selectat.', 'error');
      return;
    }
    const file = docViewer.files[docViewer.currentIndex];
    const locId = docViewer.locationId;
    const filename = file.name;
    const shareBtn = document.getElementById('docShareBtn');
    if (shareBtn) shareBtn.style.opacity = '0.5';

    const loc = state.trip?.locations?.find(l => l.id === locId);
    const locationName = loc ? loc.name : '';
    const shareUrl = new URL(`/doc-viewer/${encodeURIComponent(locId)}/${encodeURIComponent(filename)}`, window.location.origin).href;

    const canNativeShare = typeof navigator.share === 'function';
    if (canNativeShare) {
      if (docViewer.cachedShareFile && navigator.canShare && navigator.canShare({ files: [docViewer.cachedShareFile] })) {
        try {
          await navigator.share({
            files: [docViewer.cachedShareFile],
            title: filename,
          });
          toast('Document partajat!', 'success');
          if (shareBtn) shareBtn.style.opacity = '';
          return;
        } catch (err) {
          if (err?.name === 'AbortError') {
            if (shareBtn) shareBtn.style.opacity = '';
            return;
          }
          console.warn('Native file share failed, trying URL share:', err);
        }
      }

      try {
        await navigator.share({
          title: filename,
          url: shareUrl,
        });
        if (shareBtn) shareBtn.style.opacity = '';
        return;
      } catch (err) {
        if (err?.name === 'AbortError') {
          if (shareBtn) shareBtn.style.opacity = '';
          return;
        }
        console.warn('Native URL share failed:', err);
      }
    }

    if (shareBtn) shareBtn.style.opacity = '';

    // If native share is unavailable (e.g. over HTTP on mobile LAN) or fails:
    // Open the custom Share Sheet with WhatsApp, Telegram, Email, Copy Link, Download!
    openDocShareModal(filename, locationName, shareUrl);
  };

  const handleAttachmentDownloadClick = async (e) => {
    e.preventDefault();
    if (!docViewer.locationId || !docViewer.files[docViewer.currentIndex]) return;
    const file = docViewer.files[docViewer.currentIndex];
    const locId = docViewer.locationId;
    const filename = file.name;

    const isAndroid = /android/i.test(navigator.userAgent);

    toast('Se pregătește descărcarea…', 'info');

    // 1. Android Standalone PWA intent fallback
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (isAndroid && isStandalone) {
      try {
        let token = '';
        try {
          const tokRes = await fetch(`/api/locations/${encodeURIComponent(locId)}/attachments/${encodeURIComponent(filename)}/view-token`);
          if (tokRes.ok) {
            const d = await tokRes.json();
            token = d.token || '';
          }
        } catch (_) { }
        const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
        const dlUrl = new URL(`/api/locations/${encodeURIComponent(locId)}/attachments/${encodeURIComponent(filename)}?download=1${tokenParam}`, window.location.origin).href;
        const hostPath = dlUrl.replace(/^https?:\/\//, '');
        const scheme = window.location.protocol.replace(':', '');
        const intentUrl = `intent://${hostPath}#Intent;scheme=${scheme};action=android.intent.action.VIEW;end;`;
        window.location.href = intentUrl;
        toast('Descărcare inițiată în browser…', 'success');
        return;
      } catch (intentErr) {
        console.warn('Intent download failed:', intentErr);
      }
    }

    // 2. Standard browser / Desktop / Mobile browser:
    try {
      const fileUrl = `/api/locations/${encodeURIComponent(locId)}/attachments/${encodeURIComponent(filename)}`;
      const res = await fetch(fileUrl, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const tempLink = document.createElement('a');
      tempLink.style.display = 'none';
      tempLink.href = blobUrl;
      tempLink.download = filename;
      document.body.appendChild(tempLink);
      tempLink.click();
      setTimeout(() => {
        document.body.removeChild(tempLink);
        URL.revokeObjectURL(blobUrl);
      }, 2000);
      toast('Fișier descărcat cu succes.', 'success');
    } catch (err) {
      // Fallback: direct navigation
      window.location.href = `/api/locations/${encodeURIComponent(locId)}/attachments/${encodeURIComponent(filename)}?download=1`;
    }
  };

  document.getElementById('docShareBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    shareCurrentDocument();
  });
  document.getElementById('pdfDownloadLink')?.addEventListener('click', handleAttachmentDownloadClick);
  document.getElementById('genericDocDownloadBtn')?.addEventListener('click', handleAttachmentDownloadClick);
  document.getElementById('modalDeleteAttachmentBtn')?.addEventListener('click', () => {
    if (!docViewer.locationId || !docViewer.files[docViewer.currentIndex]) return;
    openDeleteAttachmentModal(docViewer.locationId, docViewer.files[docViewer.currentIndex].name);
  });
  document.getElementById('closeDeleteAttachmentModal')?.addEventListener('click', closeDeleteAttachmentModal);
  document.getElementById('cancelDeleteAttachment')?.addEventListener('click', closeDeleteAttachmentModal);
  document.getElementById('confirmDeleteAttachment')?.addEventListener('click', async () => {
    if (!pendingDeleteAttachment) return;
    const { locationId, filename } = pendingDeleteAttachment;
    closeDeleteAttachmentModal();
    await performDeleteViewerAttachment(locationId, filename);
  });
  document.getElementById('deleteAttachmentModal')?.addEventListener('click', e => {
    if (e.target.id === 'deleteAttachmentModal') closeDeleteAttachmentModal();
  });
  document.getElementById('addMapsDetails')?.addEventListener('click', () => {
    if (!pendingMapsDetails) return;
    const { id, data } = pendingMapsDetails;
    const loc = state.trip.locations.find(item => item.id === id);
    const card = document.querySelector(`.location-card[data-id="${CSS.escape(id)}"]`);
    if (!loc || !card) return;
    const updates = {};
    if (data.name && loc.name === 'New Location') updates.name = data.name;
    if (data.info) updates.place_info = data.info;
    if (data.coordinates) updates.coordinates = data.coordinates;
    ['address', 'city', 'country', 'country_code', 'category'].forEach(field => {
      if (data[field]) updates[field] = data[field];
    });
    updateLocation(id, updates);
    Object.entries(updates).forEach(([field, value]) => {
      const input = card.querySelector(`[data-field="${field}"]`);
      if (input) input.value = value;
    });
    if (updates.place_info) {
      const info = document.createElement('div');
      info.className = 'place-info-text';
      info.textContent = updates.place_info;
      card.querySelector('.card-fields')?.before(info);
    }
    closeMapsDetailsModal();
    toast('Google Maps data added to the card.', 'success');
  });

  document.getElementById('restoreFileBtn')?.addEventListener('click', () => {
    document.getElementById('restoreFileInput')?.click();
  });
  document.getElementById('restoreFileInput')?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    openRestoreFileModal(file);
  });

  const closeClearAllModal = () => document.getElementById('clearAllModal')?.classList.remove('open');
  document.getElementById('clearAllBtn')?.addEventListener('click', () => {
    document.getElementById('clearAllModal')?.classList.add('open');
  });
  document.getElementById('closeClearAllModal')?.addEventListener('click', closeClearAllModal);
  document.getElementById('cancelClearAll')?.addEventListener('click', closeClearAllModal);
  document.getElementById('clearAllModal')?.addEventListener('click', e => {
    if (e.target.id === 'clearAllModal') closeClearAllModal();
  });
  document.getElementById('confirmClearAll')?.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/admin/delete-all', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      state.trip.locations = [];
      state.unsaved = false;
      document.getElementById('unsavedDot')?.classList.remove('visible');
      renderMain();
      renderStats();
      renderSummary();
      closeClearAllModal();
      toast(data.automatic_backup
        ? `All records deleted. Backup created: ${data.automatic_backup}`
        : 'All records deleted.', 'success');
    } catch (e) {
      toast('Delete failed: ' + e.message, 'error');
    }
  });

  // Ctrl/Cmd+S
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveAction(); }
  });

  // Upload modal
  const openUpload = (tab = 'file') => {
    document.getElementById('uploadModal')?.classList.add('open');
    switchModalTab(tab);
  };
  document.getElementById('uploadBtn')?.addEventListener('click', () => openUpload('file'));
  document.getElementById('mobileUpload')?.addEventListener('click', () => openUpload('file'));
  const closeUpload = () => {
    document.getElementById('uploadModal')?.classList.remove('open');
    resetUploadUI();
  };
  document.getElementById('closeModal')?.addEventListener('click', closeUpload);
  document.getElementById('uploadModal')?.addEventListener('click', e => {
    if (e.target.id === 'uploadModal') closeUpload();
  });

  // Upload modal tabs
  document.querySelectorAll('.modal-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchModalTab(tab.dataset.tab);
      document.getElementById('uploadPreview').style.display = 'none';
    });
  });

  // Auto-hide guide when user changes the URL
  document.getElementById('urlInput')?.addEventListener('input', () => {
    const guide = document.getElementById('gmapsGuide');
    if (guide) guide.style.display = 'none';
  });

  // File browse / drag-drop
  document.getElementById('browseBtn')?.addEventListener('click', () => document.getElementById('fileInput')?.click());
  document.getElementById('fileInput')?.addEventListener('change', e => {
    const f = e.target.files?.[0];
    if (f) handleFileUpload(f);
  });

  const dz = document.getElementById('dropzone');
  if (dz) {
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => {
      e.preventDefault(); dz.classList.remove('drag-over');
      const f = e.dataTransfer.files[0];
      if (f) handleFileUpload(f);
    });
    dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') document.getElementById('fileInput')?.click(); });
  }

  document.getElementById('confirmUploadBtn')?.addEventListener('click', confirmUpload);
  document.getElementById('cancelUploadBtn')?.addEventListener('click', resetUploadUI);

  // Fetch from URL
  document.getElementById('fetchUrlBtn')?.addEventListener('click', handleUrlFetch);
  document.getElementById('urlInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleUrlFetch();
  });

  // Card event delegation
  const mc = document.getElementById('mainContent');
  mc?.addEventListener('click', handleCardClick);
  mc?.addEventListener('change', handleCardChange);
  mc?.addEventListener('input', handleNameInput);
  mc?.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[data-action="toggleAddress"]')) {
      e.preventDefault();
      e.target.click();
    }
  });

  // PWA install
  document.getElementById('installBtn')?.addEventListener('click', async () => {
    if (state.installPrompt) {
      state.installPrompt.prompt();
      const { outcome } = await state.installPrompt.userChoice;
      if (outcome === 'accepted') {
        document.getElementById('installBtn').style.display = 'none';
        state.installPrompt = null;
      }
    }
  });

  // Galaxy Z Fold 6 fold/unfold screen transition & fullscreen map sync
  window.addEventListener('resize', () => {
    if (state.map) {
      state.map.invalidateSize({ pan: false });
    }
  });

  const onFullscreenChange = () => {
    const wrap = document.querySelector('.map-view-wrap');
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    if (!isFs) {
      if (state.view === 'map' && state.isMapFullscreen) {
        state.isMapFullscreen = false;
        savePrefs({ isMapFullscreen: false });
        updateMapFullscreenUrl(false);
        if (wrap) wrap.classList.remove('is-fullscreen');
        document.body.classList.remove('map-is-fullscreen');
        updateMapFullscreenButtons(false);
        if (state.map) setTimeout(() => state.map?.invalidateSize({ pan: false }), 100);
      }
    } else {
      state.isMapFullscreen = true;
      savePrefs({ isMapFullscreen: true });
      updateMapFullscreenUrl(true);
      if (wrap) wrap.classList.add('is-fullscreen');
      document.body.classList.add('map-is-fullscreen');
      updateMapFullscreenButtons(true);
      if (state.map) setTimeout(() => state.map?.invalidateSize({ pan: false }), 100);
    }
  };
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isMapFullscreenActive()) {
      exitMapFullscreen();
    }
  });

  // Browser Back/Forward navigation sync for map day & fullscreen in URL
  window.addEventListener('popstate', () => {
    const urlDay = getInitialMapDay();
    if (urlDay && urlDay !== state.mapDay) {
      state.mapDay = urlDay;
      savePrefs({ mapDay: urlDay });
      if (state.view === 'map') {
        renderMain();
      }
    }
    const urlFs = getInitialMapFullscreen();
    if (state.view === 'map' && urlFs !== state.isMapFullscreen) {
      if (urlFs) {
        toggleMapFullscreen();
      } else {
        exitMapFullscreen();
      }
    }
  });

  // Warn before unload with unsaved changes
  window.addEventListener('beforeunload', e => {
    if (state.unsaved) { e.preventDefault(); e.returnValue = ''; }
  });
}

function handleCardClick(e) {
  const actionEl = e.target.closest('[data-action], .confirmation-link');
  if (!actionEl) return;

  if (actionEl.dataset.action === 'openConfirmationDoc' || actionEl.classList.contains('confirmation-link')) {
    const webUrl = actionEl.dataset.canonicalUrl || actionEl.getAttribute('href');
    const pkgId = actionEl.dataset.packageId || extractPackageIdFromUrl(webUrl);
    const platform = detectPlatform();

    if (platform === 'android' && pkgId) {
      e.preventDefault();
      e.stopPropagation();
      launchConfirmationUrl(webUrl, pkgId);
      return;
    }

    // Normal link (not an app package link): open in new browser window/tab
    e.stopPropagation();
    if (actionEl.tagName && actionEl.tagName.toLowerCase() === 'a') {
      actionEl.setAttribute('target', '_blank');
      actionEl.setAttribute('rel', 'noopener noreferrer');
      // Do not preventDefault: let the browser naturally open the link in a new window/tab
    } else {
      e.preventDefault();
      launchConfirmationUrl(webUrl);
    }
    return;
  }

  if (actionEl.dataset.action === 'openDocLink' || actionEl.id === 'openAppBtn') {
    e.preventDefault();
    e.stopPropagation();
    const group = actionEl.closest('.doc-link-field-group');
    const input = group?.querySelector('[data-field="confirmation_url"]') || document.getElementById('docUrlInput');
    const rawUrl = input ? input.value : '';
    launchConfirmationUrl(rawUrl);
    return;
  }

  if (actionEl.dataset.action === 'goToCountry' || actionEl.classList.contains('country-badge')) {
    e.preventDefault();
    e.stopPropagation();
    const country = actionEl.dataset.country;
    if (country) navigateToCountry(country);
    return;
  }

  if (state.role !== 'admin' && ['edit', 'duplicate', 'delete'].includes(actionEl.dataset.action)) {
    return;
  }
  const card = actionEl.closest('[data-id]');
  if (!card) return;
  const id = card.dataset.id;

  if (actionEl.dataset.action === 'toggleAddress') {
    e.stopPropagation();
    const addrRow = card.querySelector('.card-address-row');
    if (addrRow) {
      const isCurrentlyOpen = !addrRow.classList.contains('is-closed') && addrRow.style.display !== 'none';
      if (isCurrentlyOpen) {
        addrRow.classList.remove('is-open');
        addrRow.classList.add('is-closed');
        addrRow.style.display = 'none';
        actionEl.classList.remove('address-expanded', 'is-open');
        actionEl.setAttribute('aria-expanded', 'false');
      } else {
        addrRow.classList.remove('is-closed');
        addrRow.classList.add('is-open');
        addrRow.style.display = 'flex';
        actionEl.classList.add('address-expanded', 'is-open');
        actionEl.setAttribute('aria-expanded', 'true');
      }
      scheduleEqualizeCardHeights();
    }
    return;
  }

  if (actionEl.dataset.action === 'navigateFromCurrent') {
    e.stopPropagation();
    const loc = state.trip?.locations.find(l => l.id === id);
    if (loc) openDirectNavigation(loc);
    return;
  }

  if (actionEl.dataset.action === 'edit') {
    const card = actionEl.closest('[data-id]');
    if (card) {
      const isEditing = card.classList.toggle('editing');
      actionEl.classList.toggle('active', isEditing);
      actionEl.title = isEditing ? 'Close edit' : 'Edit details';
      if (isEditing) {
        const nameField = card.querySelector('[data-field="name"]');
        if (nameField) {
          nameField.focus();
          nameField.select();
        }
      } else {
        const loc = state.trip?.locations.find(l => l.id === id);
        if (loc) updateCardSubcard(card, loc);
      }
    }
    return;
  }
  if (actionEl.dataset.action === 'markVisited') {
    const loc = state.trip?.locations.find(l => l.id === id);
    if (loc) {
      const newVisited = !loc.visited;
      updateLocation(id, { visited: newVisited });

      fetch('/api/visited', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, visited: newVisited }),
      })
        .then(res => res.ok ? res.json() : Promise.reject(new Error('Visit update failed')))
        .then(() => {
          state.unsaved = false;
          document.getElementById('unsavedDot')?.classList.remove('visible');
        })
        .catch(() => {
          toast('Could not save visited state.', 'error');
        });

      // Synchronize all cards, rows, and timeline items for this ID in the DOM
      document.querySelectorAll(`[data-id="${CSS.escape(id)}"]`).forEach(el => {
        el.classList.toggle('row-visited', newVisited);
        el.classList.toggle('is-visited', newVisited);
      });
      document.querySelectorAll(`[data-id="${CSS.escape(id)}"] [data-action="markVisited"]`).forEach(btn => {
        btn.classList.toggle('done-active', newVisited);
        btn.title = newVisited ? 'Marchează ca nefăcut' : 'Marchează ca făcut';
      });

      if (state.hideVisited || state.view === 'map' || state.view === 'route') {
        renderMain();
      }
      toast(newVisited ? 'Locație marcată ca făcută (Done).' : 'Locație reactivată.', 'info');
    }
    return;
  }
  if (actionEl.dataset.action === 'duplicate') duplicateLocation(id);
  if (actionEl.dataset.action === 'setDuration') {
    const dur = parseInt(actionEl.dataset.dur, 10);
    const card = actionEl.closest('[data-id]');
    if (card && dur) {
      const durInput = card.querySelector('[data-field="duration_minutes"]');
      if (durInput) {
        durInput.value = dur;
        durInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    return;
  }
  if (actionEl.dataset.action === 'toggleRouteExclude') {
    const loc = state.trip?.locations.find(l => l.id === id);
    if (!loc) return;
    const isCurrentlyExcluded = !!(loc.excluded || state.mapExcluded.has(id));
    const isExcluded = !isCurrentlyExcluded;
    loc.excluded = isExcluded;

    if (isExcluded) {
      state.mapExcluded.add(id);
    } else {
      state.mapExcluded.delete(id);
    }
    savePrefs({ mapExcluded: [...state.mapExcluded] });

    fetch('/api/excluded', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, excluded: isExcluded }),
    })
      .then(res => res.ok ? res.json() : Promise.reject(new Error('Exclude update failed')))
      .then(() => {
        state.unsaved = false;
        document.getElementById('unsavedDot')?.classList.remove('visible');
      })
      .catch(() => {
        // Preference is still saved locally in localStorage
      });

    document.querySelectorAll(`[data-id="${CSS.escape(id)}"] [data-action="toggleRouteExclude"]`).forEach(btn => {
      btn.classList.toggle('is-excluded', isExcluded);
      btn.title = isExcluded ? 'Include în traseu' : 'Exclude din traseu';
      btn.innerHTML = `<svg viewBox="0 0 24 24">${isExcluded ? '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>' : '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8 0-1.85.63-3.55 1.69-4.9L16.9 18.31C15.55 19.37 13.85 20 12 20zm6.31-3.1L7.1 5.69C8.45 4.63 10.15 4 12 4c4.42 0 8 3.58 8 8 0 1.85-.63 3.55-1.69 4.9z"/>'}</svg>`;
    });
    document.querySelectorAll(`[data-id="${CSS.escape(id)}"]`).forEach(el => {
      el.classList.toggle('card-excluded', isExcluded);
      el.classList.toggle('row-excluded', isExcluded);
      el.classList.toggle('is-excluded', isExcluded);
    });

    if (state.view === 'map' || state.view === 'route') {
      renderMain();
    }
    toast(isExcluded ? 'Locație exclusă din traseu și hartă.' : 'Locație inclusă în traseu și hartă.', 'info');
    return;
  }
  if (actionEl.dataset.action === 'fetchInfo') {
    const loc = state.trip.locations.find(l => l.id === id);
    if (!loc?.google_maps_url) return;
    actionEl.textContent = '⏳ Se caută…';
    actionEl.disabled = true;
    fetch('/api/place-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: loc.google_maps_url }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.info) {
          updateLocation(id, { place_info: data.info });
          actionEl.remove();
          const body = actionEl.closest('.card-body') || document.querySelector(`.location-card[data-id="${CSS.escape(id)}"] .card-body`);
          const strip = body?.querySelector('.card-info-strip');
          if (strip) {
            const div = document.createElement('div');
            div.className = 'place-info-text';
            div.textContent = data.info;
            strip.insertAdjacentElement('beforebegin', div);
          }
        } else {
          actionEl.textContent = '❌ Negăsit';
          actionEl.disabled = false;
        }
      })
      .catch(() => { actionEl.textContent = '❌ Eroare'; actionEl.disabled = false; });
  }
  if (actionEl.dataset.action === 'findMapsDetails') {
    openMapsDetailsModal(id, card, actionEl);
  }
  if (actionEl.dataset.action === 'addAttachment') {
    e.preventDefault();
    if (state.role !== 'admin') return;
    const locId = actionEl.dataset.id || actionEl.dataset.locId || id;
    if (!locId) return;
    docViewer.locationId = locId;
    const fileInput = document.getElementById('modalAttachmentInput');
    if (fileInput) {
      fileInput.value = '';
      fileInput.click();
    }
    return;
  }
  if (actionEl.dataset.action === 'viewAttachment') {
    e.preventDefault();
    const locId = actionEl.dataset.locationId || id;
    const fileName = actionEl.dataset.attachmentName;
    openDocumentViewer(locId, fileName);
    return;
  }
  if (actionEl.dataset.action === 'viewAttachments') {
    e.preventDefault();
    const locId = actionEl.dataset.id || id;
    openDocumentViewer(locId);
    return;
  }
  if (actionEl.dataset.action === 'delete') {
    openDeleteLocationModal(id);
  }
}

function autoFetchPlaceInfo(id, url, card) {
  if (!url || !/google\.[a-z.]+|goo\.gl/i.test(url)) return;
  const loc = state.trip.locations.find(item => item.id === id);
  if (!loc || loc.place_info || card.dataset.fetchingPlaceInfo === 'true') return;
  card.dataset.fetchingPlaceInfo = 'true';
  fetch('/api/place-info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
    .then(response => response.json())
    .then(data => {
      const updates = {};
      if (data.name && loc.name === 'New Location') updates.name = data.name;
      if (data.info) updates.place_info = data.info;
      if (data.coordinates) updates.coordinates = data.coordinates;
      ['address', 'city', 'country', 'country_code', 'category'].forEach(field => {
        if (data[field]) updates[field] = data[field];
      });
      if (!Object.keys(updates).length) return;
      updateLocation(id, updates);
      if (updates.name) {
        const nameField = card.querySelector('[data-field="name"]');
        if (nameField) nameField.value = updates.name;
        const nameText = card.querySelector('.card-name');
        if (nameText && !nameField) nameText.textContent = updates.name;
      }
      if (updates.place_info) {
        const info = document.createElement('div');
        info.className = 'place-info-text';
        info.textContent = updates.place_info;
        const fields = card.querySelector('.card-fields');
        if (fields) fields.before(info);
      }
    })
    .catch(() => { })
    .finally(() => { delete card.dataset.fetchingPlaceInfo; });
}

const docViewer = {
  locationId: null,
  files: [],
  currentIndex: 0,
  zoom: 1.0,
  renderedZoom: 1.0,
  rotation: 0,
  imgPanX: 0,
  imgPanY: 0,
  pdfDoc: null,
  pdfPageNum: 1,
  pdfTotalPages: 1,
  pdfRenderTasks: [],
  renderDebounceTimer: null,
  isLoading: false,
  isPinchZooming: false,
};

async function uploadLocationAttachments(locationId, files) {
  if (!files?.length) return;
  try {
    for (const file of files) {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch(`/api/locations/${encodeURIComponent(locationId)}/attachments`, { method: 'POST', body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Attachment upload failed');
      const location = state.trip?.locations.find(item => item.id === locationId);
      if (location) location.attachments = data.attachments;
    }
    renderMain();
    toast('Attachment(s) uploaded.', 'success');
  } catch (error) {
    toast('Attachment upload failed: ' + error.message, 'error');
  }
}

let pendingDeleteAttachment = null;

function openDeleteAttachmentModal(locationId, filename) {
  pendingDeleteAttachment = { locationId, filename };
  const nameEl = document.getElementById('deleteAttachmentFileName');
  if (nameEl) nameEl.textContent = `"${filename}"`;
  document.getElementById('deleteAttachmentModal')?.classList.add('open');
}

function closeDeleteAttachmentModal() {
  pendingDeleteAttachment = null;
  document.getElementById('deleteAttachmentModal')?.classList.remove('open');
}

async function performDeleteViewerAttachment(locationId, filename) {
  try {
    const response = await fetch(`/api/locations/${encodeURIComponent(locationId)}/attachments/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Delete failed');
    const location = state.trip?.locations.find(item => item.id === locationId);
    if (location) location.attachments = data.attachments;
    docViewer.files = data.attachments || [];
    docViewer.currentIndex = Math.max(0, Math.min(docViewer.currentIndex, docViewer.files.length - 1));
    renderMain();
    renderViewerTabs();
    if (docViewer.files.length > 0) {
      loadViewerAttachment(docViewer.currentIndex);
    } else {
      document.getElementById('pdfViewerModal')?.classList.remove('open');
    }
    toast('Attachment removed.', 'success');
  } catch (err) {
    toast('Could not delete attachment: ' + err.message, 'error');
  }
}

function openLocationAttachments(locationId) {
  openDocumentViewer(locationId);
}

function openDocumentViewer(locationId, initialFileName = null) {
  const location = state.trip?.locations.find(item => item.id === locationId);
  if (!location) return;
  const files = (location.attachments || []).slice().sort((a, b) => {
    const oa = (a && typeof a.order === 'number') ? a.order : 999999;
    const ob = (b && typeof b.order === 'number') ? b.order : 999999;
    return oa - ob;
  });

  docViewer.locationId = locationId;
  docViewer.files = [...files];

  let targetIndex = 0;
  if (initialFileName) {
    const found = docViewer.files.findIndex(f => f.name === initialFileName);
    if (found !== -1) targetIndex = found;
  }
  docViewer.currentIndex = targetIndex;
  docViewer.zoom = 1.0;
  docViewer.renderedZoom = 1.0;
  docViewer.rotation = 0;
  docViewer.imgPanX = 0;
  docViewer.imgPanY = 0;

  renderViewerTabs();

  const modal = document.getElementById('pdfViewerModal');
  if (modal) {
    modal.classList.add('open');
    document.getElementById('pdfViewerTitle').textContent = location.name ? `${location.name} · Documents` : 'Document Viewer';
    if (docViewer.files.length > 0) {
      loadViewerAttachment(docViewer.currentIndex);
    } else {
      showEmptyViewer();
    }
  }
}

function renderViewerTabs() {
  const list = document.getElementById('pdfAttachmentList');
  if (!list) return;
  if (!docViewer.files.length) {
    list.innerHTML = '<span style="font-size:0.75rem; color:var(--text-muted); padding:4px 0;">No documents attached yet. Click "+ Add File" above.</span>';
    return;
  }
  list.innerHTML = docViewer.files.map((file, index) => {
    const meta = getFileMeta(file.name);
    return `<button class="pdf-attachment-item${index === docViewer.currentIndex ? ' active' : ''}" type="button" data-file-index="${index}" data-filename="${esc(file.name)}" title="${esc(file.name)}">${meta.icon} <span>${esc(file.name)}</span></button>`;
  }).join('');

  setupAttachmentTabReorder(list);

  // Keep active tab visible in horizontal scroll
  const activeBtn = list.querySelector('.pdf-attachment-item.active');
  if (activeBtn) {
    try {
      activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    } catch (_) { }
  }
}

function setupAttachmentTabReorder(list) {
  const items = list.querySelectorAll('.pdf-attachment-item');
  if (items.length <= 1) {
    items.forEach(button => {
      button.addEventListener('contextmenu', e => e.preventDefault());
      button.addEventListener('click', () => {
        const idx = Number(button.dataset.fileIndex);
        if (idx !== docViewer.currentIndex) {
          docViewer.currentIndex = idx;
          docViewer.zoom = 1.0;
          docViewer.renderedZoom = 1.0;
          docViewer.rotation = 0;
          docViewer.imgPanX = 0;
          docViewer.imgPanY = 0;
          renderViewerTabs();
          loadViewerAttachment(idx);
        }
      });
    });
    return;
  }

  let activeItem = null;
  let isDragging = false;
  let isScrolling = false;
  let justFinishedDrag = false;
  let justFinishedScroll = false;
  let holdTimer = null;
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let currentY = 0;
  let startScrollLeft = 0;
  let startIndex = -1;
  let targetIndex = -1;
  let itemGeom = [];
  let autoScrollRaf = null;
  let momentumRaf = null;
  let activePointerId = null;
  let didMoveFar = false;
  let lastMoveTime = 0;
  let lastMoveX = 0;
  let scrollVelocity = 0;

  const cancelHold = () => {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
  };

  const stopMomentum = () => {
    if (momentumRaf) {
      cancelAnimationFrame(momentumRaf);
      momentumRaf = null;
    }
  };

  const stopAutoScroll = () => {
    if (autoScrollRaf) {
      cancelAnimationFrame(autoScrollRaf);
      autoScrollRaf = null;
    }
  };

  const updatePositions = () => {
    if (!isDragging || !activeItem || startIndex < 0 || !itemGeom.length) return;

    const dx = currentX - startX;
    activeItem.style.transform = `translate3d(${dx}px, -3px, 0) scale(1.05)`;

    const scrollDelta = list.scrollLeft - startScrollLeft;
    const contentDeltaX = dx + scrollDelta;
    const draggedCurrentCenter = itemGeom[startIndex].contentCenter + contentDeltaX;

    let newTargetIndex = startIndex;
    if (contentDeltaX > 0) {
      for (let i = startIndex + 1; i < itemGeom.length; i++) {
        if (draggedCurrentCenter > itemGeom[i].contentCenter) {
          newTargetIndex = i;
        }
      }
    } else if (contentDeltaX < 0) {
      for (let i = startIndex - 1; i >= 0; i--) {
        if (draggedCurrentCenter < itemGeom[i].contentCenter) {
          newTargetIndex = i;
        }
      }
    }

    targetIndex = newTargetIndex;
    const slotWidth = itemGeom[startIndex].width + 6;

    itemGeom.forEach(pos => {
      if (pos.index === startIndex) return;
      let shiftX = 0;
      if (startIndex < targetIndex) {
        if (pos.index > startIndex && pos.index <= targetIndex) {
          shiftX = -slotWidth;
        }
      } else if (startIndex > targetIndex) {
        if (pos.index >= targetIndex && pos.index < startIndex) {
          shiftX = slotWidth;
        }
      }
      pos.el.style.transform = shiftX !== 0 ? `translate3d(${shiftX}px, 0, 0)` : '';
      pos.el.style.transition = 'transform 0.18s cubic-bezier(0.2, 0, 0, 1)';
    });
  };

  const startAutoScroll = () => {
    if (autoScrollRaf) return;
    const tick = () => {
      if (!isDragging) {
        autoScrollRaf = null;
        return;
      }
      const listRect = list.getBoundingClientRect();
      const edgeZone = 44;
      const maxSpeed = 10;
      let scrolled = false;

      if (currentX < listRect.left + edgeZone && list.scrollLeft > 0) {
        const ratio = 1 - Math.max(0, currentX - listRect.left) / edgeZone;
        list.scrollLeft -= Math.ceil(maxSpeed * ratio);
        scrolled = true;
      } else if (currentX > listRect.right - edgeZone && list.scrollLeft < list.scrollWidth - list.clientWidth) {
        const ratio = 1 - Math.max(0, listRect.right - currentX) / edgeZone;
        list.scrollLeft += Math.ceil(maxSpeed * ratio);
        scrolled = true;
      }

      if (scrolled) {
        updatePositions();
      }
      autoScrollRaf = requestAnimationFrame(tick);
    };
    autoScrollRaf = requestAnimationFrame(tick);
  };

  const startDrag = (event) => {
    if (isDragging || !activeItem) return;
    isDragging = true;
    isScrolling = false;

    try { navigator.vibrate?.(40); } catch (_) { }
    try { activeItem.setPointerCapture(activePointerId); } catch (_) { }

    list.classList.add('tabs-reordering');
    activeItem.classList.add('is-dragging');

    startScrollLeft = list.scrollLeft;
    const allButtons = [...list.querySelectorAll('.pdf-attachment-item')];
    startIndex = allButtons.indexOf(activeItem);
    targetIndex = startIndex;
    itemGeom = allButtons.map((btn, idx) => {
      const rect = btn.getBoundingClientRect();
      return {
        el: btn,
        index: idx,
        width: rect.width,
        contentCenter: rect.left + startScrollLeft + rect.width / 2,
      };
    });

    startAutoScroll();
    updatePositions();
  };

  items.forEach(button => {
    // Prevent context menu on touch devices
    button.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    button.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.isPrimary === false) return;

      cancelHold();
      stopMomentum();
      stopAutoScroll();

      activeItem = button;
      activePointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      currentX = e.clientX;
      currentY = e.clientY;
      startScrollLeft = list.scrollLeft;
      didMoveFar = false;
      isDragging = false;
      isScrolling = false;
      lastMoveTime = Date.now();
      lastMoveX = e.clientX;
      scrollVelocity = 0;

      const isTouch = e.pointerType === 'touch';
      // 220ms hold threshold for reorder activation
      const holdDelay = isTouch ? 220 : 200;
      // Allow slight finger wobble on mobile without canceling hold gesture (16px vs 6px)
      const holdSlop = isTouch ? 16 : 6;

      holdTimer = setTimeout(() => {
        holdTimer = null;
        startDrag(e);
      }, holdDelay);

      const onPointerMove = (moveEvent) => {
        if (moveEvent.pointerId !== activePointerId) return;
        currentX = moveEvent.clientX;
        currentY = moveEvent.clientY;
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        const dist = Math.hypot(dx, dy);

        // Velocity tracking for horizontal inertia scroll
        const now = Date.now();
        const dt = now - lastMoveTime || 16;
        if (dt > 0) {
          const instV = (moveEvent.clientX - lastMoveX) / dt;
          scrollVelocity = scrollVelocity * 0.4 + instV * 0.6;
          lastMoveX = moveEvent.clientX;
          lastMoveTime = now;
        }

        if (!isDragging) {
          if (!isScrolling) {
            if (dist > holdSlop) {
              didMoveFar = true;
              if (isTouch) {
                // User swiped quickly before hold timer -> horizontal scroll tabs
                cancelHold();
                isScrolling = true;
                list.scrollLeft = startScrollLeft - dx;
              } else {
                // Desktop mouse -> start drag immediately on movement
                cancelHold();
                startDrag(moveEvent);
              }
            }
          } else {
            // Actively scrolling horizontally
            if (moveEvent.cancelable) moveEvent.preventDefault();
            list.scrollLeft = startScrollLeft - dx;
          }
        }

        if (isDragging) {
          if (moveEvent.cancelable) moveEvent.preventDefault();
          updatePositions();
        }
      };

      const onPointerUp = async (upEvent) => {
        if (upEvent.pointerId !== activePointerId) return;
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerCancel);

        cancelHold();
        stopAutoScroll();

        if (isDragging) {
          isDragging = false;
          justFinishedDrag = true;
          setTimeout(() => { justFinishedDrag = false; }, 250);

          try { activeItem?.releasePointerCapture(activePointerId); } catch (_) { }
          list.classList.remove('tabs-reordering');
          activeItem?.classList.remove('is-dragging');

          if (activeItem) {
            activeItem.style.transform = '';
            activeItem.style.transition = '';
          }

          itemGeom.forEach(pos => {
            pos.el.style.transform = '';
            pos.el.style.transition = '';
          });

          const finalTarget = targetIndex;
          const finalStart = startIndex;
          activeItem = null;
          startIndex = -1;
          targetIndex = -1;

          if (finalTarget !== -1 && finalStart !== -1 && finalTarget !== finalStart) {
            const activeName = docViewer.files[docViewer.currentIndex]?.name;
            const moved = docViewer.files.splice(finalStart, 1)[0];
            docViewer.files.splice(finalTarget, 0, moved);

            docViewer.files.forEach((f, idx) => {
              f.order = idx + 1;
            });

            const newActive = docViewer.files.findIndex(f => f.name === activeName);
            docViewer.currentIndex = newActive !== -1 ? newActive : 0;

            const location = state.trip?.locations.find(item => item.id === docViewer.locationId);
            if (location) {
              location.attachments = docViewer.files.map((f, idx) => ({ ...f, order: idx + 1 }));
            }

            renderViewerTabs();

            if (docViewer.locationId) {
              try {
                const response = await fetch(`/api/locations/${encodeURIComponent(docViewer.locationId)}/attachments/reorder`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ order: docViewer.files.map(f => f.name) }),
                });
                const resData = await response.json();
                if (resData.status === 'ok' && Array.isArray(resData.attachments)) {
                  if (location) location.attachments = resData.attachments;
                  docViewer.files = [...resData.attachments];
                }
              } catch (err) {
                console.warn('Could not persist attachment order:', err);
              }
            }

            renderMain();
            toast('Ordinea documentelor a fost actualizată.', 'success');
          }
        } else if (isScrolling) {
          // Swiped to scroll tabs list
          isScrolling = false;
          justFinishedScroll = true;
          setTimeout(() => { justFinishedScroll = false; }, 250);

          activeItem = null;
          startIndex = -1;
          targetIndex = -1;

          // Momentum coasting
          if (Math.abs(scrollVelocity) > 0.15) {
            let v = scrollVelocity * 14;
            const momentumStep = () => {
              if (Math.abs(v) < 0.4) {
                momentumRaf = null;
                return;
              }
              list.scrollLeft -= v;
              v *= 0.90;
              momentumRaf = requestAnimationFrame(momentumStep);
            };
            momentumRaf = requestAnimationFrame(momentumStep);
          }
        } else {
          // Clean tap on tab (no drag, no swipe scroll)
          activeItem = null;
          startIndex = -1;
          targetIndex = -1;

          if (!didMoveFar) {
            const idx = Number(button.dataset.fileIndex);
            if (idx !== docViewer.currentIndex) {
              docViewer.currentIndex = idx;
              docViewer.zoom = 1.0;
              docViewer.renderedZoom = 1.0;
              docViewer.rotation = 0;
              docViewer.imgPanX = 0;
              docViewer.imgPanY = 0;
              renderViewerTabs();
              loadViewerAttachment(idx);
            }
          }
        }
      };

      const onPointerCancel = (cancelEvent) => {
        if (cancelEvent.pointerId !== activePointerId) return;
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerCancel);

        cancelHold();
        stopAutoScroll();
        stopMomentum();

        if (isDragging) {
          isDragging = false;
          justFinishedDrag = true;
          setTimeout(() => { justFinishedDrag = false; }, 250);

          try { activeItem?.releasePointerCapture(activePointerId); } catch (_) { }
          list.classList.remove('tabs-reordering');
          activeItem?.classList.remove('is-dragging');

          if (activeItem) {
            activeItem.style.transform = '';
            activeItem.style.transition = '';
          }

          itemGeom.forEach(pos => {
            pos.el.style.transform = '';
            pos.el.style.transition = '';
          });
        }

        isScrolling = false;
        activeItem = null;
        startIndex = -1;
        targetIndex = -1;
      };

      window.addEventListener('pointermove', onPointerMove, { passive: false });
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerCancel);
    });

    button.addEventListener('click', (e) => {
      // Keyboard interaction (Enter/Space on focused button)
      if (e.detail === 0 && !justFinishedDrag && !justFinishedScroll) {
        const idx = Number(button.dataset.fileIndex);
        if (idx !== docViewer.currentIndex) {
          docViewer.currentIndex = idx;
          docViewer.zoom = 1.0;
          docViewer.renderedZoom = 1.0;
          docViewer.rotation = 0;
          docViewer.imgPanX = 0;
          docViewer.imgPanY = 0;
          renderViewerTabs();
          loadViewerAttachment(idx);
        }
      }
      e.preventDefault();
    });
  });
}

function showEmptyViewer() {
  const subtitle = document.getElementById('docViewerSubtitle');
  if (subtitle) subtitle.textContent = 'No files';
  const pdfControls = document.getElementById('pdfPageControls');
  const rotateBtn = document.getElementById('docRotateBtn');
  const zoomControls = document.getElementById('docZoomControls');
  const downloadLink = document.getElementById('pdfDownloadLink');
  const openNewTabLink = document.getElementById('docOpenNewTabLink');
  const deleteBtn = document.getElementById('modalDeleteAttachmentBtn');
  const genericContainer = document.getElementById('genericDocContainer');

  if (pdfControls) pdfControls.style.display = 'none';
  if (rotateBtn) rotateBtn.style.display = 'none';
  if (zoomControls) zoomControls.style.display = 'none';
  if (downloadLink) downloadLink.style.display = 'none';
  const shareBtn = document.getElementById('docShareBtn');
  if (shareBtn) shareBtn.style.display = 'none';
  if (openNewTabLink) openNewTabLink.style.display = 'none';
  if (deleteBtn) deleteBtn.style.display = 'none';

  document.getElementById('pdfViewerCanvasContainer').style.display = 'none';
  document.getElementById('imageViewerContainer').style.display = 'none';
  document.getElementById('pdfViewerFrame').style.display = 'none';

  if (genericContainer) {
    genericContainer.style.display = 'flex';
    document.getElementById('genericDocIcon').textContent = '📁';
    document.getElementById('genericDocName').textContent = 'No Attachments';
    document.getElementById('genericDocSize').textContent = '';
    const notice = genericContainer.querySelector('.generic-doc-notice');
    if (notice) notice.textContent = 'Click "+ Add File" in the header or button below to upload JPG, PNG, or PDF files.';
    const genBtn = document.getElementById('genericDocDownloadBtn');
    if (genBtn) genBtn.style.display = 'none';
    let emptyAddBtn = document.getElementById('genericDocEmptyAddBtn');
    if (state.role === 'admin') {
      if (!emptyAddBtn) {
        emptyAddBtn = document.createElement('button');
        emptyAddBtn.id = 'genericDocEmptyAddBtn';
        emptyAddBtn.className = 'btn-primary';
        emptyAddBtn.type = 'button';
        emptyAddBtn.style.marginTop = '12px';
        emptyAddBtn.textContent = '+ Add Files';
        emptyAddBtn.addEventListener('click', () => {
          document.getElementById('modalAttachmentInput')?.click();
        });
        genericContainer.querySelector('.generic-doc-card')?.appendChild(emptyAddBtn);
      } else {
        emptyAddBtn.style.display = 'inline-flex';
      }
    } else if (emptyAddBtn) {
      emptyAddBtn.style.display = 'none';
    }
  }
}

async function loadViewerAttachment(index) {
  const file = docViewer.files[index];
  if (!file) return;

  const locationId = docViewer.locationId;
  const fileUrl = `/api/locations/${encodeURIComponent(locationId)}/attachments/${encodeURIComponent(file.name)}`;
  const meta = getFileMeta(file.name);

  // Subtitle
  const subtitle = document.getElementById('docViewerSubtitle');
  if (subtitle) subtitle.textContent = `${file.name} ${file.size ? `(${formatFileSize(file.size)})` : ''}`;

  // Download, Share & Open in New Tab links
  const downloadLink = document.getElementById('pdfDownloadLink');
  if (downloadLink) {
    downloadLink.style.display = 'inline-flex';
    downloadLink.href = `${fileUrl}?download=1`;
    downloadLink.download = file.name;
  }
  const shareBtn = document.getElementById('docShareBtn');
  if (shareBtn) {
    shareBtn.style.display = 'inline-flex';
  }
  const openNewTabLink = document.getElementById('docOpenNewTabLink');
  if (openNewTabLink) {
    openNewTabLink.style.display = 'inline-flex';
    openNewTabLink.href = `/doc-viewer/${encodeURIComponent(locationId)}/${encodeURIComponent(file.name)}`;
  }

  const emptyAddBtn = document.getElementById('genericDocEmptyAddBtn');
  if (emptyAddBtn) emptyAddBtn.style.display = 'none';

  // Delete button (visible only to admin)
  const deleteBtn = document.getElementById('modalDeleteAttachmentBtn');
  if (deleteBtn) {
    deleteBtn.style.display = state.role === 'admin' ? 'inline-flex' : 'none';
  }

  // Controls visibility
  const pdfControls = document.getElementById('pdfPageControls');
  const rotateBtn = document.getElementById('docRotateBtn');
  const zoomControls = document.getElementById('docZoomControls');
  const zoomLevel = document.getElementById('docZoomLevel');

  // Containers
  const pdfContainer = document.getElementById('pdfViewerCanvasContainer');
  const imgContainer = document.getElementById('imageViewerContainer');
  const genericContainer = document.getElementById('genericDocContainer');
  const fallbackFrame = document.getElementById('pdfViewerFrame');
  const loadingEl = document.getElementById('docViewerLoading');

  if (pdfContainer) { pdfContainer.style.display = 'none'; pdfContainer.innerHTML = ''; }
  if (imgContainer) imgContainer.style.display = 'none';
  if (genericContainer) genericContainer.style.display = 'none';
  if (fallbackFrame) { fallbackFrame.style.display = 'none'; fallbackFrame.src = 'about:blank'; }
  if (pdfControls) pdfControls.style.display = 'none';
  if (rotateBtn) rotateBtn.style.display = 'none';
  if (zoomControls) zoomControls.style.display = 'inline-flex';
  if (zoomLevel) zoomLevel.textContent = '100%';

  // Cancel any ongoing PDF rendering or debounce
  cancelPdfRenderTasks();
  clearTimeout(docViewer.renderDebounceTimer);
  docViewer.zoom = 1.0;
  docViewer.renderedZoom = 1.0;
  docViewer.rotation = 0;
  docViewer.imgPanX = 0;
  docViewer.imgPanY = 0;

  docViewer.cachedShareFile = null;
  (async () => {
    try {
      const res = await fetch(fileUrl, { credentials: 'same-origin' });
      if (!res.ok) return;
      const blob = await res.blob();
      const ext = file.name.split('.').pop().toLowerCase();
      let mimeType = blob.type;
      if (!mimeType || mimeType === 'application/octet-stream') {
        if (ext === 'pdf') mimeType = 'application/pdf';
        else if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
        else if (ext === 'png') mimeType = 'image/png';
        else if (ext === 'webp') mimeType = 'image/webp';
      }
      docViewer.cachedShareFile = new File([blob], file.name, { type: mimeType });
    } catch (_) { }
  })();

  if (meta.isImage) {
    if (rotateBtn) rotateBtn.style.display = 'inline-flex';
    if (imgContainer) {
      imgContainer.style.display = 'flex';
      const img = document.getElementById('imageViewerImg');
      if (img) {
        if (loadingEl) loadingEl.style.display = 'flex';
        img.onload = () => { if (loadingEl) loadingEl.style.display = 'none'; };
        img.onerror = () => { if (loadingEl) loadingEl.style.display = 'none'; };
        img.src = fileUrl;
        img.style.transform = `translate(0px, 0px) scale(${docViewer.zoom}) rotate(${docViewer.rotation}deg)`;
      }
    }
  } else if (meta.isPdf) {
    if (loadingEl) loadingEl.style.display = 'flex';
    if (pdfControls) pdfControls.style.display = 'inline-flex';
    if (pdfContainer) pdfContainer.style.display = 'flex';

    if (window.pdfjsLib) {
      try {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        const loadingTask = window.pdfjsLib.getDocument({
          url: fileUrl,
          cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
          cMapPacked: true,
        });
        const pdfDoc = await loadingTask.promise;
        docViewer.pdfDoc = pdfDoc;
        docViewer.pdfTotalPages = pdfDoc.numPages;
        docViewer.pdfPageNum = 1;
        updatePdfPageIndicator();
        await renderPdfDocPages(pdfDoc, pdfContainer);
      } catch (pdfErr) {
        console.warn('PDF.js failed, falling back to iframe/direct:', pdfErr);
        if (pdfContainer) pdfContainer.style.display = 'none';
        if (pdfControls) pdfControls.style.display = 'none';
        if (zoomControls) zoomControls.style.display = 'none';
        if (fallbackFrame) {
          fallbackFrame.style.display = 'block';
          fallbackFrame.src = fileUrl;
        }
      } finally {
        if (loadingEl) loadingEl.style.display = 'none';
      }
    } else {
      if (loadingEl) loadingEl.style.display = 'none';
      if (pdfControls) pdfControls.style.display = 'none';
      if (zoomControls) zoomControls.style.display = 'none';
      if (fallbackFrame) {
        fallbackFrame.style.display = 'block';
        fallbackFrame.src = fileUrl;
      }
    }
  } else {
    // Generic file type
    if (zoomControls) zoomControls.style.display = 'none';
    if (genericContainer) {
      genericContainer.style.display = 'flex';
      document.getElementById('genericDocIcon').textContent = meta.icon;
      document.getElementById('genericDocName').textContent = file.name;
      document.getElementById('genericDocSize').textContent = file.size ? formatFileSize(file.size) : '';
      const notice = genericContainer.querySelector('.generic-doc-notice');
      if (notice) notice.textContent = 'Preview is not supported in browser for this file type.';
      const genBtn = document.getElementById('genericDocDownloadBtn');
      if (genBtn) {
        genBtn.style.display = 'inline-flex';
        genBtn.href = `${fileUrl}?download=1`;
        genBtn.download = file.name;
      }
    }
  }
}

function cancelPdfRenderTasks() {
  docViewer.renderGeneration = (docViewer.renderGeneration || 0) + 1;
  if (docViewer.pdfRenderTasks && docViewer.pdfRenderTasks.length) {
    docViewer.pdfRenderTasks.forEach(task => {
      try { task.cancel(); } catch (e) { }
    });
    docViewer.pdfRenderTasks = [];
  }
}

async function renderPdfDocPages(pdfDoc, container) {
  if (docViewer.isPinchZooming) return;
  cancelPdfRenderTasks();
  const myGen = ++docViewer.renderGeneration;
  const numPages = pdfDoc.numPages;
  const dpr = window.devicePixelRatio || 1;
  const baseScale = docViewer.zoom || 1.0;
  docViewer.renderedZoom = baseScale;

  const existingWrappers = container.querySelectorAll('.pdf-page-wrapper');
  const needsDomCreation = existingWrappers.length !== numPages;

  if (needsDomCreation) {
    container.innerHTML = '';
  }

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    if (docViewer.isPinchZooming || myGen !== docViewer.renderGeneration) break;
    const page = await pdfDoc.getPage(pageNum);
    if (docViewer.isPinchZooming || myGen !== docViewer.renderGeneration) break;

    let wrapper = document.getElementById(`pdfPageWrap_${pageNum}`);
    let canvas = null;

    if (!wrapper || needsDomCreation) {
      wrapper = document.createElement('div');
      wrapper.className = 'pdf-page-wrapper';
      wrapper.id = `pdfPageWrap_${pageNum}`;

      canvas = document.createElement('canvas');
      canvas.className = 'pdf-page-canvas';
      canvas.dataset.pageNum = pageNum;
      wrapper.appendChild(canvas);

      if (numPages > 1) {
        const badge = document.createElement('div');
        badge.className = 'pdf-page-num-badge';
        badge.textContent = `Page ${pageNum} of ${numPages}`;
        wrapper.appendChild(badge);
      }
      container.appendChild(wrapper);
    } else {
      canvas = wrapper.querySelector('canvas');
    }

    const containerWidth = Math.max(280, (container.clientWidth || window.innerWidth) - 24);
    const unscaledViewport = page.getViewport({ scale: 1.0 });
    const fitScale = Math.min(4.0, (containerWidth - 8) / unscaledViewport.width);
    const scale = Math.max(0.2, fitScale * baseScale);
    const viewport = page.getViewport({ scale: scale * dpr });

    const cssWidth = Math.round(viewport.width / dpr);
    const cssHeight = Math.round(viewport.height / dpr);
    wrapper.style.width = `${cssWidth}px`;
    wrapper.style.minHeight = `${cssHeight}px`;

    // Offscreen render to avoid flashing / white screen jitter
    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = Math.round(viewport.width);
    offscreenCanvas.height = Math.round(viewport.height);
    const ctx = offscreenCanvas.getContext('2d');

    const renderTask = page.render({
      canvasContext: ctx,
      viewport: viewport,
    });
    docViewer.pdfRenderTasks.push(renderTask);

    try {
      await renderTask.promise;
    } catch (err) {
      if (err?.name !== 'RenderingCancelledException') {
        console.error('Page render error:', err);
      }
      continue;
    }

    if (docViewer.isPinchZooming || myGen !== docViewer.renderGeneration) break;

    canvas.width = offscreenCanvas.width;
    canvas.height = offscreenCanvas.height;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    canvas.dataset.baseWidth = Math.round(fitScale * unscaledViewport.width);
    const destCtx = canvas.getContext('2d');
    destCtx.drawImage(offscreenCanvas, 0, 0);
  }

  setupPdfScrollObserver(container);
}

function applyCanvasVisualZoom(zoom) {
  const container = document.getElementById('pdfViewerCanvasContainer');
  if (!container) return;
  const wrappers = container.querySelectorAll('.pdf-page-wrapper');
  if (!wrappers.length) return;
  wrappers.forEach(wrap => {
    const canvas = wrap.querySelector('canvas');
    if (canvas) {
      const baseWidth = parseFloat(canvas.dataset.baseWidth) || (parseFloat(canvas.style.width) / (docViewer.renderedZoom || 1.0));
      canvas.dataset.baseWidth = baseWidth;
      const newW = Math.round(baseWidth * zoom);
      const aspect = (canvas.height && canvas.width) ? (canvas.height / canvas.width) : 1.414;
      const newH = Math.round(newW * aspect);
      canvas.style.width = `${newW}px`;
      canvas.style.height = `${newH}px`;
      wrap.style.width = `${newW}px`;
      wrap.style.minHeight = `${newH}px`;
    }
  });
}

function setupPdfScrollObserver(container) {
  container.onscroll = () => {
    const wrappers = container.querySelectorAll('.pdf-page-wrapper');
    const containerTop = container.scrollTop;
    const containerMid = containerTop + container.clientHeight / 3;
    for (const wrap of wrappers) {
      if (wrap.offsetTop <= containerMid && (wrap.offsetTop + wrap.offsetHeight) > containerMid) {
        const pageNum = Number(wrap.querySelector('canvas')?.dataset.pageNum || 1);
        if (docViewer.pdfPageNum !== pageNum) {
          docViewer.pdfPageNum = pageNum;
          updatePdfPageIndicator();
        }
        break;
      }
    }
  };
}

function updatePdfPageIndicator() {
  const ind = document.getElementById('pdfPageIndicator');
  if (ind) ind.textContent = `${docViewer.pdfPageNum} / ${docViewer.pdfTotalPages}`;
}

function updateViewerZoom() {
  const zoomLevel = document.getElementById('docZoomLevel');
  if (zoomLevel) zoomLevel.textContent = `${Math.round(docViewer.zoom * 100)}%`;

  const meta = docViewer.files[docViewer.currentIndex] ? getFileMeta(docViewer.files[docViewer.currentIndex].name) : null;
  if (!meta) return;

  if (meta.isImage) {
    const img = document.getElementById('imageViewerImg');
    if (img) {
      img.style.transform = `translate(${docViewer.imgPanX || 0}px, ${docViewer.imgPanY || 0}px) scale(${docViewer.zoom}) rotate(${docViewer.rotation}deg)`;
    }
  } else if (meta.isPdf && docViewer.pdfDoc) {
    const container = document.getElementById('pdfViewerCanvasContainer');
    if (container) {
      // Immediate visual scaling of existing canvases for instant feedback
      applyCanvasVisualZoom(docViewer.zoom);

      // Debounce the high-DPI re-render so fast clicks don't thrash PDF.js
      clearTimeout(docViewer.renderDebounceTimer);
      if (!docViewer.isPinchZooming) {
        docViewer.renderDebounceTimer = setTimeout(() => {
          if (!docViewer.isPinchZooming && docViewer.pdfDoc && container.style.display !== 'none') {
            renderPdfDocPages(docViewer.pdfDoc, container);
          }
        }, 500);
      }
    }
  }
}

function scrollPdfToPage(pageNum) {
  if (pageNum < 1 || pageNum > docViewer.pdfTotalPages) return;
  docViewer.pdfPageNum = pageNum;
  updatePdfPageIndicator();
  const wrap = document.getElementById(`pdfPageWrap_${pageNum}`);
  if (wrap) {
    wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

let resizeViewerTimeout = null;
window.addEventListener('resize', () => {
  if (document.getElementById('pdfViewerModal')?.classList.contains('open')) {
    clearTimeout(resizeViewerTimeout);
    resizeViewerTimeout = setTimeout(() => {
      if (docViewer.pdfDoc) {
        const container = document.getElementById('pdfViewerCanvasContainer');
        if (container && container.style.display !== 'none') {
          renderPdfDocPages(docViewer.pdfDoc, container);
        }
      }
    }, 180);
  }
});

let pendingMapsDetails = null;

async function openMapsDetailsModal(id, card, actionButton) {
  const loc = state.trip.locations.find(item => item.id === id);
  const urlField = card.querySelector('[data-field="google_maps_url"]');
  const url = urlField?.value.trim() || loc?.google_maps_url || '';
  const status = document.getElementById('mapsDetailsStatus');
  const preview = document.getElementById('mapsDetailsPreview');
  const addButton = document.getElementById('addMapsDetails');
  if (!loc || !url) {
    toast('Enter a Google Maps URL first.', 'warning');
    return;
  }
  updateLocation(id, { google_maps_url: url });
  pendingMapsDetails = null;
  if (status) status.textContent = 'Searching Google Maps…';
  if (preview) preview.innerHTML = '';
  if (addButton) addButton.disabled = true;
  document.getElementById('mapsDetailsModal')?.classList.add('open');
  actionButton.disabled = true;
  try {
    const response = await fetch('/api/place-info', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not find details');
    if (!data.name && !data.info) throw new Error('No place details found for this URL.');
    pendingMapsDetails = { id, data };
    if (status) status.textContent = 'Review the details found, then choose Add data.';
    if (preview) preview.innerHTML = [
      data.name ? `<div class="maps-detail-row"><div class="maps-detail-label">Name</div><div class="maps-detail-value">${esc(data.name)}</div></div>` : '',
      data.info ? `<div class="maps-detail-row"><div class="maps-detail-label">Information</div><div class="maps-detail-value">${esc(data.info)}</div></div>` : '',
      data.coordinates ? `<div class="maps-detail-row"><div class="maps-detail-label">Coordinates</div><div class="maps-detail-value">${data.coordinates.join(', ')}</div></div>` : '',
      data.country ? `<div class="maps-detail-row"><div class="maps-detail-label">Country</div><div class="maps-detail-value">${esc(data.country)}</div></div>` : '',
      data.city ? `<div class="maps-detail-row"><div class="maps-detail-label">City</div><div class="maps-detail-value">${esc(data.city)}</div></div>` : '',
      data.address ? `<div class="maps-detail-row"><div class="maps-detail-label">Address</div><div class="maps-detail-value">${esc(data.address)}</div></div>` : '',
      data.category ? `<div class="maps-detail-row"><div class="maps-detail-label">Category</div><div class="maps-detail-value">${esc(data.category)}</div></div>` : '',
    ].join('');
    if (addButton) addButton.disabled = false;
  } catch (error) {
    if (status) status.textContent = error.message;
  } finally {
    actionButton.disabled = false;
  }
}

function handleCardChange(e) {
  const target = e.target;
  const card = target.closest('[data-id]');
  if (!card) return;
  if (target.dataset.attachmentLocation) {
    uploadLocationAttachments(target.dataset.attachmentLocation, target.files);
    target.value = '';
    return;
  }
  if (!target.dataset.field) return;
  const id = card.dataset.id;
  const field = target.dataset.field;
  let value = target.type === 'checkbox' ? target.checked : target.value;
  if (field === 'cost') value = parseFloat(value) || 0;
  if (field === 'duration_minutes') value = parseInt(value, 10) || 60;

  updateLocation(id, { [field]: value });

  // Update modal title live if name field changes
  if (field === 'name') {
    const textEl = card.querySelector('.card-name-text');
    if (textEl) {
      textEl.textContent = value || '';
    }
    const modalTitle = document.getElementById('locationModalTitle') || document.getElementById('notificationLocationTitle');
    if (modalTitle && target.closest('#locationModal, #notificationLocationModal')) {
      modalTitle.textContent = value || 'Location';
    }
  }

  // Update date row live without full re-render
  // Update place (flag + city/location) live without full re-render
  if (field === 'country' || field === 'city') {
    const loc = state.trip?.locations.find(l => l.id === id);
    if (loc) {
      const placeEl = card.querySelector('.meta-strip-place');
      if (placeEl) {
        const placeName = (loc.city && loc.city !== 'Unknown') ? loc.city : (loc.country || '');
        placeEl.title = loc.city ? `${loc.city}, ${loc.country}` : (loc.country || '');
        placeEl.innerHTML = `<span class="meta-flag-wrap">${flagHTML(loc.country, loc.country_code)}</span><span class="meta-place-label">${esc(placeName)}</span>`;
      }
    }
  }

  // Update schedule live without full re-render
  if (field === 'visit_date' || field === 'visit_time' || field === 'duration_minutes') {
    const loc = state.trip?.locations.find(l => l.id === id);
    if (loc) {
      const schedTimes = getScheduleTimes(loc);
      const schedDateStr = loc.visit_date ? fmtDate(loc.visit_date, { day: 'numeric', month: 'short' }) : '';
      const schedTimeRange = schedTimes ? `${schedTimes.start} – ${schedTimes.end}` : (loc.visit_time || '');

      const metaStrip = card.querySelector('.card-meta-strip');
      let schedEl = card.querySelector('.meta-strip-schedule');

      const durStr = schedTimes ? `⏱️ ${formatDuration(schedTimes.duration)}` : '';
      if (loc.visit_date || durStr) {
        const schedHTML = `
          ${loc.visit_date ? `
          <span class="meta-sched-icon">🗓️</span>
          <span class="meta-sched-date">${schedDateStr}</span>
          ${schedTimeRange ? `<span class="meta-sched-divider">·</span><span class="meta-sched-time">${schedTimeRange}</span>` : ''}
          ` : ''}
          ${durStr ? `${loc.visit_date ? '<span class="meta-sched-divider">·</span>' : ''}<span class="meta-sched-dur strip-chip strip-time" title="Duration: ${schedTimes ? formatDuration(schedTimes.duration) : ''}">${durStr}</span>` : ''}
        `;
        if (schedEl) {
          schedEl.innerHTML = schedHTML;
        } else if (metaStrip) {
          schedEl = document.createElement('div');
          schedEl.className = 'meta-strip-schedule';
          schedEl.innerHTML = schedHTML;
          metaStrip.appendChild(schedEl);
        }
      } else if (schedEl) {
        schedEl.remove();
      }
    }
  }

  // Update window titlebar and cat-color when category changes
  if (field === 'category') {
    const safecat = VALID_CATEGORIES.includes(value) ? value : 'other';
    card.style.setProperty('--cat-color', `var(--cat-${safecat})`);
    const winIcon = card.querySelector('.window-titlebar-icon');
    if (winIcon) winIcon.textContent = CATEGORY_ICONS[safecat] || '📍';
    const catChip = card.querySelector('.strip-cat');
    if (catChip) {
      catChip.className = `strip-chip strip-cat cat-${safecat}`;
      catChip.textContent = `${CATEGORY_ICONS[safecat]} ${safecat.charAt(0).toUpperCase() + safecat.slice(1)}`;
    }
  }

  // Update titlebar meta (booking badge, paid badge, cost) live
  if (field === 'cost' || field === 'reservation_status' || field === 'paid') {
    const loc = state.trip?.locations.find(l => l.id === id);
    if (loc) {
      const sym = getCurrencySymbol(state.trip?.currency);
      const titlebar = card.querySelector('.card-window-titlebar');
      if (titlebar) {
        const metaWrap = titlebar.querySelector('.card-titlebar-meta');
        const newMetaHTML = titlebarMetaHTML(loc, sym);
        if (newMetaHTML) {
          if (metaWrap) {
            metaWrap.outerHTML = newMetaHTML;
          } else {
            titlebar.insertAdjacentHTML('beforeend', newMetaHTML);
          }
        } else if (metaWrap) {
          metaWrap.remove();
        }
      }
    }
  }

  if (field === 'cost') {
    const dayGroup = card.closest('.day-group');
    if (dayGroup) {
      const loc = state.trip?.locations.find(l => l.id === id);
      const key = loc?.visit_date || '__none__';
      const allDayLocs = (state.trip?.locations || []).filter(l => (l.visit_date || '__none__') === key);
      const dayCost = allDayLocs.filter(l => l.enabled !== false).reduce((s, l) => s + (l.cost || 0), 0);
      let totalCostEl = dayGroup.querySelector('.day-header .day-total-cost');
      if (dayCost > 0) {
        const formatted = formatCurrency(dayCost, state.trip?.currency);
        if (totalCostEl) {
          totalCostEl.textContent = formatted;
        } else {
          const header = dayGroup.querySelector('.day-header');
          if (header) {
            totalCostEl = document.createElement('span');
            totalCostEl.className = 'day-total-cost';
            totalCostEl.textContent = formatted;
            header.appendChild(totalCostEl);
          }
        }
      } else if (totalCostEl) {
        totalCostEl.remove();
      }
    }
  }

  // Update country/city tags live
  if (field === 'country' || field === 'city') {
    const loc = state.trip.locations.find(l => l.id === id);
    if (loc) {
      const countryTag = card.querySelector('.tag-country');
      if (countryTag) countryTag.innerHTML = `${flagHTML(loc.country, loc.country_code)} ${esc(loc.country)}`;
      const cityTag = card.querySelector('.tag-city');
      if (cityTag) cityTag.textContent = loc.city;
    }
    if (field === 'country') renderCountryFilter();
  }

  // Update address line live
  if (field === 'address') {
    const addrRow = card.querySelector('.card-address-row');
    const addrEl = card.querySelector('.card-address');
    const metaPlace = card.querySelector('.meta-strip-place');
    const metaStrip = card.querySelector('.card-meta-strip');

    if (value) {
      if (metaPlace) {
        metaPlace.classList.add('has-address');
        metaPlace.setAttribute('data-action', 'toggleAddress');
        metaPlace.setAttribute('role', 'button');
        metaPlace.setAttribute('tabindex', '0');
        metaPlace.title = `${metaPlace.title.split(' • ')[0]} • Apasă pentru a ascunde adresa`;
        if (!metaPlace.querySelector('.meta-address-toggle-icon')) {
          metaPlace.insertAdjacentHTML('beforeend', '<span class="meta-address-toggle-icon" title="Apasă pentru a ascunde adresa">📍</span>');
        }
      }
      if (addrRow && addrEl) {
        addrEl.textContent = value;
        addrRow.title = value;
        addrRow.classList.remove('is-closed');
        addrRow.classList.add('is-open');
        addrRow.style.display = 'flex';
        if (metaPlace) {
          metaPlace.classList.add('has-address', 'address-expanded', 'is-open');
          metaPlace.setAttribute('aria-expanded', 'true');
        }
      } else if (!addrRow && metaStrip) {
        const row = document.createElement('div');
        row.className = 'card-address-row is-open';
        row.style.display = 'flex';
        row.title = value;
        row.innerHTML = `<span class="address-row-icon">📍</span><span class="card-address" title="${esc(value)}">${esc(value)}</span>`;

        metaStrip.insertAdjacentElement('afterend', row);

        if (metaPlace) {
          metaPlace.classList.add('has-address', 'address-expanded', 'is-open');
          metaPlace.setAttribute('aria-expanded', 'true');
        }
      }
      scheduleEqualizeCardHeights();
    } else {
      if (metaPlace) {
        metaPlace.classList.remove('has-address', 'address-expanded', 'is-open');
        metaPlace.removeAttribute('data-action');
        metaPlace.removeAttribute('role');
        metaPlace.removeAttribute('tabindex');
        metaPlace.removeAttribute('aria-expanded');
        metaPlace.title = metaPlace.title.split(' • ')[0];
        metaPlace.querySelector('.meta-address-toggle-icon')?.remove();
      }
      if (addrRow) addrRow.remove();
      scheduleEqualizeCardHeights();
    }
  }

  // Update card subcard (notes & confirmation/attachments chips) live
  if (field === 'notes' || field === 'confirmation_url' || field === 'confirmation_label') {
    const loc = state.trip?.locations.find(l => l.id === id);
    if (loc) {
      updateCardSubcard(card, loc);
    }
  }

  // Update Maps button live when URL is changed
  if (field === 'google_maps_url') {
    const loc = state.trip.locations.find(l => l.id === id);
    const newUrl = safeMapsUrl(loc?.google_maps_url || '');
    const actionsDiv = card.querySelector('.card-actions');
    if (actionsDiv) {
      const existingLink = actionsDiv.querySelector('a.card-icon-btn');
      if (newUrl && !existingLink) {
        const a = document.createElement('a');
        a.href = newUrl; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.className = 'card-icon-btn'; a.title = 'Open in Maps';
        a.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>`;
        actionsDiv.prepend(a);
      } else if (newUrl && existingLink) {
        existingLink.href = newUrl;
      } else if (!newUrl && existingLink) {
        existingLink.remove();
      }
    }
  }
}

async function handleFileUpload(file) {
  const preview = document.getElementById('uploadPreview');
  const info = document.getElementById('previewInfo');
  const dz = document.getElementById('dropzone');
  try {
    const result = await api.uploadFile(file);
    state.uploadPreviewData = result.locations;
    if (preview) preview.style.display = 'block';
    if (dz) dz.style.display = 'none';
    if (info) info.textContent = `✓ Found ${result.locations.length} location${result.locations.length !== 1 ? 's' : ''} in "${file.name}"`;
  } catch (e) {
    toast('Upload error: ' + e.message, 'error');
  }
}

async function handleUrlFetch() {
  const input = document.getElementById('urlInput');
  const url = input?.value?.trim();
  if (!url) { toast('Please enter a URL', 'warning'); return; }

  // Hide guide initially; server decides whether to show it
  const guide = document.getElementById('gmapsGuide');
  if (guide) guide.style.display = 'none';

  const btn = document.getElementById('fetchUrlBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Fetching…'; }

  try {
    const res = await fetch('/api/fetch-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) {
      // Show Takeout guide only when the server explicitly says so
      if (data.guide && guide) guide.style.display = 'block';
      throw new Error(data.error || 'Fetch failed');
    }

    state.uploadPreviewData = data.locations;
    const preview = document.getElementById('uploadPreview');
    const info = document.getElementById('previewInfo');
    if (preview) preview.style.display = 'block';
    const srcLabel = data.title ? `"${data.title}"` : 'the shared link';
    if (info) info.textContent = `✓ Found ${data.locations.length} location${data.locations.length !== 1 ? 's' : ''} from ${srcLabel}`;
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Fetch'; }
  }
}

function isGoogleMapsUrl(url) {
  return /google\.[a-z.]+\/maps/i.test(url) || /maps\.google\./i.test(url);
}

function switchModalTab(tab) {
  document.querySelectorAll('.modal-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  const paneFile = document.getElementById('paneFile');
  const paneUrl = document.getElementById('paneUrl');
  if (paneFile) paneFile.style.display = tab === 'file' ? 'block' : 'none';
  if (paneUrl) paneUrl.style.display = tab === 'url' ? 'block' : 'none';
}

function confirmUpload() {
  if (!state.uploadPreviewData) return;
  const mode = document.querySelector('input[name="mergeMode"]:checked')?.value || 'merge';
  const count = state.uploadPreviewData.length;
  if (mode === 'replace') {
    state.trip.locations = state.uploadPreviewData;
  } else {
    state.trip.locations.push(...state.uploadPreviewData);
  }
  state.uploadPreviewData = null;
  markUnsaved();
  document.getElementById('uploadModal')?.classList.remove('open');
  resetUploadUI();
  renderCountryFilter();
  renderMain();
  renderStats();
  renderSummary();
  toast(`${mode === 'replace' ? 'Replaced all with' : 'Added'} ${count} location${count !== 1 ? 's' : ''}!`, 'success');
}

function resetUploadUI() {
  state.uploadPreviewData = null;
  // Reset file tab
  const dz = document.getElementById('dropzone');
  if (dz) dz.style.display = 'block';
  const fi = document.getElementById('fileInput');
  if (fi) fi.value = '';
  // Reset URL tab
  const urlInput = document.getElementById('urlInput');
  if (urlInput) urlInput.value = '';
  // Hide preview
  const preview = document.getElementById('uploadPreview');
  if (preview) preview.style.display = 'none';
  // Switch back to file tab
  document.querySelectorAll('.modal-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'file'));
  const paneFile = document.getElementById('paneFile');
  const paneUrl = document.getElementById('paneUrl');
  if (paneFile) paneFile.style.display = 'block';
  if (paneUrl) paneUrl.style.display = 'none';
}

// ============================================================
// PWA
// ============================================================
function registerServiceWorker() {
  // Disable the service worker on localhost/dev builds so the UI does not keep
  // serving stale HTML/CSS from cached app-shell versions during active development.
  const isLocalhost = ['localhost', '127.0.0.1', ''].includes(window.location.hostname);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => {
      if (isLocalhost) {
        return Promise.all(regs.map(reg => reg.unregister()));
      }
      return regs.length ? Promise.resolve() : navigator.serviceWorker.register('/sw.js');
    }).catch(err => console.warn('SW reg failed:', err));
  }

  if (!isLocalhost) {
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      state.installPrompt = e;
      const btn = document.getElementById('installBtn');
      if (btn) btn.style.display = 'flex';
    });
  }
}

// ============================================================
// UTILS
// ============================================================
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeMapsUrl(url) {
  if (!url) return '';
  let s = String(url).trim();
  // Upgrade old HTTP CID format to modern HTTPS format that browsers follow reliably
  s = s.replace(/^http:\/\/maps\.google\.com\/\?cid=(.+)$/i, 'https://www.google.com/maps?cid=$1');
  return (s.startsWith('http://') || s.startsWith('https://')) ? esc(s) : '';
}

function safeExternalUrl(url) {
  if (!url) return '';
  const value = String(url).trim();
  return /^https?:\/\//i.test(value) ? esc(value) : '';
}

function wazeUrl(loc) {
  const c = loc.coordinates;
  if (c && c[0] != null && c[1] != null) {
    // GeoJSON stores [longitude, latitude]
    return `https://waze.com/ul?ll=${c[1]},${c[0]}&navigate=yes`;
  }
  const q = loc.address || loc.name;
  return q ? `https://waze.com/ul?q=${encodeURIComponent(q)}&navigate=yes` : '';
}

function formatCurrency(amount, currency = 'EUR') {
  if (amount == null) return '€0';
  try {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency', currency: currency || 'EUR',
      minimumFractionDigits: 0, maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `€${amount}`;
  }
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function getCurrencySymbol(currency = 'EUR') {
  const map = { EUR: '€', USD: '$', GBP: '£', CHF: '₣', PLN: 'zł', RON: 'lei' };
  return map[currency] || '€';
}

function getTodayDateString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function fmtDate(dateStr, opts) {
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', opts);
  } catch {
    return dateStr;
  }
}

function genId() {
  return 'loc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

function toast(message, type = 'info') {

  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
  el.addEventListener('click', () => el.remove());
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('toast-out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, 3500);
}

// ============================================================
// INIT
// ============================================================
function updateDocumentTitle(name) {
  document.title = name ? `${name} — Euro Trip Planner` : 'Euro Trip Planner';
}

async function refreshTripSelector(activeId) {
  const selector = document.getElementById('tripSelector');
  if (!selector) return;
  const selectorWrap = selector.closest('.trip-selector-wrap') || document.getElementById('tripSelectorWrap');
  try {
    const data = await api.getTrips();
    state.tripCatalog = data.trips || [];
    selector.dataset.activeTrip = activeId || data.active;
    const activeTrip = state.tripCatalog.find(trip => trip.id === selector.dataset.activeTrip);
    selector.title = `Select trip: ${activeTrip?.name || ''}`;
    const tripHint = document.getElementById('tripSelectorActiveName');
    if (tripHint && activeTrip?.name) {
      tripHint.textContent = activeTrip.name;
    }
    if (selectorWrap) {
      selectorWrap.style.display = state.tripCatalog.length > 1 ? '' : 'none';
    }
  } catch (err) {
    console.warn('refreshTripSelector error:', err);
  }
}

function renderTripManager() {
  const list = document.getElementById('tripManagerList');
  if (!list) return;
  const activeId = document.getElementById('tripSelector')?.dataset.activeTrip;
  list.innerHTML = (state.tripCatalog || []).map(trip => `
    <div class="trip-manager-row${trip.id === activeId ? ' active' : ''}">
      <div class="trip-manager-info">
        <div class="trip-manager-name">${esc(trip.name)}</div>
        <div class="trip-manager-meta">${trip.location_count} locations</div>
      </div>
      <div class="trip-manager-actions">
        <button class="btn-primary trip-manager-action" data-select-trip="${esc(trip.id)}" type="button">Select</button>
        ${state.role === 'admin' ? `<button class="btn-secondary trip-manager-action trip-manager-delete" data-delete-trip="${esc(trip.id)}" type="button">Delete</button>` : ''}
      </div>
    </div>`).join('');
}

function setActiveTrip(trip) {
  if (!trip || typeof trip !== 'object') {
    trip = { id: 'my_trip', trip_name: 'Euro Trip', currency: 'EUR', locations: [] };
  }
  if (!Array.isArray(trip.locations)) {
    trip.locations = [];
  }
  state.trip = trip;
  const today = getTodayDateString();
  const days = [...new Set((trip.locations || []).map(loc => loc.visit_date).filter(Boolean))];
  const preferredDay = getInitialMapDay();
  if (preferredDay && (preferredDay === 'all' || days.includes(preferredDay))) {
    state.mapDay = preferredDay;
  } else {
    state.mapDay = days.includes(today) ? today : 'all';
  }
  savePrefs({ mapDay: state.mapDay });
  updateMapDayUrl(state.mapDay);
  state.routeDay = days.includes(today) ? today : 'all';
  const serverExcluded = (trip.locations || []).filter(l => l.excluded).map(l => l.id);
  state.mapExcluded = new Set(serverExcluded);
  savePrefs({ mapExcluded: serverExcluded });
  state.mapOptimized = false;
  updateNotifications();
  state.unsaved = false;
  document.getElementById('unsavedDot')?.classList.remove('visible');
  const nameInput = document.getElementById('tripNameInput');
  if (nameInput) nameInput.value = trip.trip_name || '';
  const tripHint = document.getElementById('tripSelectorActiveName');
  if (tripHint && trip.trip_name) tripHint.textContent = trip.trip_name;
  updateDocumentTitle(trip.trip_name);
  renderCountryFilter();
  renderMain();
  renderStats();
  renderSummary();
}

async function showNativeNotification(title, options = {}) {
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.showNotification) {
        return await reg.showNotification(title, {
          icon: '/static/icons/icon-192.svg',
          badge: '/static/icons/icon-192.svg',
          ...options
        });
      }
    }
  } catch (e) {
    console.warn('SW notification error:', e);
  }
  try {
    return new Notification(title, {
      icon: '/static/icons/icon-192.svg',
      ...options
    });
  } catch (e) {
    console.warn('Native notification error:', e);
  }
}

function updateNotifications(showNative = false) {
  const now = new Date();
  const reminders = [];
  const locations = state.trip?.locations || [];
  locations.forEach(location => {
    if (location.enabled === false || location.visited) return;
    if (!location.visit_date) {
      reminders.push({ locationId: location.id, title: 'Activitate neprogramată', text: `${location.name} nu are o dată stabilită.`, key: `unscheduled-${location.id}` });
      return;
    }
    const timeStr = location.visit_time || '09:00';
    const isoTime = timeStr.length === 5 ? `${timeStr}:00` : timeStr;
    const scheduled = new Date(`${location.visit_date}T${isoTime}`);
    const hours = (scheduled - now) / 3600000;
    if (hours >= 0 && hours <= 24) reminders.push({ locationId: location.id, title: 'Activitate viitoare', text: `${location.name} este programat în mai puțin de 24h.`, key: `upcoming-${location.id}-${location.visit_date}` });
    if (location.reservation_status === 'reserved') reminders.push({ locationId: location.id, title: 'Rezervare neconfirmată', text: `${location.name} este rezervat dar neconfirmat.`, key: `reservation-${location.id}` });
    if (location.category === 'transport' && hours >= 0 && hours <= 48) reminders.push({ locationId: location.id, title: 'Memento plecare', text: `${location.name} este planificat pentru ${location.visit_date}${location.visit_time ? ` la ${location.visit_time}` : ''}.`, key: `departure-${location.id}-${location.visit_date}` });
  });
  state.notifications = reminders;
  const count = document.getElementById('notificationCount');
  if (count) {
    count.textContent = reminders.length;
    count.classList.toggle('count-zero', reminders.length === 0);
  }
  if (showNative && 'Notification' in window && Notification.permission === 'granted') {
    const todayStr = getTodayDateString();
    const lastDaily8amDate = localStorage.getItem('lastDaily8amNotificationDate');

    // În fiecare zi la ora 08:00 (sau prima accesare după ora 08:00 a fiecărei zile),
    // resetăm lista mementourilor trimise pentru a retrimite toate notificările active existente
    if (now.getHours() >= 8 && lastDaily8amDate !== todayStr) {
      localStorage.removeItem('shownTripReminders');
      localStorage.setItem('lastDaily8amNotificationDate', todayStr);
    }

    const shown = JSON.parse(localStorage.getItem('shownTripReminders') || '{}');
    const toShow = reminders.filter(item => !shown[item.key]);
    toShow.forEach((item, index) => {
      setTimeout(() => {
        showNativeNotification(item.title, { body: item.text });
      }, index * 350);
      shown[item.key] = Date.now();
    });
    if (toShow.length) localStorage.setItem('shownTripReminders', JSON.stringify(shown));
  }
}

function renderNotifications() {
  const list = document.getElementById('notificationsList');
  if (!list) return;
  list.innerHTML = state.notifications.length
    ? state.notifications.map(item => `<button class="notification-item" data-notification-location="${esc(item.locationId)}" type="button"><strong>${esc(item.title)}</strong><span>${esc(item.text)}</span></button>`).join('')
    : '<div class="notifications-empty">Nu există mementouri în acest moment.</div>';

  const enableBtn = document.getElementById('enableNotifications');
  if (enableBtn) {
    if (!('Notification' in window)) {
      enableBtn.style.display = 'none';
    } else if (Notification.permission === 'granted') {
      enableBtn.innerHTML = '🔔 Notificări de sistem active (Trimite test)';
      enableBtn.className = 'btn-secondary btn-notif-active';
      enableBtn.disabled = false;
    } else if (Notification.permission === 'denied') {
      enableBtn.innerHTML = '⚠️ Notificările sunt blocate în setările browserului';
      enableBtn.className = 'btn-secondary';
      enableBtn.disabled = true;
    } else {
      enableBtn.innerHTML = '🔔 Activează notificările în browser';
      enableBtn.className = 'btn-secondary';
      enableBtn.disabled = false;
    }
  }
}

function openLocationModal(locationId) {
  if (!locationId) return;
  const location = state.trip?.locations.find(item => item.id === locationId);
  const body = document.getElementById('locationModalBody') || document.getElementById('notificationLocationBody');
  if (!location || !body) return;
  body.innerHTML = cardHTML(location);
  const title = document.getElementById('locationModalTitle') || document.getElementById('notificationLocationTitle');
  if (title) title.textContent = location.name || 'Location';
  document.getElementById('notificationsModal')?.classList.remove('open');
  const modal = document.getElementById('locationModal') || document.getElementById('notificationLocationModal');
  modal?.classList.add('open');
}

const openNotificationLocation = openLocationModal;

async function init() {
  if (document.querySelector('.settings-page')) {
    // Settings page has its own dedicated lifecycle and handlers
    return;
  }
  try {
    const trip = await api.getTrip();
    state.trip = trip;
    const serverExcluded = (trip.locations || []).filter(l => l.excluded).map(l => l.id);
    const localExcluded = _prefs.mapExcluded || [];
    state.mapExcluded = new Set([...serverExcluded, ...localExcluded]);
    (trip.locations || []).forEach(l => {
      if (state.mapExcluded.has(l.id)) l.excluded = true;
    });
    savePrefs({ mapExcluded: [...state.mapExcluded] });
    const nameInput = document.getElementById('tripNameInput');
    if (nameInput) nameInput.value = trip.trip_name || '';
    updateDocumentTitle(trip.trip_name);
    await refreshTripSelector();

    // Restore persisted view tab
    document.querySelectorAll('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === state.view));
    document.querySelectorAll('.mnav-btn[data-view]').forEach(t => t.classList.toggle('active', t.dataset.view === state.view));

    if (state.view === 'map' && state.isMapFullscreen) {
      updateMapFullscreenUrl(true);
    }

    // Restore sort select
    const sortSel = document.getElementById('sortSelect');
    if (sortSel) sortSel.value = state.sortBy;

    // Restore hide-visited toggle
    const hvChk = document.getElementById('hideVisited');
    if (hvChk) hvChk.checked = state.hideVisited;

    // Restore single-column toggle
    applySingleColMode();
    updateFilterActiveDot();

    render();
    bindEvents();
    updateNarrowMobileNav();
    updateNotifications(true);
    setInterval(() => updateNotifications(true), 60000);
    registerServiceWorker();
  } catch (e) {
    const mc = document.getElementById('mainContent');
    if (mc) mc.innerHTML = emptyStateHTML('Failed to load', e.message);
  }
}

document.addEventListener('DOMContentLoaded', init);
