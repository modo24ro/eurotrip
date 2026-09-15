/**
 * components/modal.js
 * Generic modal dialog controller, scroll locking, and accessible backdrop handling
 */

import { state, deleteLocation } from '../core/state.js';
import { toast } from '../core/toast.js';

let pendingDeleteLocationId = '';

export function updateModalOpenState() {
  const hasOpenModal = !!document.querySelector('.modal-overlay.open, .modal-backdrop.open');
  document.body.classList.toggle('modal-open', hasOpenModal);
}

export function openModal(modalEl) {
  if (!modalEl) return;
  modalEl.classList.add('open');
  updateModalOpenState();
}

export function closeModal(modalEl) {
  if (!modalEl) return;
  modalEl.classList.remove('open');
  updateModalOpenState();
}

export function closeLocationModal(onCloseCallback) {
  const locModal = document.getElementById('locationModal');
  const notifModal = document.getElementById('notificationLocationModal');
  const wasOpen = locModal?.classList.contains('open') || notifModal?.classList.contains('open');

  locModal?.classList.remove('open');
  notifModal?.classList.remove('open');
  updateModalOpenState();

  if (state.pendingNewLocation) {
    state.pendingNewLocation = null;
    const body = document.getElementById('locationModalBody') || document.getElementById('notificationLocationBody');
    if (body) body.innerHTML = '';
    return;
  }

  if (wasOpen && typeof onCloseCallback === 'function') {
    onCloseCallback();
  }
}

export function openDeleteLocationModal(id) {
  const location = (state.pendingNewLocation && state.pendingNewLocation.id === id)
    ? state.pendingNewLocation
    : state.trip?.locations?.find(l => l.id === id);

  if (!location) {
    closeLocationModal();
    return;
  }

  pendingDeleteLocationId = id;
  const nameEl = document.getElementById('deleteLocationName');
  if (nameEl) nameEl.textContent = location.name || 'this location';

  const modal = document.getElementById('deleteLocationModal');
  if (modal) modal.classList.add('open');
  updateModalOpenState();
}

export function closeDeleteLocationModal() {
  pendingDeleteLocationId = '';
  const modal = document.getElementById('deleteLocationModal');
  if (modal) modal.classList.remove('open');
  updateModalOpenState();
}

export function confirmDeleteLocation(onDeletedCallback) {
  if (!pendingDeleteLocationId) {
    closeDeleteLocationModal();
    return;
  }

  const idToDelete = pendingDeleteLocationId;
  deleteLocation(idToDelete);
  closeDeleteLocationModal();
  closeLocationModal();

  toast('Locație ștearsă.', 'info');
  if (typeof onDeletedCallback === 'function') {
    onDeletedCallback();
  }
}
