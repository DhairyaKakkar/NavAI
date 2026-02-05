/**
 * NavAI — Content Script
 *
 * Injected into every page. Responsibilities:
 *   1. Extract a structured representation of interactive elements.
 *   2. Render a non‑intrusive overlay that highlights the target element.
 *   3. Detect when the user completes the suggested action.
 *   4. Detect SPA navigations (pushState / replaceState / popstate).
 */

import type { Message, PageData, PageElement, GuidanceStep, ElementRect } from './shared/types';

// ── Debug ────────────────────────────────────────────────────

const DEBUG = true;
const log = (...a: unknown[]) => { if (DEBUG) console.debug('[NavAI:cs]', ...a); };

// ════════════════════════════════════════════════════════════
//  DOM UTILITIES
// ════════════════════════════════════════════════════════════

function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const s = getComputedStyle(el);
  return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) >= 0.1;
}

function isDisabled(el: Element): boolean {
  return (el as HTMLInputElement).disabled === true ||
         el.getAttribute('aria-disabled') === 'true';
}

// ── Stable selector generator ────────────────────────────────

function cssSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const tid = el.getAttribute('data-testid');
  if (tid) return `[data-testid="${CSS.escape(tid)}"]`;
  const aria = el.getAttribute('aria-label');
  if (aria) return `[aria-label="${CSS.escape(aria)}"]`;
  const name = el.getAttribute('name');
  if (name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;

  // nth‑of‑type path
  const path: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== document.documentElement) {
    let seg = cur.tagName.toLowerCase();
    if (cur.id) { path.unshift(`#${CSS.escape(cur.id)}`); break; }
    const parent: Element | null = cur.parentElement;
    if (parent) {
      const tag = cur.tagName;
      const sibs = Array.from(parent.children).filter((c: Element) => c.tagName === tag);
      if (sibs.length > 1) seg += `:nth-of-type(${sibs.indexOf(cur) + 1})`;
    }
    path.unshift(seg);
    cur = parent;
  }
  return path.join(' > ');
}

function xpathOf(el: Element): string {
  if (el.id) return `//*[@id="${el.id}"]`;
  const segs: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === Node.ELEMENT_NODE) {
    let idx = 1;
    let sib = cur.previousElementSibling;
    while (sib) { if (sib.tagName === cur.tagName) idx++; sib = sib.previousElementSibling; }
    segs.unshift(`${cur.tagName.toLowerCase()}[${idx}]`);
    cur = cur.parentElement;
  }
  return '/' + segs.join('/');
}

function labelFor(el: Element): string | undefined {
  if (el.id) {
    const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (l?.textContent) return l.textContent.trim();
  }
  const pl = el.closest('label');
  if (pl?.textContent) return pl.textContent.trim();
  const prev = el.previousElementSibling;
  if (prev?.tagName === 'LABEL' && prev.textContent) return prev.textContent.trim();
  const by = el.getAttribute('aria-labelledby');
  if (by) { const r = document.getElementById(by); if (r?.textContent) return r.textContent.trim(); }
  return undefined;
}

// ════════════════════════════════════════════════════════════
//  PAGE EXTRACTION
// ════════════════════════════════════════════════════════════

function extractElements(): PageElement[] {
  const selectors = [
    'a[href]', 'button', 'input', 'textarea', 'select',
    '[role="button"]', '[role="link"]', '[role="tab"]',
    '[role="menuitem"]', '[tabindex="0"]',
  ];
  const set = new Set<Element>();
  for (const s of selectors) document.querySelectorAll(s).forEach(e => set.add(e));

  const out: PageElement[] = [];
  let idx = 0;
  for (const el of set) {
    const r = el.getBoundingClientRect();
    const pe: PageElement = {
      index: idx++,
      tag:         el.tagName.toLowerCase(),
      type:        el.getAttribute('type') ?? undefined,
      id:          el.id || undefined,
      name:        el.getAttribute('name') ?? undefined,
      ariaLabel:   el.getAttribute('aria-label') ?? undefined,
      text:        (el.textContent ?? '').trim().substring(0, 200),
      placeholder: el.getAttribute('placeholder') ?? undefined,
      dataTestId:  el.getAttribute('data-testid') ?? undefined,
      role:        el.getAttribute('role') ?? undefined,
      href:        (el as HTMLAnchorElement).href || undefined,
      cssSelector: cssSelector(el),
      xpath:       xpathOf(el),
      rect: {
        top:    r.top  + scrollY,
        left:   r.left + scrollX,
        width:  r.width,
        height: r.height,
      },
      isVisible:  isVisible(el),
      isDisabled: isDisabled(el),
    };
    if (['input', 'textarea', 'select'].includes(pe.tag)) {
      pe.formContext = {
        label:     labelFor(el),
        fieldType: el.getAttribute('type') ?? el.tagName.toLowerCase(),
      };
    }
    out.push(pe);
  }
  return out;
}

function extractText(): string {
  const parts: string[] = [];
  let len = 0;
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      if (['SCRIPT','STYLE','NOSCRIPT','SVG'].includes(p.tagName)) return NodeFilter.FILTER_REJECT;
      const t = n.textContent?.trim();
      if (!t || t.length < 2) return NodeFilter.FILTER_REJECT;
      if (!isVisible(p)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  while (walk.nextNode() && len < 2000) {
    const t = walk.currentNode.textContent!.trim();
    parts.push(t);
    len += t.length;
  }
  return parts.join(' ').substring(0, 2000);
}

function extractPage(): PageData {
  return {
    url:      location.href,
    title:    document.title,
    elements: extractElements(),
    pageText: extractText(),
  };
}

// ════════════════════════════════════════════════════════════
//  OVERLAY
// ════════════════════════════════════════════════════════════

class Overlay {
  private host: HTMLDivElement | null = null;
  private shadow: ShadowRoot | null = null;
  private target: Element | null = null;
  private cleanup: (() => void) | null = null;       // action listener
  private scrollClean: (() => void) | null = null;    // scroll / resize
  private step: GuidanceStep | null = null;
  private stepNum = 0;

  /* ── lifecycle ─────────────────────────────────────────── */

  show(step: GuidanceStep, num: number) {
    this.hide();
    this.step    = step;
    this.stepNum = num;

    const el = this.resolve(step);
    if (!el) { log('Target element not found'); return; }
    this.target = el;

    this.paint(el, step, num);

    // scroll into view
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // keep overlay aligned on scroll / resize
    const repaint = throttle(() => {
      if (this.target) this.paint(this.target, this.step!, this.stepNum);
    }, 50);
    window.addEventListener('scroll', repaint, true);
    window.addEventListener('resize', repaint);
    this.scrollClean = () => {
      window.removeEventListener('scroll', repaint, true);
      window.removeEventListener('resize', repaint);
    };

    // listen for action completion
    this.listen(el, step);
  }

  hide() {
    this.stopListening();
    this.scrollClean?.();
    this.scrollClean = null;
    this.target = null;
    if (this.shadow) {
      for (const c of Array.from(this.shadow.children)) {
        if (c.tagName !== 'STYLE') c.remove();
      }
    }
  }

  destroy() {
    this.hide();
    this.host?.remove();
    this.host = null;
    this.shadow = null;
  }

  /* ── shadow‑DOM host ───────────────────────────────────── */

  private root(): ShadowRoot {
    if (this.shadow) return this.shadow;
    this.host = document.createElement('div');
    this.host.id = 'navai-host';
    Object.assign(this.host.style, {
      position: 'fixed', top: '0', left: '0',
      width: '0', height: '0',
      zIndex: '2147483647', pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    document.documentElement.appendChild(this.host);
    this.shadow = this.host.attachShadow({ mode: 'closed' });
    const s = document.createElement('style');
    s.textContent = OVERLAY_CSS;
    this.shadow.appendChild(s);
    return this.shadow;
  }

  /* ── render ────────────────────────────────────────────── */

  private paint(el: Element, step: GuidanceStep, num: number) {
    const sh = this.root();
    // clear previous frame (keep <style>)
    for (const c of Array.from(sh.children)) {
      if (c.tagName !== 'STYLE') c.remove();
    }

    const r   = el.getBoundingClientRect();
    const pad = 6;

    // spotlight — transparent box with huge box‑shadow that dims the rest
    const spot = mk('div', 'spotlight');
    pos(spot, r.top - pad, r.left - pad, r.width + pad * 2, r.height + pad * 2);
    sh.appendChild(spot);

    // pulsing ring
    const ring = mk('div', 'ring');
    pos(ring, r.top - pad - 3, r.left - pad - 3, r.width + pad * 2 + 6, r.height + pad * 2 + 6);
    sh.appendChild(ring);

    // instruction card
    const card = mk('div', 'card');
    card.innerHTML =
      `<div class="lbl">Step ${num}</div>` +
      `<div class="ins">${esc(step.instruction)}</div>` +
      `<span class="badge">${step.action}</span>`;

    const below = innerHeight - r.bottom > 120;
    const above = r.top > 120;

    const arrow = mk('div', 'arrow');

    if (below) {
      card.style.top  = `${r.bottom + pad + 14}px`;
      card.style.left = `${clamp(r.left, 12, innerWidth - 340)}px`;
      arrow.classList.add('arrow-up');
      arrow.style.top  = `${r.bottom + pad + 3}px`;
      arrow.style.left = `${r.left + r.width / 2 - 9}px`;
    } else if (above) {
      card.style.top  = `${r.top - pad - 130}px`;
      card.style.left = `${clamp(r.left, 12, innerWidth - 340)}px`;
      arrow.classList.add('arrow-down');
      arrow.style.top  = `${r.top - pad - 15}px`;
      arrow.style.left = `${r.left + r.width / 2 - 9}px`;
    } else {
      // side
      card.style.top  = `${clamp(r.top, 12, innerHeight - 140)}px`;
      card.style.left = `${r.right + 16}px`;
    }

    sh.appendChild(arrow);
    sh.appendChild(card);
  }

  /* ── element resolution ────────────────────────────────── */

  private resolve(step: GuidanceStep): Element | null {
    const t = step.target;

    // 1. CSS selector
    if (t.selector) {
      try {
        const el = document.querySelector(t.selector);
        if (el && isVisible(el)) return el;
      } catch { /* bad selector */ }
    }

    // 2. XPath
    if (t.strategy === 'xpath' && t.selector) {
      try {
        const res = document.evaluate(
          t.selector, document, null,
          XPathResult.FIRST_ORDERED_NODE_TYPE, null,
        );
        const el = res.singleNodeValue as Element | null;
        if (el && isVisible(el)) return el;
      } catch { /* */ }
    }

    // 3. text fallback
    if (t.textHint) return this.findByText(t.textHint);

    // 4. CSS without visibility gate
    if (t.selector) {
      try { return document.querySelector(t.selector); } catch { /* */ }
    }

    return null;
  }

  private findByText(text: string): Element | null {
    const norm = text.toLowerCase().trim();
    const all  = document.querySelectorAll(
      'a,button,input,textarea,select,[role="button"],[role="link"]',
    );
    // exact
    for (const el of all) if ((el.textContent ?? '').toLowerCase().trim() === norm && isVisible(el)) return el;
    // includes
    for (const el of all) if ((el.textContent ?? '').toLowerCase().includes(norm) && isVisible(el)) return el;
    // aria
    for (const el of all) {
      if ((el.getAttribute('aria-label') ?? '').toLowerCase().includes(norm) && isVisible(el)) return el;
    }
    return null;
  }

  /* ── action detection ──────────────────────────────────── */

  private listen(el: Element, step: GuidanceStep) {
    this.stopListening();
    const act = step.action;

    if (act === 'click') {
      const h = (e: Event) => {
        if (el.contains(e.target as Node) || el === e.target) {
          log('Click detected');
          this.stopListening();
          this.hide();
          send({ type: 'ACTION_COMPLETED', action: 'click' });
        }
      };
      document.addEventListener('click', h, true);
      this.cleanup = () => document.removeEventListener('click', h, true);

    } else if (act === 'type') {
      let timer: ReturnType<typeof setTimeout>;
      const h = () => {
        if ((el as HTMLInputElement).value) {
          clearTimeout(timer);
          timer = setTimeout(() => {
            log('Type detected');
            this.stopListening();
            this.hide();
            send({ type: 'ACTION_COMPLETED', action: 'type' });
          }, 1200);
        }
      };
      el.addEventListener('input', h);
      this.cleanup = () => { el.removeEventListener('input', h); clearTimeout(timer); };

    } else if (act === 'select') {
      const h = () => {
        log('Select detected');
        this.stopListening();
        this.hide();
        send({ type: 'ACTION_COMPLETED', action: 'select' });
      };
      el.addEventListener('change', h);
      this.cleanup = () => el.removeEventListener('change', h);
    }
  }

  private stopListening() {
    this.cleanup?.();
    this.cleanup = null;
  }
}

// ── overlay CSS (injected inside shadow root) ────────────────

const OVERLAY_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }

  .spotlight {
    position: fixed; border-radius: 6px; pointer-events: none;
    box-shadow: 0 0 0 9999px rgba(0,0,0,0.42);
    transition: top .2s ease, left .2s ease, width .2s ease, height .2s ease;
  }
  .ring {
    position: fixed; border: 3px solid #6366F1; border-radius: 8px;
    pointer-events: none;
    animation: pulse 1.5s ease-in-out infinite;
  }
  @keyframes pulse {
    0%,100% { opacity:1; transform:scale(1); }
    50%     { opacity:.35; transform:scale(1.04); }
  }

  .card {
    position: fixed; pointer-events: none;
    background: #fff; border: 2px solid #6366F1; border-radius: 12px;
    padding: 14px 18px; max-width: 320px; min-width: 180px;
    box-shadow: 0 6px 24px rgba(0,0,0,.15);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    animation: fadeUp .3s ease;
  }
  @keyframes fadeUp {
    from { opacity:0; transform:translateY(6px); }
    to   { opacity:1; transform:translateY(0); }
  }
  .lbl   { font-size:11px; font-weight:700; color:#6366F1;
           text-transform:uppercase; letter-spacing:.6px; margin-bottom:4px; }
  .ins   { font-size:14px; font-weight:500; color:#1e1e2e;
           line-height:1.45; margin-bottom:8px; }
  .badge { display:inline-block; font-size:10px; font-weight:700; color:#fff;
           background:#6366F1; border-radius:4px; padding:2px 8px;
           text-transform:uppercase; letter-spacing:.4px; }

  .arrow { position:fixed; pointer-events:none; width:0; height:0; }
  .arrow-up   { border-left:9px solid transparent; border-right:9px solid transparent;
                border-bottom:11px solid #6366F1; }
  .arrow-down { border-left:9px solid transparent; border-right:9px solid transparent;
                border-top:11px solid #6366F1; }
`;

// ── tiny helpers ─────────────────────────────────────────────

function mk(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

function pos(el: HTMLElement, top: number, left: number, w: number, h: number) {
  Object.assign(el.style, {
    top:    `${top}px`,
    left:   `${left}px`,
    width:  `${w}px`,
    height: `${h}px`,
  });
}

function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(v, hi)); }

function throttle<T extends (...a: any[]) => void>(fn: T, ms: number): T {
  let last = 0;
  return ((...a: any[]) => {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn(...a); }
  }) as T;
}

function send(msg: Message) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

// ════════════════════════════════════════════════════════════
//  SPA DETECTION
// ════════════════════════════════════════════════════════════

function watchSPA(cb: (url: string) => void) {
  let last = location.href;
  const check = () => {
    if (location.href !== last) {
      last = location.href;
      cb(last);
    }
  };

  // patch history API
  const origPush    = history.pushState;
  const origReplace = history.replaceState;
  history.pushState    = function (this: History, ...a: Parameters<typeof origPush>)    { origPush.apply(this, a);    check(); };
  history.replaceState = function (this: History, ...a: Parameters<typeof origReplace>) { origReplace.apply(this, a); check(); };

  window.addEventListener('popstate',   check);
  window.addEventListener('hashchange', check);

  // mutation observer — catch SPA frameworks that don't use history API
  let t: ReturnType<typeof setTimeout>;
  const obs = new MutationObserver(() => { clearTimeout(t); t = setTimeout(check, 300); });
  const body = document.body ?? document.documentElement;
  obs.observe(body, { childList: true, subtree: true });
}

// ════════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════════

const overlay = new Overlay();

watchSPA(url => {
  log('SPA nav →', url);
  send({ type: 'NAVIGATION_DETECTED', url });
});

chrome.runtime.onMessage.addListener((msg: Message, _sender, respond) => {
  log('Received:', msg.type);

  switch (msg.type) {
    case 'EXTRACT_PAGE':
      respond({ type: 'PAGE_DATA', data: extractPage() });
      return true;

    case 'SHOW_STEP':
      overlay.show(msg.step, msg.stepNumber);
      respond({ ok: true });
      return true;

    case 'CLEAR_OVERLAY':
      overlay.hide();
      respond({ ok: true });
      return true;
  }

  return false;
});

log('Content script loaded on', location.href);
