/**
 * NavAI — Side‑panel UI
 *
 * Lets the user enter a goal, choose planner mode, view current
 * step, and control guidance (rescan / skip / stop).
 */

import type { Message, SessionState, PlannerMode, LLMConfig } from '../shared/types';

// ── DOM refs ─────────────────────────────────────────────────

const $  = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const goalSection   = $('goal-section');
const activeSection = $('active-section');
const goalInput     = $<HTMLTextAreaElement>('goal-input');
const startBtn      = $<HTMLButtonElement>('start-btn');

const goalDisplay    = $('goal-display');
const stepLabel      = $('step-label');
const stepInstruction = $('step-instruction');
const stepAction     = $('step-action');
const errorBox       = $('error-box');

const rescanBtn = $<HTMLButtonElement>('rescan-btn');
const skipBtn   = $<HTMLButtonElement>('skip-btn');
const stopBtn   = $<HTMLButtonElement>('stop-btn');

const historyCount = $('history-count');
const historyList  = $<HTMLOListElement>('history-list');

const llmConfig    = $('llm-config');
const llmProvider  = $<HTMLSelectElement>('llm-provider');
const llmEndpoint  = $<HTMLInputElement>('llm-endpoint');
const llmKey       = $<HTMLInputElement>('llm-key');
const llmModel     = $<HTMLInputElement>('llm-model');
const saveLlmBtn   = $<HTMLButtonElement>('save-llm');

const modeRadios = document.querySelectorAll<HTMLInputElement>('input[name="mode"]');

// ── Helpers ──────────────────────────────────────────────────

function send(msg: Message): Promise<any> {
  return chrome.runtime.sendMessage(msg);
}

function hide(el: HTMLElement)  { el.classList.add('hidden'); }
function show(el: HTMLElement)  { el.classList.remove('hidden'); }

// ── Default endpoints per provider ───────────────────────────

const DEFAULT_ENDPOINTS: Record<string, string> = {
  openai:    'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  custom:    '',
};

// ── Render state ─────────────────────────────────────────────

function render(state: SessionState) {
  if (!state.isActive) {
    show(goalSection);
    hide(activeSection);
    return;
  }

  hide(goalSection);
  show(activeSection);

  goalDisplay.textContent = `Goal: ${state.goal}`;

  if (state.currentStep) {
    hide(errorBox);
    stepLabel.textContent       = state.currentStep.stepTitle;
    stepInstruction.textContent = state.currentStep.instruction;
    stepAction.textContent      = state.currentStep.action;
    show(stepAction);
  } else {
    stepLabel.textContent       = '';
    stepInstruction.textContent = 'Scanning page…';
    hide(stepAction);
  }

  // history
  historyCount.textContent = String(state.actionHistory.length);
  historyList.innerHTML = '';
  for (const h of state.actionHistory) {
    const li = document.createElement('li');
    li.textContent = `Step ${h.stepNumber}: ${h.action} — ${new URL(h.url || 'about:blank').hostname || '(same page)'}`;
    historyList.appendChild(li);
  }
}

// ── LLM config toggle ───────────────────────────────────────

modeRadios.forEach(r => r.addEventListener('change', () => {
  const mode = (document.querySelector<HTMLInputElement>('input[name="mode"]:checked'))!.value;
  if (mode === 'llm') show(llmConfig); else hide(llmConfig);
}));

llmProvider.addEventListener('change', () => {
  const prov = llmProvider.value;
  llmEndpoint.value = DEFAULT_ENDPOINTS[prov] ?? '';
});

saveLlmBtn.addEventListener('click', async () => {
  const cfg: LLMConfig = {
    provider: llmProvider.value as LLMConfig['provider'],
    endpoint: llmEndpoint.value.trim() || DEFAULT_ENDPOINTS[llmProvider.value] || '',
    apiKey:   llmKey.value.trim(),
    model:    llmModel.value.trim(),
  };
  await chrome.storage.local.set({ navai_llm_config: cfg });
  saveLlmBtn.textContent = 'Saved!';
  setTimeout(() => { saveLlmBtn.textContent = 'Save LLM settings'; }, 1500);
});

// ── Load saved LLM config ────────────────────────────────────

async function loadLLMConfig() {
  const r = await chrome.storage.local.get('navai_llm_config');
  const cfg: LLMConfig | undefined = r.navai_llm_config;
  if (cfg) {
    llmProvider.value  = cfg.provider;
    llmEndpoint.value  = cfg.endpoint;
    llmKey.value       = cfg.apiKey;
    llmModel.value     = cfg.model;
  }
}

// ── Actions ──────────────────────────────────────────────────

startBtn.addEventListener('click', async () => {
  const goal = goalInput.value.trim();
  if (!goal) { goalInput.focus(); return; }

  const mode = (document.querySelector<HTMLInputElement>('input[name="mode"]:checked'))!.value as PlannerMode;

  startBtn.disabled = true;
  await send({ type: 'START_GUIDANCE', goal, mode });
  startBtn.disabled = false;
});

rescanBtn.addEventListener('click', () => send({ type: 'RESCAN' }));
skipBtn.addEventListener('click',   () => send({ type: 'SKIP_STEP' }));
stopBtn.addEventListener('click',   () => send({ type: 'STOP_GUIDANCE' }));

// ── Listen for state broadcasts ──────────────────────────────

chrome.runtime.onMessage.addListener((msg: Message) => {
  if (msg.type === 'STATE_UPDATE') render(msg.state);
  if (msg.type === 'ERROR') {
    errorBox.textContent = msg.message;
    show(errorBox);
  }
});

// ── Boot: request current state ──────────────────────────────

(async () => {
  await loadLLMConfig();
  const resp = await send({ type: 'GET_STATE' });
  if (resp?.type === 'STATE_UPDATE') render(resp.state);
})();
