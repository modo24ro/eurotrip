/**
 * core/state.js
 * Central Application State, Categories, Preferences and Location CRUD
 */

import { parseDuration, fmtDate } from './date-utils.js';

export const VALID_CATEGORIES = [
  'sightseeing',
  'food',
  'hotel',
  'transport_flight',
  'transport',
  'shopping',
  'nature',
  'entertainment',
  'other',
];

export const CATEGORY_ICONS = {
  sightseeing: '🏛️',
  food: '🍽️',
  hotel: '🏨',
  transport_flight: '✈️',
  transport: '🚗',
  shopping: '🛍️',
  nature: '🌲',
  entertainment: '🎭',
  other: '📍',
};

const PREFS_KEY = 'eurotrip_prefs';

export function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
  } catch {
    return {};
  }
}

export function savePrefs(patch) {
  try {
    const current = loadPrefs();
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...current, ...patch }));
  } catch (_) {}
}

const prefs = loadPrefs();

export const state = {
  trip: null,
  view: prefs.view || 'day',
  sortBy: prefs.sortBy || 'visit_date',
  filterCategory: 'all',
  filterCountry: 'all',
  searchQuery: '',
  hideVisited: prefs.hideVisited || false,
  mapExcluded: new Set(Array.isArray(prefs.mapExcluded) ? prefs.mapExcluded : []),
  role: (typeof document !== 'undefined' && document.body?.dataset?.role) || 'viewer',
  timelineDay: null,
  routeDay: 'all',
  routeTravelMode: 'driving',
  routeOptimized: true,
  isMapFullscreen: false,
  pendingNewLocation: null,
  unsavedChanges: false,
};

export function markUnsaved() {
  state.unsavedChanges = true;
  const dot = document.getElementById('unsavedDot');
  if (dot) dot.classList.add('visible');
}

export function clearUnsaved() {
  state.unsavedChanges = false;
  const dot = document.getElementById('unsavedDot');
  if (dot) dot.classList.remove('visible');
}

function getActiveState() {
  return (typeof window !== 'undefined' && window.state) ? window.state : state;
}

export function getLocation(id) {
  const s = getActiveState();
  return s.trip?.locations?.find(l => l.id === id) || null;
}

export function updateLocation(id, fields) {
  const loc = getLocation(id);
  if (!loc) return;
  Object.assign(loc, fields);
  markUnsaved();
}

export function deleteLocation(id) {
  const s = getActiveState();
  if (!s.trip) return;
  s.trip.locations = (s.trip.locations || []).filter(l => l.id !== id);
  if (s.mapExcluded) s.mapExcluded.delete(id);
  savePrefs({ mapExcluded: s.mapExcluded ? [...s.mapExcluded] : [] });
  markUnsaved();
}

export function duplicateLocation(id) {
  const s = getActiveState();
  const orig = getLocation(id);
  if (!orig || !s.trip) return null;

  const copy = JSON.parse(JSON.stringify(orig));
  copy.id = 'loc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  copy.name = `${copy.name} (Copy)`;
  copy.visited = false;
  copy.attachments = [];

  const idx = s.trip.locations.findIndex(l => l.id === id);
  if (idx !== -1) {
    s.trip.locations.splice(idx + 1, 0, copy);
  } else {
    s.trip.locations.push(copy);
  }
  markUnsaved();
  return copy;
}

export function addBlankLocation() {
  const newLoc = {
    id: 'loc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9),
    name: '',
    category: 'sightseeing',
    country: '',
    city: '',
    address: '',
    google_maps_url: '',
    visit_date: '',
    visit_time: '',
    duration_minutes: 60,
    cost: 0,
    paid: false,
    reservation_status: '',
    confirmation_url: '',
    confirmation_label: '',
    flight_number: '',
    notes: '',
    enabled: true,
    visited: false,
    attachments: [],
  };
  return newLoc;
}

export function getFilteredLocations() {
  const s = getActiveState();
  let locs = s.trip?.locations ?? [];
  const filter = s.filter || {};
  const category = filter.category || s.filterCategory || 'all';
  const country = filter.country || s.filterCountry || 'all';
  const search = (filter.search != null ? filter.search : (s.searchQuery || '')).trim();
  const showDisabled = filter.showDisabled !== undefined ? filter.showDisabled : true;

  if (!showDisabled) locs = locs.filter(l => l.enabled);
  if (s.hideVisited) locs = locs.filter(l => !l.visited);
  if (category !== 'all') {
    locs = locs.filter(l => l.category === category);
  }
  if (country !== 'all') {
    locs = locs.filter(l => l.country === country);
  }
  if (search) {
    const q = search.toLowerCase();
    locs = locs.filter(l =>
      (l.name || '').toLowerCase().includes(q) ||
      (l.city && l.city.toLowerCase().includes(q)) ||
      (l.country && l.country.toLowerCase().includes(q)) ||
      (l.address && l.address.toLowerCase().includes(q)) ||
      (l.notes && l.notes.toLowerCase().includes(q)) ||
      (l.flight_number && l.flight_number.toLowerCase().includes(q))
    );
  }
  return locs;
}
