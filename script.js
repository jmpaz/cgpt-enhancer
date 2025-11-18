// ==UserScript==
// @name         ChatGPT enhancements
// @version      0.1.0
// @description  Press F2 / double-Shift to open model selector; Shift+F2 / Alt+double-Shift to open reasoning effort selector
// @match        https://chatgpt.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  // --- Triggers ---
  const ENABLE_F2 = true;
  const ENABLE_DOUBLE_SHIFT = true;
  const ENABLE_SHIFT_F2 = true;
  const ENABLE_ALT_DOUBLE_SHIFT = true;
  const DOUBLE_SHIFT_MS = 350;

  const ENABLE_MEMORY_TOGGLE = true;
  const MEMORY_TOGGLE_KEY = 'F10';
  const MEMORY_STATUS_KEY = 'F9';
  const MEMORY_FEATURES = ['sunshine', 'moonshine', 'golden_hour'];
  const TOAST_ID = 'cgpt-memory-toast';
  const TOAST_STYLE_ID = 'cgpt-memory-toast-style';
  const MEMORY_TOGGLE_MOCK = false; // Set to true to force local-only state
  const MEMORY_TOGGLE_INITIAL_STATE = true; // Only used when mock mode is on

  const origFetch = window.fetch.bind(window);
  let authHeader = null;
  let memoryState = MEMORY_TOGGLE_MOCK ? Boolean(MEMORY_TOGGLE_INITIAL_STATE) : null;
  let memoryTogglePromise = null;
  let toastTimer = null;

  const MAX_TREE_DEPTH = 10;

  const setAuthHeaderValue = (value) => {
    if (!value || typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed) return;
    const normalized = /^bearer\s/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`;
    authHeader = normalized;
  };

  const searchTree = (node, matcher, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > MAX_TREE_DEPTH) return undefined;
    for (const [key, value] of Object.entries(node)) {
      const match = matcher(key, value);
      if (match !== undefined) return match;
      if (value && typeof value === 'object') {
        const nested = searchTree(value, matcher, depth + 1);
        if (nested !== undefined) return nested;
      }
    }
    return undefined;
  };

  const findAccessTokenInNextData = () => {
    const nextData = window.__NEXT_DATA__;
    if (!nextData) return undefined;
    return searchTree(nextData, (key, value) => {
      if (typeof key !== 'string' || typeof value !== 'string') return undefined;
      const lower = key.toLowerCase();
      if (lower.includes('authorization') || lower.includes('accesstoken') || lower.includes('access_token')) {
        return value;
      }
      return undefined;
    });
  };

  const primeAuthHeaderFromNextData = () => {
    const token = findAccessTokenInNextData();
    if (token) setAuthHeaderValue(token);
  };

  primeAuthHeaderFromNextData();

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const waitForAuthHeader = async (timeoutMs = 2500) => {
    if (authHeader) return authHeader;
    primeAuthHeaderFromNextData();
    if (authHeader) return authHeader;
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
      await delay(50);
      if (authHeader) return authHeader;
    }
    return null;
  };

  const ensureAuthHeaderAvailable = async () => {
    const header = await waitForAuthHeader();
    if (!header) throw new Error('Authorization header unavailable');
    return header;
  };

  const captureAuthFromHeaders = (headersLike) => {
    try {
      if (!headersLike) return;
      const headers =
        headersLike instanceof Headers ? headersLike : new Headers(headersLike);
      const value = headers.get('authorization');
      if (value) setAuthHeaderValue(value);
    } catch {
      // Ignore header parsing failures
    }
  };

  window.fetch = function (input, init = {}) {
    try {
      if (input instanceof Request) captureAuthFromHeaders(input.headers);
      if (init && init.headers) captureAuthFromHeaders(init.headers);
    } catch {
      // Ignore capture issues
    }
    return origFetch(input, init);
  };

  const ensureToastStyle = () => {
    if (document.getElementById(TOAST_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = TOAST_STYLE_ID;
    style.textContent = `
      #${TOAST_ID} {
        position: fixed;
        right: 24px;
        top: 64px;
        padding: 0 16px;
        min-height: 36px;
        border-radius: 999px;
        font: 600 13px/1.2 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        background: rgba(32, 33, 35, 0.92);
        box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
        opacity: 0;
        transform: translateY(8px);
        transition: opacity 150ms ease, transform 150ms ease;
        pointer-events: none;
        z-index: 2147483647;
      }
      #${TOAST_ID}.visible {
        opacity: 1;
        transform: translateY(0);
      }
      #${TOAST_ID}.state-on {
        background: #0d7a3d;
      }
      #${TOAST_ID}.state-off {
        background: #7a1d2c;
      }
      #${TOAST_ID}.state-error {
        background: #b05000;
      }
      #${TOAST_ID}.state-neutral {
        background: #4c4f58;
      }
      #${TOAST_ID}.state-status-on {
        background: #1f6d4a;
      }
      #${TOAST_ID}.state-status-off {
        background: #4c4f58;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  };

  const ensureToastElement = () => {
    ensureToastStyle();
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement('div');
      toast.id = TOAST_ID;
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      (document.body || document.documentElement).appendChild(toast);
    }
    return toast;
  };

  const showMemoryToast = (text, variant = 'neutral') => {
    const toast = ensureToastElement();
    if (!toast) return;
    toast.textContent = text;
    toast.classList.remove(
      'state-on',
      'state-off',
      'state-error',
      'state-neutral',
      'state-status-on',
      'state-status-off',
      'visible',
    );
    if (variant) {
      toast.classList.add(`state-${variant}`);
    }
    void toast.offsetWidth;
    toast.classList.add('visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.classList.remove('visible');
    }, 2200);
  };

  const buildHeaders = (includeContentType = true) => {
    const headers = { Accept: 'application/json' };
    if (includeContentType) headers['Content-Type'] = 'application/json';
    if (authHeader) headers.authorization = authHeader;
    return headers;
  };

  const coerceBool = (value) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (value.toLowerCase() === 'true') return true;
      if (value.toLowerCase() === 'false') return false;
    }
    if (typeof value === 'number') {
      if (value === 1) return true;
      if (value === 0) return false;
    }
    if (value && typeof value === 'object') {
      if ('value' in value) return coerceBool(value.value);
      if ('enabled' in value) return coerceBool(value.enabled);
    }
    return undefined;
  };

  const readFeatureFromPayload = (payload) =>
    coerceBool(payload) ??
    coerceBool(payload?.result) ??
    coerceBool(payload?.setting) ??
    coerceBool(payload?.data);

  const findFeatureInTree = (node, feature, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > MAX_TREE_DEPTH) return undefined;
    if (Object.prototype.hasOwnProperty.call(node, feature)) {
      const candidate = readFeatureFromPayload(node[feature]);
      if (typeof candidate === 'boolean') return candidate;
    }
    for (const value of Object.values(node)) {
      const result = findFeatureInTree(value, feature, depth + 1);
      if (typeof result === 'boolean') return result;
    }
    return undefined;
  };

  const getMemoryStateFromPage = () => {
    const nextData = window.__NEXT_DATA__;
    if (!nextData) return undefined;
    for (const feature of MEMORY_FEATURES) {
      const value = findFeatureInTree(nextData, feature);
      if (typeof value === 'boolean') return value;
    }
    return undefined;
  };

  const SETTINGS_ENDPOINTS = ['/backend-api/settings/user'];

  const fetchUserSettings = async () => {
    const header = await waitForAuthHeader();
    if (!header) {
      console.warn('[cgpt-enhancer] No auth header available for user settings fetch');
      return undefined;
    }
    let lastError = null;
    for (const endpoint of SETTINGS_ENDPOINTS) {
      try {
        const res = await origFetch(endpoint, {
          method: 'GET',
          credentials: 'include',
          headers: buildHeaders(false),
        });
        if (!res.ok) {
          lastError = new Error(`HTTP ${res.status}`);
          continue;
        }
        const data = await res.json().catch(() => undefined);
        if (data) return data;
      } catch (err) {
        lastError = err;
      }
    }
    if (lastError) {
      console.warn('[cgpt-enhancer] Failed to load user settings', lastError);
    }
    return undefined;
  };

  const loadMemoryState = async () => {
    const fromPage = getMemoryStateFromPage();
    if (typeof fromPage === 'boolean') return fromPage;
    const settings = await fetchUserSettings();
    if (settings) {
      for (const feature of MEMORY_FEATURES) {
        const value = findFeatureInTree(settings, feature);
        if (typeof value === 'boolean') return value;
      }
    }
    return undefined;
  };

  const ensureMemoryState = async () => {
    if (MEMORY_TOGGLE_MOCK) {
      if (typeof memoryState !== 'boolean') {
        memoryState = Boolean(MEMORY_TOGGLE_INITIAL_STATE);
      }
      return memoryState;
    }
    if (typeof memoryState === 'boolean') return memoryState;
    const discovered = await loadMemoryState();
    if (typeof discovered === 'boolean') {
      memoryState = discovered;
      return memoryState;
    }
    throw new Error('Unable to determine memory state');
  };

  const setFeature = async (feature, enabled) => {
    await ensureAuthHeaderAvailable();
    const params = new URLSearchParams({
      feature,
      value: String(Boolean(enabled)),
    });
    const res = await origFetch(`/backend-api/settings/account_user_setting?${params}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: buildHeaders(true),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to set ${feature}: ${res.status} ${text}`);
    }
  };

  const applyMemoryState = async (enabled) => {
    if (MEMORY_TOGGLE_MOCK) {
      memoryState = Boolean(enabled);
      showMemoryToast(
        memoryState ? 'Memory enabled (mock)' : 'Memory disabled (mock)',
        memoryState ? 'on' : 'off',
      );
      return;
    }
    await Promise.all(MEMORY_FEATURES.map((feature) => setFeature(feature, enabled)));
    memoryState = enabled;
    showMemoryToast(enabled ? 'Memory enabled' : 'Memory disabled', enabled ? 'on' : 'off');
  };

  const toggleMemory = () => {
    if (memoryTogglePromise) return memoryTogglePromise;
    memoryTogglePromise = (async () => {
      try {
        const current = await ensureMemoryState();
        const next = !current;
        await applyMemoryState(next);
        logStatus('memory toggled', { from: current, to: next });
      } catch (err) {
        logError('memory toggle failed', err);
        showMemoryToast('Memory toggle failed', 'error');
      } finally {
        memoryTogglePromise = null;
      }
    })();
    return memoryTogglePromise;
  };

  const logStatus = (message, ...rest) => console.log('[cgpt-enhancer]', message, ...rest);
  const logError = (message, err) => console.error('[cgpt-enhancer]', message, err);

  const announceMemoryStatus = async () => {
    try {
      const current = await ensureMemoryState();
      showMemoryToast(
        current ? 'Memory currently enabled' : 'Memory currently disabled',
        current ? 'status-on' : 'status-off',
      );
      logStatus('memory status', { enabled: current });
    } catch (err) {
      logError('memory status check failed', err);
      const msg = err?.message?.includes('determine')
        ? 'Memory status unavailable'
        : 'Memory status check failed';
      showMemoryToast(msg, err?.message?.includes('determine') ? 'neutral' : 'error');
    }
  };

  // --- Link cleaning ---
  const TARGET_KEY = 'utm_source';
  const TARGET_VALUE = 'chatgpt.com';

  const isHttp = (url) => url.protocol === 'http:' || url.protocol === 'https:';

  const stripUtmSource = (urlLike) => {
    try {
      const url = new URL(urlLike, location.href);
      if (!isHttp(url)) return urlLike;

      const params = new URLSearchParams(url.search);
      let removed = false;
      const newParams = new URLSearchParams();

      params.forEach((value, key) => {
        const drop =
          key.toLowerCase() === TARGET_KEY.toLowerCase() &&
          value.toLowerCase() === TARGET_VALUE.toLowerCase();
        if (drop) {
          removed = true;
        } else {
          newParams.append(key, value);
        }
      });

      if (!removed) return urlLike;

      url.search = newParams.toString() ? `?${newParams}` : '';
      return url.toString();
    } catch {
      return urlLike;
    }
  };

  const processAnchor = (anchor) => {
    if (!anchor || !anchor.href) return;
    if (!/utm_source=chatgpt\.com/i.test(anchor.href)) return;
    const cleaned = stripUtmSource(anchor.href);
    if (cleaned !== anchor.href) anchor.href = cleaned;
  };

  const sweep = (root = document) => {
    if (!root.querySelectorAll) return;
    root.querySelectorAll('a[href]').forEach(processAnchor);
  };

  const handlePreNavEvent = (event) => {
    const target = event.target;
    const anchor = target && target.closest ? target.closest('a[href]') : null;
    if (anchor) processAnchor(anchor);
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          if (node.matches && node.matches('a[href]')) processAnchor(node);
          if (node.querySelectorAll) {
            node.querySelectorAll('a[href]').forEach(processAnchor);
          }
        });
      } else if (
        mutation.type === 'attributes' &&
        mutation.target &&
        mutation.target.matches('a[href]')
      ) {
        processAnchor(mutation.target);
      }
    }
  });

  const startLinkCleaning = () => {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href'],
    });

    sweep(document);

    document.addEventListener('click', handlePreNavEvent, true);
    document.addEventListener('auxclick', handlePreNavEvent, true);
    document.addEventListener('contextmenu', handlePreNavEvent, true);
  };

  try {
    const originalOpen = window.open;
    if (typeof originalOpen === 'function') {
      window.open = function (url, name, specs) {
        if (typeof url === 'string') {
          url = stripUtmSource(url);
        }
        return originalOpen.call(this, url, name, specs);
      };
    }
  } catch {
    // Ignore if sandboxed or blocked by CSP—anchor cleaning still works.
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startLinkCleaning, { once: true });
  } else {
    startLinkCleaning();
  }

  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const cs = getComputedStyle(el);
    return (
      cs.display !== 'none' &&
      cs.visibility !== 'hidden' &&
      cs.opacity !== '0' &&
      el.offsetParent !== null &&
      el.getClientRects().length > 0
    );
  };

  const getModelButton = () => {
    const list = [
      ...document.querySelectorAll('button[data-testid="model-switcher-dropdown-button"]'),
    ].filter(isVisible);
    for (const b of list) {
      const r = b.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (top === b || b.contains(top)) return b; // topmost candidate
    }
    if (list[0]) return list[0];
    return (
      [...document.querySelectorAll('button[aria-haspopup="menu"]')].find(
        (b) => (b.getAttribute('aria-label') || '').startsWith('Model selector') && isVisible(b),
      ) || null
    );
  };

  const getThinkingButton = () => {
    const labelMatch = (el) => {
      const text = (el.textContent || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (text.includes('thinking')) return true;
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      return aria.includes('thinking');
    };
    const buttonList = [
      ...document.querySelectorAll(
        'button.__composer-pill, button[data-testid="composer-pill-thinking"]',
      ),
    ].filter(isVisible);
    for (const b of buttonList) {
      if (!labelMatch(b)) continue;
      const r = b.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (top === b || b.contains(top)) return b;
    }
    const fallback = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find(
      (b) => labelMatch(b) && isVisible(b),
    );
    return fallback || null;
  };

  const pointerClick = (el) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2,
      y = r.top + r.height / 2;
    const O = {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      view: window,
    };
    el.dispatchEvent(new PointerEvent('pointerover', O));
    el.dispatchEvent(new PointerEvent('pointerdown', O));
    el.dispatchEvent(new PointerEvent('pointerup', O));
    el.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        view: window,
      }),
    );
  };

  const openModelMenu = () => {
    const b = getModelButton();
    if (!b) return false;
    const before = b.getAttribute('aria-expanded') ?? b.dataset.state; // 'true/false' or 'open/closed'
    b.focus();
    b.click();
    const after = b.getAttribute('aria-expanded') ?? b.dataset.state;
    if (before === after) pointerClick(b);
    return true;
  };

  window.__modelMenu = openModelMenu;
  const openThinkingMenu = () => {
    const b = getThinkingButton();
    if (!b) return false;
    const before = b.getAttribute('aria-expanded') ?? b.dataset.state;
    b.focus();
    b.click();
    const after = b.getAttribute('aria-expanded') ?? b.dataset.state;
    if (before === after) pointerClick(b);
    return true;
  };

  window.__thinkingMenu = openThinkingMenu;

  // --- Key handling ---
  let lastShift = 0;
  let lastAltShift = 0;
  const onKeyDown = (e) => {
    const now = performance.now();

    if (
      ENABLE_MEMORY_TOGGLE &&
      e.key === MEMORY_STATUS_KEY &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.metaKey &&
      !e.shiftKey
    ) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
      announceMemoryStatus();
      return;
    }

    if (
      ENABLE_MEMORY_TOGGLE &&
      e.key === MEMORY_TOGGLE_KEY &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.metaKey &&
      !e.shiftKey
    ) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
      toggleMemory();
      return;
    }

    // F2
    if (ENABLE_F2 && e.key === 'F2' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
      if (openModelMenu()) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
      }
      return;
    }

    // Shift+F2
    if (ENABLE_SHIFT_F2 && e.key === 'F2' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (openThinkingMenu()) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
      }
      return;
    }

    // double-shift
    if (ENABLE_ALT_DOUBLE_SHIFT && e.key === 'Shift' && e.altKey && !e.ctrlKey && !e.metaKey) {
      if (now - lastAltShift <= DOUBLE_SHIFT_MS && !e.repeat) {
        lastAltShift = 0;
        lastShift = 0;
        if (openThinkingMenu()) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation?.();
        }
      } else {
        lastAltShift = now;
      }
      return;
    }

    if (ENABLE_DOUBLE_SHIFT && e.key === 'Shift' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (now - lastShift <= DOUBLE_SHIFT_MS && !e.repeat) {
        if (openModelMenu()) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation?.();
        }
        lastShift = 0;
      } else {
        lastShift = now;
      }
      return;
    }
  };

  window.addEventListener('keydown', onKeyDown, { capture: true, passive: false });
})();
