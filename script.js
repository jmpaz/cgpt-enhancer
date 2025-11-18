// ==UserScript==
// @name         ChatGPT enhancements
// @version      0.1.1
// @description  Keyboard shortcuts: open model / reasoning effort picker (double-shift / alt+double-shift), memory (F9 to check status, F10 to toggle)
// @match        https://chatgpt.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  // --- Configuration ------------------------------------------------------
  const CONFIG = {
    menus: {
      enableF2: true,
      enableShiftF2: true,
      enableDoubleShift: true,
      enableAltDoubleShift: true,
      doubleShiftWindowMs: 350,
    },
    memory: {
      hotkeysEnabled: true,
      toggleKey: 'F10',
      statusKey: 'F9',
      features: ['sunshine', 'moonshine', 'golden_hour'],
      settingsEndpoint: '/backend-api/settings/user',
      mock: false,
    },
    toast: {
      id: 'cgpt-memory-toast',
      styleId: 'cgpt-memory-toast-style',
    },
    linkCleaning: {
      targetKey: 'utm_source',
      targetValue: 'chatgpt.com',
    },
    tree: {
      maxDepth: 10,
    },
  };

  const state = {
    authHeader: null,
    memoryValue: CONFIG.memory.mock ? false : null,
    memoryTogglePromise: null,
    toastTimer: null,
    lastShiftTimestamp: 0,
    lastAltShiftTimestamp: 0,
  };

  const origFetch = window.fetch.bind(window);

  // --- Logging ------------------------------------------------------------
  const LOG_PREFIX = '[cgpt-enhancer]';
  const logInfo = (event, payload) => {
    if (payload !== undefined) console.info(LOG_PREFIX, event, payload);
    else console.info(LOG_PREFIX, event);
  };
  const logWarn = (event, payload) => {
    if (payload !== undefined) console.warn(LOG_PREFIX, event, payload);
    else console.warn(LOG_PREFIX, event);
  };
  const logError = (event, error, payload) => {
    if (payload !== undefined) console.error(LOG_PREFIX, event, payload, error);
    else console.error(LOG_PREFIX, event, error);
  };

  // --- Generic utilities --------------------------------------------------
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const searchTree = (node, matcher, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > CONFIG.tree.maxDepth) return undefined;
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

  // --- Auth helpers -------------------------------------------------------
  const setAuthHeaderValue = (value) => {
    if (!value || typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed) return;
    state.authHeader = /^bearer\s/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`;
  };

  const findAccessTokenInNextData = () =>
    searchTree(window.__NEXT_DATA__, (key, value) => {
      if (typeof key !== 'string' || typeof value !== 'string') return undefined;
      const lower = key.toLowerCase();
      if (
        lower.includes('authorization') ||
        lower.includes('accesstoken') ||
        lower.includes('access_token')
      ) {
        return value;
      }
      return undefined;
    });

  const primeAuthHeader = () => {
    if (CONFIG.memory.mock) return;
    const token = findAccessTokenInNextData();
    if (token) setAuthHeaderValue(token);
  };

  const waitForAuthHeader = async (timeoutMs = 2500) => {
    if (CONFIG.memory.mock) return null;
    if (state.authHeader) return state.authHeader;
    primeAuthHeader();
    if (state.authHeader) return state.authHeader;
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
      await delay(50);
      if (state.authHeader) return state.authHeader;
    }
    return null;
  };

  const ensureAuthHeaderAvailable = async () => {
    if (CONFIG.memory.mock) return null;
    const header = await waitForAuthHeader();
    if (!header) throw new Error('Authorization header unavailable');
    return header;
  };

  const captureAuthFromHeaders = (headersLike) => {
    if (CONFIG.memory.mock) return;
    try {
      if (!headersLike) return;
      const headers = headersLike instanceof Headers ? headersLike : new Headers(headersLike);
      const value = headers.get('authorization');
      if (value) setAuthHeaderValue(value);
    } catch {
      // ignore failures
    }
  };

  const installFetchHook = () => {
    if (CONFIG.memory.mock) return;
    window.fetch = function (input, init = {}) {
      try {
        if (input instanceof Request) captureAuthFromHeaders(input.headers);
        if (init && init.headers) captureAuthFromHeaders(init.headers);
      } catch {
        // ignore capture issues
      }
      return origFetch(input, init);
    };
  };

  primeAuthHeader();
  installFetchHook();

  // --- Toast manager ------------------------------------------------------
  const ensureToastStyle = () => {
    if (document.getElementById(CONFIG.toast.styleId)) return;
    const style = document.createElement('style');
    style.id = CONFIG.toast.styleId;
    style.textContent = `
      #${CONFIG.toast.id} {
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
      #${CONFIG.toast.id}.visible {
        opacity: 1;
        transform: translateY(0);
      }
      #${CONFIG.toast.id}.state-on {
        background: #0d7a3d;
      }
      #${CONFIG.toast.id}.state-off {
        background: #7a1d2c;
      }
      #${CONFIG.toast.id}.state-error {
        background: #b05000;
      }
      #${CONFIG.toast.id}.state-neutral {
        background: #4c4f58;
      }
      #${CONFIG.toast.id}.state-status-on {
        background: #1f6d4a;
      }
      #${CONFIG.toast.id}.state-status-off {
        background: #4c4f58;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  };

  const ensureToastElement = () => {
    ensureToastStyle();
    let toast = document.getElementById(CONFIG.toast.id);
    if (!toast) {
      toast = document.createElement('div');
      toast.id = CONFIG.toast.id;
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      (document.body || document.documentElement).appendChild(toast);
    }
    return toast;
  };

  const showToast = (text, variant = 'neutral') => {
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
    if (variant) toast.classList.add(`state-${variant}`);
    void toast.offsetWidth;
    toast.classList.add('visible');
    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => {
      toast.classList.remove('visible');
    }, 2200);
  };

  // --- Memory helpers -----------------------------------------------------
  const findFeatureInTree = (node, feature, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > CONFIG.tree.maxDepth) return undefined;
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
    const data = window.__NEXT_DATA__;
    if (!data) return undefined;
    for (const feature of CONFIG.memory.features) {
      const value = findFeatureInTree(data, feature);
      if (typeof value === 'boolean') return value;
    }
    return undefined;
  };

  const fetchUserSettings = async () => {
    if (CONFIG.memory.mock) return undefined;
    const header = await waitForAuthHeader();
    if (!header) {
      logWarn('settings.fetch.no_auth');
      return undefined;
    }
    try {
      const res = await origFetch(CONFIG.memory.settingsEndpoint, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json', authorization: header },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json().catch(() => undefined);
    } catch (err) {
      logWarn('settings.fetch.failed', err);
      return undefined;
    }
  };

  const loadMemoryState = async () => {
    const fromPage = getMemoryStateFromPage();
    if (typeof fromPage === 'boolean') return fromPage;
    const settings = await fetchUserSettings();
    if (settings) {
      for (const feature of CONFIG.memory.features) {
        const value = findFeatureInTree(settings, feature);
        if (typeof value === 'boolean') return value;
      }
    }
    return undefined;
  };

  const ensureMemoryState = async () => {
    if (CONFIG.memory.mock) {
      if (typeof state.memoryValue !== 'boolean') state.memoryValue = false;
      return state.memoryValue;
    }
    if (typeof state.memoryValue === 'boolean') return state.memoryValue;
    const discovered = await loadMemoryState();
    if (typeof discovered === 'boolean') {
      state.memoryValue = discovered;
      return state.memoryValue;
    }
    throw new Error('Unable to determine memory state');
  };

  const setFeature = async (feature, enabled) => {
    await ensureAuthHeaderAvailable();
    if (CONFIG.memory.mock) return;
    const params = new URLSearchParams({ feature, value: String(Boolean(enabled)) });
    const res = await origFetch(`/backend-api/settings/account_user_setting?${params}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        authorization: state.authHeader,
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to set ${feature}: ${res.status} ${text}`);
    }
  };

  const applyMemoryState = async (enabled) => {
    if (CONFIG.memory.mock) {
      state.memoryValue = Boolean(enabled);
      showToast(
        state.memoryValue ? 'Memory enabled (mock)' : 'Memory disabled (mock)',
        state.memoryValue ? 'on' : 'off',
      );
      return;
    }
    await Promise.all(CONFIG.memory.features.map((feature) => setFeature(feature, enabled)));
    state.memoryValue = enabled;
    showToast(enabled ? 'Memory enabled' : 'Memory disabled', enabled ? 'on' : 'off');
  };

  const toggleMemory = () => {
    if (state.memoryTogglePromise) return state.memoryTogglePromise;
    state.memoryTogglePromise = (async () => {
      try {
        const current = await ensureMemoryState();
        const next = !current;
        await applyMemoryState(next);
        logInfo('memory.toggle', { from: current, to: next });
      } catch (err) {
        logError('memory.toggle_failed', err);
        showToast('Memory toggle failed', 'error');
      } finally {
        state.memoryTogglePromise = null;
      }
    })();
    return state.memoryTogglePromise;
  };

  const announceMemoryStatus = async () => {
    try {
      const current = await ensureMemoryState();
      showToast(
        current ? 'Memory currently enabled' : 'Memory currently disabled',
        current ? 'status-on' : 'status-off',
      );
      logInfo('memory.status', { enabled: current });
    } catch (err) {
      logError('memory.status_failed', err);
      const unavailable = err?.message?.includes('determine');
      showToast(
        unavailable ? 'Memory status unavailable' : 'Memory status check failed',
        unavailable ? 'neutral' : 'error',
      );
    }
  };

  // --- Link cleaning ------------------------------------------------------
  const isHttpUrl = (url) => url.protocol === 'http:' || url.protocol === 'https:';

  const stripTrackingParam = (urlLike) => {
    try {
      const url = new URL(urlLike, location.href);
      if (!isHttpUrl(url)) return urlLike;
      const params = new URLSearchParams(url.search);
      let removed = false;
      const rewritten = new URLSearchParams();
      params.forEach((value, key) => {
        const drop =
          key.toLowerCase() === CONFIG.linkCleaning.targetKey.toLowerCase() &&
          value.toLowerCase() === CONFIG.linkCleaning.targetValue.toLowerCase();
        if (drop) removed = true;
        else rewritten.append(key, value);
      });
      if (!removed) return urlLike;
      url.search = rewritten.toString() ? `?${rewritten}` : '';
      return url.toString();
    } catch {
      return urlLike;
    }
  };

  const processAnchor = (anchor) => {
    if (!anchor || !anchor.href) return;
    if (!/utm_source=chatgpt\.com/i.test(anchor.href)) return;
    const cleaned = stripTrackingParam(anchor.href);
    if (cleaned !== anchor.href) anchor.href = cleaned;
  };

  const sweepAnchors = (root = document) => {
    if (!root.querySelectorAll) return;
    root.querySelectorAll('a[href]').forEach(processAnchor);
  };

  const handlePreNavEvent = (event) => {
    const target = event.target;
    const anchor = target && target.closest ? target.closest('a[href]') : null;
    if (anchor) processAnchor(anchor);
  };

  const startLinkCleaning = () => {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType !== 1) return;
            if (node.matches && node.matches('a[href]')) processAnchor(node);
            if (node.querySelectorAll) node.querySelectorAll('a[href]').forEach(processAnchor);
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

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href'],
    });

    sweepAnchors(document);

    document.addEventListener('click', handlePreNavEvent, true);
    document.addEventListener('auxclick', handlePreNavEvent, true);
    document.addEventListener('contextmenu', handlePreNavEvent, true);
  };

  try {
    const originalOpen = window.open;
    if (typeof originalOpen === 'function') {
      window.open = function (url, name, specs) {
        if (typeof url === 'string') url = stripTrackingParam(url);
        return originalOpen.call(this, url, name, specs);
      };
    }
  } catch {
    // ignore
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startLinkCleaning, { once: true });
  } else {
    startLinkCleaning();
  }

  // --- Menu helpers -------------------------------------------------------
  const isVisible = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const cs = getComputedStyle(el);
    return (
      cs.display !== 'none' &&
      cs.visibility !== 'hidden' &&
      cs.opacity !== '0' &&
      el.offsetParent !== null &&
      el.getClientRects().length > 0
    );
  };

  const pointerClick = (el) => {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const opts = {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      view: window,
    };
    el.dispatchEvent(new PointerEvent('pointerover', opts));
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
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

  const getModelButton = () => {
    const list = [
      ...document.querySelectorAll('button[data-testid="model-switcher-dropdown-button"]'),
    ].filter(isVisible);
    for (const button of list) {
      const rect = button.getBoundingClientRect();
      const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (top === button || button.contains(top)) return button;
    }
    if (list[0]) return list[0];
    return (
      [...document.querySelectorAll('button[aria-haspopup="menu"]')].find(
        (button) =>
          (button.getAttribute('aria-label') || '').startsWith('Model selector') &&
          isVisible(button),
      ) || null
    );
  };

  const getThinkingButton = () => {
    const matchesLabel = (el) => {
      const text = (el.textContent || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (text.includes('thinking')) return true;
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      return aria.includes('thinking');
    };
    const list = [
      ...document.querySelectorAll(
        'button.__composer-pill, button[data-testid="composer-pill-thinking"]',
      ),
    ].filter(isVisible);
    for (const button of list) {
      if (!matchesLabel(button)) continue;
      const rect = button.getBoundingClientRect();
      const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (top === button || button.contains(top)) return button;
    }
    return (
      [...document.querySelectorAll('button[aria-haspopup="menu"]')].find(
        (button) => matchesLabel(button) && isVisible(button),
      ) || null
    );
  };

  const triggerButton = (button) => {
    if (!button) return false;
    const before = button.getAttribute('aria-expanded') ?? button.dataset.state;
    button.focus();
    button.click();
    const after = button.getAttribute('aria-expanded') ?? button.dataset.state;
    if (before === after) pointerClick(button);
    return true;
  };

  const openModelMenu = (trigger = 'unknown') => {
    const button = getModelButton();
    if (!button) {
      logWarn('menu.model.missing', { trigger });
      return false;
    }
    triggerButton(button);
    logInfo('menu.model.open', { trigger });
    return true;
  };

  const openThinkingMenu = (trigger = 'unknown') => {
    const button = getThinkingButton();
    if (!button) {
      logWarn('menu.thinking.missing', { trigger });
      return false;
    }
    triggerButton(button);
    logInfo('menu.thinking.open', { trigger });
    return true;
  };

  window.__modelMenu = () => openModelMenu('window-call');
  window.__thinkingMenu = () => openThinkingMenu('window-call');

  // --- Key handling -------------------------------------------------------
  const handleMenuHotkey = (event, action) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    action();
  };

  const onKeyDown = (event) => {
    const now = performance.now();

    if (
      CONFIG.memory.hotkeysEnabled &&
      event.key === CONFIG.memory.statusKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.shiftKey
    ) {
      handleMenuHotkey(event, () => announceMemoryStatus());
      return;
    }

    if (
      CONFIG.memory.hotkeysEnabled &&
      event.key === CONFIG.memory.toggleKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.shiftKey
    ) {
      handleMenuHotkey(event, () => toggleMemory());
      return;
    }

    if (
      CONFIG.menus.enableF2 &&
      event.key === 'F2' &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.shiftKey
    ) {
      if (openModelMenu('f2')) handleMenuHotkey(event, () => {});
      return;
    }

    if (
      CONFIG.menus.enableShiftF2 &&
      event.key === 'F2' &&
      event.shiftKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey
    ) {
      if (openThinkingMenu('shift-f2')) handleMenuHotkey(event, () => {});
      return;
    }

    if (
      CONFIG.menus.enableAltDoubleShift &&
      event.key === 'Shift' &&
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      if (now - state.lastAltShiftTimestamp <= CONFIG.menus.doubleShiftWindowMs && !event.repeat) {
        state.lastAltShiftTimestamp = 0;
        state.lastShiftTimestamp = 0;
        if (openThinkingMenu('alt-double-shift')) handleMenuHotkey(event, () => {});
      } else {
        state.lastAltShiftTimestamp = now;
      }
      return;
    }

    if (
      CONFIG.menus.enableDoubleShift &&
      event.key === 'Shift' &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey
    ) {
      if (now - state.lastShiftTimestamp <= CONFIG.menus.doubleShiftWindowMs && !event.repeat) {
        if (openModelMenu('double-shift')) handleMenuHotkey(event, () => {});
        state.lastShiftTimestamp = 0;
      } else {
        state.lastShiftTimestamp = now;
      }
      return;
    }
  };

  window.addEventListener('keydown', onKeyDown, { capture: true, passive: false });
})();
