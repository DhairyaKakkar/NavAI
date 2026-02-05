/**
 * NavAI — Background Service Worker (MV3)
 *
 * Orchestrates message flow between the side‑panel UI and the
 * per‑tab content script.  Runs the planner and persists session
 * state in chrome.storage.local.
 */

import type { Message, SessionState, PageData, GuidanceStep, LLMConfig } from './shared/types';
import { heuristicPlan, llmPlan } from './shared/planner';

// ── Debug ────────────────────────────────────────────────────

const DEBUG = true;
const log = (...a: unknown[]) => { if (DEBUG) console.debug('[NavAI:bg]', ...a); };

// ── State ────────────────────────────────────────────────────

const EMPTY: SessionState = {
  goal: '',
  isActive: false,
  currentStepNumber: 1,
  currentStep: null,
  actionHistory: [],
  plannerMode: 'heuristic',
};

let session: SessionState = { ...EMPTY };
let llmCfg: LLMConfig | null = null;

async function save() {
  await chrome.storage.local.set({ navai_session: session });
}

async function load() {
  const r = await chrome.storage.local.get(['navai_session', 'navai_llm_config']);
  if (r.navai_session)    session = r.navai_session;
  if (r.navai_llm_config) llmCfg  = r.navai_llm_config;
}

// ── Side‑panel opens on toolbar‑icon click ───────────────────

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => { /* Chrome < 116 fallback — ignored */ });

// ── Planner wrapper ──────────────────────────────────────────

async function plan(page: PageData): Promise<GuidanceStep | null> {
  log('Planning …', session.plannerMode);

  if (session.plannerMode === 'llm' && llmCfg?.apiKey) {
    const step = await llmPlan(page, session, llmCfg);
    if (step) return step;
    log('LLM returned null — falling back to heuristic');
  }

  return heuristicPlan(page, session);
}

// ── Broadcast state to side‑panel ────────────────────────────

function broadcast() {
  const msg: Message = { type: 'STATE_UPDATE', state: { ...session } };
  chrome.runtime.sendMessage(msg).catch(() => {
    // Side‑panel may not be open — that's fine.
  });
}

// ── Send overlay command to a tab's content script ───────────

async function showStep(tabId: number, step: GuidanceStep) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'SHOW_STEP',
      step,
      stepNumber: session.currentStepNumber,
    } as Message);
  } catch (e) { log('showStep failed:', e); }
}

async function clearOverlay(tabId: number) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'CLEAR_OVERLAY' } as Message);
  } catch { /* tab may have closed */ }
}

// ── Core: extract → plan → show ──────────────────────────────

async function processTab(tabId: number) {
  if (!session.isActive) return;
  log('processTab', tabId);

  try {
    const resp: any = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_PAGE' } as Message);

    if (!resp || resp.type !== 'PAGE_DATA') {
      log('Bad EXTRACT_PAGE response');
      return;
    }

    const page: PageData = resp.data;
    log(`Page: ${page.url}  elements: ${page.elements.length}`);

    const step = await plan(page);

    if (step) {
      session.currentStep = step;
      await save();
      broadcast();
      await showStep(tabId, step);
    } else {
      session.currentStep = null;
      await save();
      broadcast();
      chrome.runtime.sendMessage({
        type: 'ERROR',
        message: 'Could not determine the next step on this page. Try "Rescan" or rephrase your goal.',
      } as Message).catch(() => {});
    }
  } catch (e) {
    log('processTab error (will retry):', e);
    // Content script may not be injected yet — retry once
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_PAGE' } as Message)
        .then(async (resp: any) => {
          if (resp?.type !== 'PAGE_DATA') return;
          const step = await plan(resp.data);
          if (step) {
            session.currentStep = step;
            await save();
            broadcast();
            await showStep(tabId, step);
          }
        })
        .catch(() => {});
    }, 1500);
  }
}

// ── Active‑tab helper ────────────────────────────────────────

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

// ── Message router ───────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg: Message, sender, respond) => {
  log('msg:', msg.type, sender.tab?.id ?? 'ext');

  switch (msg.type) {

    // ── Start guidance ─────────────────────────────────────
    case 'START_GUIDANCE': {
      session = {
        ...EMPTY,
        goal: msg.goal,
        isActive: true,
        plannerMode: msg.mode,
      };
      save().then(async () => {
        broadcast();
        const id = await activeTabId();
        if (id) processTab(id);
      });
      respond({ ok: true });
      return true;
    }

    // ── Stop guidance ──────────────────────────────────────
    case 'STOP_GUIDANCE': {
      session = { ...EMPTY };
      save().then(async () => {
        broadcast();
        const id = await activeTabId();
        if (id) clearOverlay(id);
      });
      respond({ ok: true });
      return true;
    }

    // ── Rescan current page ────────────────────────────────
    case 'RESCAN': {
      activeTabId().then(id => { if (id) processTab(id); });
      respond({ ok: true });
      return true;
    }

    // ── Skip current step (manual advance) ─────────────────
    case 'SKIP_STEP': {
      if (session.currentStep) {
        session.actionHistory.push({
          stepNumber: session.currentStepNumber,
          action: session.currentStep.action,
          url: '',
          timestamp: Date.now(),
        });
      }
      session.currentStepNumber++;
      session.currentStep = null;
      save().then(async () => {
        broadcast();
        const id = await activeTabId();
        if (id) processTab(id);
      });
      respond({ ok: true });
      return true;
    }

    // ── Content script reports completed action ────────────
    case 'ACTION_COMPLETED': {
      if (!session.isActive) return false;
      log('Action completed:', msg.action);

      if (session.currentStep) {
        session.actionHistory.push({
          stepNumber: session.currentStepNumber,
          action: msg.action,
          url: sender.tab?.url ?? '',
          timestamp: Date.now(),
        });
      }
      session.currentStepNumber++;
      session.currentStep = null;

      save().then(() => {
        broadcast();
        // After a click the page may navigate — delay rescan slightly
        const delay = msg.action === 'click' ? 600 : 100;
        setTimeout(() => {
          const tabId = sender.tab?.id;
          if (tabId) processTab(tabId);
        }, delay);
      });
      respond({ ok: true });
      return true;
    }

    // ── Side‑panel requests current state ──────────────────
    case 'GET_STATE': {
      respond({ type: 'STATE_UPDATE', state: { ...session } });
      return true;
    }

    // ── SPA navigation detected by content script ──────────
    case 'NAVIGATION_DETECTED': {
      if (!session.isActive) return false;
      log('SPA nav:', msg.url);
      const tabId = sender.tab?.id;
      if (tabId) setTimeout(() => processTab(tabId), 800);
      respond({ ok: true });
      return true;
    }
  }

  return false;
});

// ── webNavigation — detect full‑page navigations ─────────────

chrome.webNavigation.onCompleted.addListener(details => {
  if (details.frameId !== 0) return; // main frame only
  if (!session.isActive) return;
  log('webNav completed:', details.url);
  setTimeout(() => processTab(details.tabId), 600);
});

// ── Boot ─────────────────────────────────────────────────────

load().then(() => log('Background ready. Active:', session.isActive));
