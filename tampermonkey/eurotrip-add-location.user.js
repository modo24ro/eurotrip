// ==UserScript==
// @name         EuroTrip - Add Google Maps location
// @namespace    eurotrip-local
// @version      1.1.0
// @description  Add the current Google Maps place to the active EuroTrip
// @match        https://www.google.com/maps/*
// @match        https://maps.google.com/*
// @match        https://maps.app.goo.gl/*
// @grant        GM_xmlhttpRequest
// @connect      trip.modo24.ro
// ==/UserScript==

(() => {
  'use strict';

  const API_URL = 'https://trip.modo24.ro/api/integrations/tampermonkey/location';
  const button = document.createElement('button');
  button.textContent = 'Add to EuroTrip';
  Object.assign(button.style, {
    position: 'fixed', right: '5cm', top: '16px', zIndex: '2147483647',
    padding: '12px 16px', border: '0', borderRadius: '8px', cursor: 'pointer',
    background: '#5c73f2', color: '#fff', font: '600 14px Segoe UI, sans-serif',
    boxShadow: '0 4px 18px rgba(0,0,0,.35)'
  });
  document.body.appendChild(button);

  let displayedUrl = window.location.href;

  const resetButtonForUrl = url => {
    displayedUrl = url;
    button.disabled = false;
    button.textContent = 'Add to EuroTrip';
    button.style.background = '#5c73f2';
  };

  const checkUrlChange = () => {
    if (window.location.href !== displayedUrl) resetButtonForUrl(window.location.href);
  };

  window.addEventListener('popstate', checkUrlChange);
  window.addEventListener('hashchange', checkUrlChange);
  setInterval(checkUrlChange, 500);

  const placeName = () => {
    const title = (document.title || '').replace(/\s*[-|]\s*Google Maps.*$/i, '').trim();
    return title && !/^google maps$/i.test(title) ? title : '';
  };

  button.addEventListener('click', () => {
    const requestUrl = window.location.href;
    displayedUrl = requestUrl;
    button.disabled = true;
    button.textContent = 'Adding...';
    GM_xmlhttpRequest({
      method: 'POST',
      url: API_URL,
      withCredentials: true,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ name: placeName(), google_maps_url: requestUrl }),
      onload: response => {
        let data = {};
        try { data = JSON.parse(response.responseText); } catch {}
        if (response.status >= 200 && response.status < 300) {
          button.textContent = 'Added';
          button.style.background = '#10b981';
        } else if (response.status === 401 || response.status === 403) {
          button.disabled = false;
          button.textContent = response.status === 401 ? 'Login admin first' : 'Admin access required';
          button.style.background = '#f59e0b';
        } else {
          button.disabled = false;
          button.textContent = data.error || 'Add failed';
          button.style.background = '#ef4444';
        }
      },
      onerror: () => {
        button.disabled = false;
        button.textContent = 'Connection failed';
        button.style.background = '#ef4444';
      }
    });
  });
})();
