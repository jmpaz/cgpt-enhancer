// ==UserScript==
// @name         ChatGPT: quick access
// @version      0.1.0
// @description  Press F2 / double-Shift to open model selector; Shift+F2 / Alt+double-Shift to open reasoning effort selector
// @match        https://chatgpt.com/*
// @run-at       document-idle
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
