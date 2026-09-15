/**
 * core/api.js
 * Centralized API Client for EuroTrip Flask Backend
 */

export const api = {
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
    if (!res.ok) throw new Error('Failed to create trip');
    return res.json();
  },

  async deleteTrip(id) {
    const res = await fetch(`/api/trips/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete trip');
    return res.json();
  },

  async activateTrip(id) {
    const res = await fetch(`/api/trips/${encodeURIComponent(id)}/activate`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to switch trip');
    return res.json();
  },

  async getTrip() {
    const res = await fetch('/api/trip');
    if (!res.ok) throw new Error('Failed to load trip');
    return res.json();
  },

  async saveTrip(trip) {
    const res = await fetch('/api/trip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(trip),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to save trip');
    }
    return res.json();
  },

  async setVisited(id, visited) {
    const res = await fetch('/api/visited', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, visited }),
    });
    if (!res.ok) throw new Error('Failed to update visited state');
    return res.json();
  },

  async setExcluded(locId, excluded) {
    const res = await fetch('/api/excluded', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: locId, excluded }),
    });
    if (!res.ok) throw new Error('Failed to update route exclude state');
    return res.json();
  },

  async geocode(query) {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error('Geocoding failed');
    return res.json();
  },

  async getFlightData(locId) {
    const res = await fetch(`/api/locations/${encodeURIComponent(locId)}/flight-data`);
    return res.json();
  },

  async refreshFlight(locId) {
    const res = await fetch(`/api/locations/${encodeURIComponent(locId)}/flight-refresh`, { method: 'POST' });
    return res.json();
  },

  async getBackups() {
    const res = await fetch('/api/backups');
    if (!res.ok) throw new Error('Failed to fetch backups');
    return res.json();
  },

  async createBackup() {
    const res = await fetch('/api/backup', { method: 'POST' });
    if (!res.ok) throw new Error('Backup creation failed');
    return res.json();
  },

  async restoreBackup(filename) {
    const res = await fetch(`/api/restore/${encodeURIComponent(filename)}`, { method: 'POST' });
    if (!res.ok) throw new Error('Restore failed');
    return res.json();
  },

  async deleteBackup(filename) {
    const res = await fetch(`/api/backups/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Backup deletion failed');
    return res.json();
  },

  async uploadAttachment(locId, file) {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`/api/locations/${encodeURIComponent(locId)}/attachments`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error('Upload failed');
    return res.json();
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

  async deleteAttachment(locId, filename) {
    const res = await fetch(`/api/locations/${encodeURIComponent(locId)}/attachments/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Delete attachment failed');
    return res.json();
  },
};

if (typeof window !== 'undefined') {
  window.api = api;
}

