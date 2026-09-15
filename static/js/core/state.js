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
  role: document.body.dataset.role || 'viewer',
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

export function getLocation(id) {
  return state.trip?.locations?.find(l => l.id === id) || null;
}

export function updateLocation(id, fields) {
  const loc = getLocation(id);
  if (!loc) return;
  Object.assign(loc, fields);
  markUnsaved();
}

export function deleteLocation(id) {
  if (!state.trip) return;
  state.trip.locations = (state.trip.locations || []).filter(l => l.id !== id);
  state.mapExcluded.delete(id);
  savePrefs({ mapExcluded: [...state.mapExcluded] });
  markUnsaved();
}

export function duplicateLocation(id) {
  const orig = getLocation(id);
  if (!orig) return null;

  const copy = JSON.parse(JSON.stringify(orig));
  copy.id = 'loc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  copy.name = `${copy.name} (Copy)`;
  copy.visited = false;
  copy.attachments = [];

  const idx = state.trip.locations.findIndex(l => l.id === id);
  if (idx !== -1) {
    state.trip.locations.splice(idx + 1, 0, copy);
  } else {
    state.trip.locations.push(copy);
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
  const locs = state.trip?.locations ?? [];
  return locs.filter(loc => {
    if (state.hideVisited && loc.visited) return false;
    if (state.filterCategory !== 'all' && loc.category !== state.filterCategory) return false;
    if (state.filterCountry !== 'all' && loc.country !== state.filterCountry) return false;
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      const match =
        (loc.name || '').toLowerCase().includes(q) ||
        (loc.city || '').toLowerCase().includes(q) ||
        (loc.country || '').toLowerCase().includes(q) ||
        (loc.address || '').toLowerCase().includes(q) ||
        (loc.notes || '').toLowerCase().includes(q) ||
        (loc.flight_number || '').toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });
}
