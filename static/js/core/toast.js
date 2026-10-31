/**
 * core/toast.js
 * Unified application toast notification component
 */

function setSafeToastContent(el, msg) {
  if (typeof msg !== 'string') {
    el.textContent = String(msg ?? '');
    return;
  }
  // Check if string contains HTML tags
  if (!/<\/?(?:strong|em|b|i|span|small|code|br)\b/i.test(msg)) {
    el.textContent = msg;
    return;
  }
  // If it has HTML, only allow safe formatting tags: strong, em, b, i, span, small, code, br
  const parser = new DOMParser();
  const doc = parser.parseFromString(msg, 'text/html');
  const allowedTags = new Set(['STRONG', 'EM', 'B', 'I', 'SPAN', 'SMALL', 'CODE', 'BR']);

  function sanitize(node) {
    const fragment = document.createDocumentFragment();
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        fragment.appendChild(child.cloneNode(true));
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (allowedTags.has(child.tagName)) {
          const safeEl = document.createElement(child.tagName.toLowerCase());
          if (child.className) safeEl.className = child.className;
          safeEl.appendChild(sanitize(child));
          fragment.appendChild(safeEl);
        } else {
          fragment.appendChild(sanitize(child));
        }
      }
    }
    return fragment;
  }

  el.replaceChildren(sanitize(doc.body));
}

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
  setSafeToastContent(el, msg);
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
