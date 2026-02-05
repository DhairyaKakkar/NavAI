// ═══════════════════════════════════════════════════════════════
// NavAI — Side Panel UI
// ═══════════════════════════════════════════════════════════════

import type { Message, SessionState, PlannerMode, LLMConfig } from '../shared/types';

// ═════════════════════════════════════════════════════════════════
// DOM ELEMENTS
// ═════════════════════════════════════════════════════════════════

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const goalSection = $('goal-section');
const activeSection = $('active-section');
const goalInput = $<HTMLTextAreaElement>('goal');
const startBtn = $<HTMLButtonElement>('start');
const modeSelect = $<HTMLSelectElement>('mode');

const goalDisplay = $('goal-display');
const stepNum = $('step-num');
const instruction = $('instruction');
const errorBox = $('error');

const rescanBtn = $<HTMLButtonElement>('rescan');
const skipBtn = $<HTMLButtonElement>('skip');
const stopBtn = $<HTMLButtonElement>('stop');

const llmSection = $('llm-section');
const providerSelect = $<HTMLSelectElement>('provider');
const endpointInput = $<HTMLInputElement>('endpoint');
const apiKeyInput = $<HTMLInputElement>('apikey');
const modelInput = $<HTMLInputElement>('model');
const saveBtn = $<HTMLButtonElement>('save-llm');

const historyList = $<HTMLOListElement>('history');

// ═════════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════════

function send(msg: Message): Promise<any> {
  return chrome.runtime.sendMessage(msg);
}

function show(el: HTMLElement) { el.classList.remove('hidden'); }
function hide(el: HTMLElement) { el.classList.add('hidden'); }

// ═════════════════════════════════════════════════════════════════
// RENDER
// ═════════════════════════════════════════════════════════════════

function render(state: SessionState) {
  if (!state.active) {
    show(goalSection);
    hide(activeSection);
    hide(errorBox);
    return;
  }

  hide(goalSection);
  show(activeSection);

  goalDisplay.textContent = state.goal;
  stepNum.textContent = `Step ${state.step}`;

  if (state.current) {
    instruction.textContent = state.current.instruction;
    hide(errorBox);
  } else {
    instruction.textContent = 'Scanning page...';
  }

  // History
  historyList.innerHTML = '';
  for (const h of state.history) {
    const li = document.createElement('li');
    li.textContent = `${h.action}: "${h.text.substring(0, 30)}"`;
    historyList.appendChild(li);
  }
}

function showError(msg: string) {
  errorBox.textContent = msg;
  show(errorBox);
}

// ═════════════════════════════════════════════════════════════════
// LLM CONFIG
// ═════════════════════════════════════════════════════════════════

const DEFAULT_ENDPOINTS: Record<string, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  custom: '',
};

modeSelect.addEventListener('change', () => {
  if (modeSelect.value === 'llm') {
    show(llmSection);
  } else {
    hide(llmSection);
  }
});

providerSelect.addEventListener('change', () => {
  endpointInput.value = DEFAULT_ENDPOINTS[providerSelect.value] ?? '';
});

saveBtn.addEventListener('click', async () => {
  const cfg: LLMConfig = {
    provider: providerSelect.value as LLMConfig['provider'],
    endpoint: endpointInput.value || DEFAULT_ENDPOINTS[providerSelect.value] || '',
    apiKey: apiKeyInput.value,
    model: modelInput.value || 'gpt-4o-mini',
  };
  await chrome.storage.local.set({ navai_llm: cfg });
  saveBtn.textContent = 'Saved!';
  setTimeout(() => { saveBtn.textContent = 'Save'; }, 1500);
});

async function loadLLMConfig() {
  const r = await chrome.storage.local.get('navai_llm');
  const cfg: LLMConfig | undefined = r.navai_llm;
  if (cfg) {
    providerSelect.value = cfg.provider;
    endpointInput.value = cfg.endpoint;
    apiKeyInput.value = cfg.apiKey;
    modelInput.value = cfg.model;
  }
}

// ═════════════════════════════════════════════════════════════════
// ACTIONS
// ═════════════════════════════════════════════════════════════════

startBtn.addEventListener('click', async () => {
  const goal = goalInput.value.trim();
  if (!goal) {
    goalInput.focus();
    return;
  }

  const mode = modeSelect.value as PlannerMode;
  startBtn.disabled = true;
  await send({ type: 'START', goal, mode });
  startBtn.disabled = false;
});

rescanBtn.addEventListener('click', () => send({ type: 'RESCAN' }));
skipBtn.addEventListener('click', () => send({ type: 'SKIP' }));
stopBtn.addEventListener('click', () => send({ type: 'STOP' }));

// ═════════════════════════════════════════════════════════════════
// MESSAGE LISTENER
// ═════════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((msg: Message) => {
  if (msg.type === 'STATE') render(msg.state);
  if (msg.type === 'ERROR') showError(msg.msg);
});

// ═════════════════════════════════════════════════════════════════
// INIT
// ═════════════════════════════════════════════════════════════════

(async () => {
  await loadLLMConfig();
  const resp = await send({ type: 'GET_STATE' });
  if (resp?.type === 'STATE') render(resp.state);
})();
