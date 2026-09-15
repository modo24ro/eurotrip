/**
 * core/utils.js
 * Generic formatting, escaping, URL and country/category helpers
 */

export const DEFAULT_CURRENCY = 'EUR';

export const CURRENCY_SYMBOLS = {
  EUR: '€',
  USD: '$',
  GBP: '£',
  RON: 'lei',
  CHF: 'CHF',
  JPY: '¥',
  CZK: 'Kč',
  HUF: 'Ft',
  PLN: 'zł',
  BGN: 'лв',
  TRY: '₺',
};

export function formatCurrency(amount, currency = 'EUR') {
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

export function getCurrencySymbol(currency = 'EUR') {
  return CURRENCY_SYMBOLS[currency] || '€';
}

export function getTodayDateString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function genId() {
  return 'loc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

export function safeMapsUrl(url) {
  if (!url) return '';
  let s = String(url).trim();
  s = s.replace(/^http:\/\/maps\.google\.com\/\?cid=(.+)$/i, 'https://www.google.com/maps?cid=$1');
  return (s.startsWith('http://') || s.startsWith('https://')) ? esc(s) : '';
}

export function safeExternalUrl(url) {
  if (!url) return '';
  const value = String(url).trim();
  return /^https?:\/\//i.test(value) ? esc(value) : '';
}

export function wazeUrl(loc) {
  if (!loc) return '';
  const c = loc.coordinates;
  if (c && c[0] != null && c[1] != null) {
    return `https://waze.com/ul?ll=${c[1]},${c[0]}&navigate=yes`;
  }
  const q = loc.address || loc.name;
  return q ? `https://waze.com/ul?q=${encodeURIComponent(q)}&navigate=yes` : '';
}

// ISO-3166-1 alpha-2 codes — used to fetch real flag images

export const COUNTRY_CODES = {
  'Germany': 'de', 'Spain': 'es', 'Romania': 'ro',
  'France': 'fr', 'Italy': 'it', 'Netherlands': 'nl',
  'Belgium': 'be', 'Austria': 'at', 'Switzerland': 'ch',
  'Czech Republic': 'cz', 'Czechia': 'cz', 'Poland': 'pl', 'Hungary': 'hu',
  'Portugal': 'pt', 'Greece': 'gr', 'Croatia': 'hr',
  'Slovenia': 'si', 'Slovakia': 'sk', 'Denmark': 'dk',
  'Sweden': 'se', 'Norway': 'no', 'Finland': 'fi',
  'United Kingdom': 'gb', 'Ireland': 'ie', 'Serbia': 'rs',
  'Bulgaria': 'bg', 'Moldova': 'md', 'Ukraine': 'ua',
  'Latvia': 'lv', 'Lithuania': 'lt', 'Estonia': 'ee',
  'Luxembourg': 'lu', 'Malta': 'mt', 'Cyprus': 'cy',
  'Iceland': 'is', 'Bosnia': 'ba', 'Montenegro': 'me',
  'Albania': 'al', 'North Macedonia': 'mk', 'Andorra': 'ad',
  'Turkey': 'tr', 'Turcia': 'tr', 'Spania': 'es', 'Franta': 'fr',
  'Italia': 'it', 'Germania': 'de', 'Ungaria': 'hu', 'Grecia': 'gr',
  'Portugalia': 'pt', 'Olanda': 'nl', 'Belgia': 'be', 'Elvetia': 'ch',
  'Cehia': 'cz', 'Polonia': 'pl', 'Marea Britanie': 'gb', 'Irlanda': 'ie',
  'Danemarca': 'dk', 'Suedia': 'se', 'Norvegia': 'no',
};

export function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatEur(val, curr = 'EUR') {
  if (val === null || val === undefined || val === '' || isNaN(Number(val))) return '';
  const num = Number(val);
  const sym = CURRENCY_SYMBOLS[curr] || curr;
  return `${num.toLocaleString('ro-RO', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${sym}`;
}

export function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export const formatFileSize = formatBytes;

export function getFileMeta(filename) {
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

export function isNarrowScreen() {
  return typeof window !== 'undefined' && window.innerWidth <= 768;
}

export function getDocumentBaseUrl() {
  const isCapacitor = !!(typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins);
  const locOrigin = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : '';
  const locHost = (typeof window !== 'undefined' && window.location && window.location.hostname) ? window.location.hostname : '';
  const locProto = (typeof window !== 'undefined' && window.location && window.location.protocol) ? window.location.protocol : '';

  if (isCapacitor || locOrigin === 'https://localhost' || locOrigin === 'http://localhost' || locProto === 'capacitor:') {
    let sUrl = '';
    try {
      const saved = localStorage.getItem('eurotrip_mobile_config');
      if (saved) {
        const cfg = JSON.parse(saved);
        if (cfg && cfg.serverUrl) sUrl = cfg.serverUrl.trim();
      }
    } catch (_) { }
    if (!sUrl && typeof window.getRemoteServerUrl === 'function') {
      sUrl = window.getRemoteServerUrl() || '';
    }
    if (!sUrl || sUrl.includes('localhost') || sUrl.includes('127.0.0.1')) {
      sUrl = 'https://trip.modo24.ro';
    }
    sUrl = sUrl.replace(/\/+$/, '');
    if (!sUrl.startsWith('http://') && !sUrl.startsWith('https://')) {
      sUrl = 'https://' + sUrl;
    }
    return sUrl;
  }

  if (locProto === 'https:' || (!['localhost', '127.0.0.1', '0.0.0.0', ''].includes(locHost))) {
    return locOrigin.replace(/\/+$/, '');
  }

  return locOrigin.replace(/\/+$/, '');
}

export function getRemoteApiBaseUrl() {
  return getDocumentBaseUrl();
}

export function buildAttachmentDownloadUrl(locationId, filename, token = '') {
  const base = getDocumentBaseUrl();
  let url = `${base}/api/locations/${encodeURIComponent(locationId)}/attachments/${encodeURIComponent(filename)}?download=1`;
  if (token) {
    url += `&token=${encodeURIComponent(token)}`;
  }
  return url;
}

export function buildAttachmentRawUrl(locationId, filename, token = '') {
  const base = getDocumentBaseUrl();
  let url = `${base}/api/locations/${encodeURIComponent(locationId)}/attachments/${encodeURIComponent(filename)}`;
  if (token) {
    url += `?token=${encodeURIComponent(token)}`;
  }
  return url;
}

export function buildDocViewerUrl(locationId, filename, token = '') {
  const base = getDocumentBaseUrl();
  let url = `${base}/doc-viewer/${encodeURIComponent(locationId)}/${encodeURIComponent(filename)}`;
  if (token) {
    url += `?token=${encodeURIComponent(token)}`;
  }
  return url;
}

export function flagHTML(country, countryCode) {
  const code = ((countryCode && countryCode.length === 2 ? countryCode : null)
    || COUNTRY_CODES[country] || '').toLowerCase();
  if (!code) return '<span class="flag-fallback">🌍</span>';
  return `<img src="https://flagcdn.com/20x15/${code}.png"
       srcset="https://flagcdn.com/40x30/${code}.png 2x"
       alt="${code.toUpperCase()}" class="flag-img"
       onerror="this.outerHTML='<span class=flag-fallback>🌍</span>'">`;
}

export const flagImg = flagHTML;

export function flagText(country, countryCode) {
  const code = ((countryCode && countryCode.length === 2 ? countryCode : null)
    || COUNTRY_CODES[country] || '').toUpperCase();
  return code ? `[${code}]` : '';
}

export function catLabel(c) {
  if (!c) return '';
  return c.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function renderFormattedNotes(text) {
  if (!text) return '';
  let s = String(text);

  // Normalize allowed HTML tags to markdown tokens or safe tags:
  s = s
    .replace(/<strong\b[^>]*>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<b\b[^>]*>(.*?)<\/b>/gi, '**$1**')
    .replace(/<em\b[^>]*>(.*?)<\/em>/gi, '*$1*')
    .replace(/<i\b[^>]*>(.*?)<\/i>/gi, '*$1*')
    .replace(/<u\b[^>]*>(.*?)<\/u>/gi, '<u>$1</u>')
    .replace(/<del\b[^>]*>(.*?)<\/del>/gi, '~~$1~~')
    .replace(/<s\b[^>]*>(.*?)<\/s>/gi, '~~$1~~')
    .replace(/<strike\b[^>]*>(.*?)<\/strike>/gi, '~~$1~~');

  // Escape HTML characters
  s = s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  // Bold: **text**
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic: *text*
  s = s.replace(/(^|[^\*])\*([^\*\n]+?)\*([^\*]|$)/g, '$1<em>$2</em>$3');
  // Underline: __text__ or &lt;u&gt;text&lt;/u&gt;
  s = s.replace(/__(.+?)__/g, '<u>$1</u>');
  s = s.replace(/&lt;u&gt;(.+?)&lt;\/u&gt;/gi, '<u>$1</u>');
  // Strikeout: ~~text~~ or &lt;s&gt;text&lt;/s&gt;
  s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
  s = s.replace(/&lt;s&gt;(.+?)&lt;\/s&gt;/gi, '<del>$1</del>');
  s = s.replace(/&lt;del&gt;(.+?)&lt;\/del&gt;/gi, '<del>$1</del>');
  s = s.replace(/&lt;strike&gt;(.+?)&lt;\/strike&gt;/gi, '<del>$1</del>');

  // Newlines to <br>
  s = s.replace(/\r?\n/g, '<br>');

  return s;
}

// Global browser window bindings
if (typeof window !== 'undefined') {
  window.esc = esc;
  window.renderFormattedNotes = renderFormattedNotes;
  window.formatEur = formatEur;
  window.formatBytes = formatBytes;
  window.formatFileSize = formatFileSize;
  window.getFileMeta = getFileMeta;
  window.isNarrowScreen = isNarrowScreen;
  window.getDocumentBaseUrl = getDocumentBaseUrl;
  window.getRemoteApiBaseUrl = getRemoteApiBaseUrl;
  window.buildAttachmentDownloadUrl = buildAttachmentDownloadUrl;
  window.buildAttachmentRawUrl = buildAttachmentRawUrl;
  window.buildDocViewerUrl = buildDocViewerUrl;
  window.formatCurrency = formatCurrency;
  window.getCurrencySymbol = getCurrencySymbol;
  window.getTodayDateString = getTodayDateString;
  window.safeMapsUrl = safeMapsUrl;
  window.safeExternalUrl = safeExternalUrl;
  window.wazeUrl = wazeUrl;
  window.genId = genId;
  window.COUNTRY_CODES = COUNTRY_CODES;
  window.flagHTML = flagHTML;
  window.flagImg = flagHTML;
  window.flagText = flagText;
  window.catLabel = catLabel;
}

