/**
 * core/toast.js
 * Unified application toast notification component
 */

export function toast(msg, type = 'info', duration = 3500) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  el.setAttribute('role', 'alert');
  el.setAttribute('aria-live', 'polite');
  container.appendChild(el);

  // Trigger animation
  requestAnimationFrame(() => el.classList.add('visible'));

  setTimeout(() => {
    el.classList.remove('visible');
    el.classList.add('toast-fade');
    setTimeout(() => el.remove(), 300);
  }, duration);
}

export function showToast(msg, type = 'info') {
  toast(msg, type);
}

if (typeof window !== 'undefined') {
  window.toast = toast;
  window.showToast = showToast;
}

