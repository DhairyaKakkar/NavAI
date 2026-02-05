// ── Action & strategy enums ──────────────────────────────────

export type ActionType       = 'click' | 'type' | 'select' | 'scroll' | 'wait';
export type SelectorStrategy = 'css' | 'xpath' | 'text';
export type ValidationEvent  = 'click' | 'input' | 'change' | 'navigation';
export type PlannerMode      = 'heuristic' | 'llm';

// ── Page representation ──────────────────────────────────────

export interface ElementRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface PageElement {
  index: number;
  tag: string;
  type?: string;
  id?: string;
  name?: string;
  ariaLabel?: string;
  text: string;
  placeholder?: string;
  dataTestId?: string;
  role?: string;
  href?: string;
  cssSelector: string;
  xpath: string;
  rect: ElementRect;
  isVisible: boolean;
  isDisabled: boolean;
  formContext?: { label?: string; fieldType?: string };
}

export interface PageData {
  url: string;
  title: string;
  elements: PageElement[];
  pageText: string; // truncated visible text
}

// ── Guidance step (also the LLM JSON‑response schema) ────────

export interface StepTarget {
  strategy: SelectorStrategy;
  selector: string;
  textHint: string;
}

export interface StepValidation {
  event: ValidationEvent;
  successHint: string;
}

/**
 * A single guidance step — the JSON schema enforced on LLM responses.
 *
 * ```json
 * {
 *   "stepTitle":   "string",
 *   "instruction": "string",
 *   "action":      "click|type|select|scroll|wait",
 *   "target":      { "strategy": "css|xpath|text", "selector": "string", "textHint": "string" },
 *   "validation":  { "event": "click|input|change|navigation", "successHint": "string" }
 * }
 * ```
 */
export interface GuidanceStep {
  stepTitle: string;
  instruction: string;
  action: ActionType;
  target: StepTarget;
  validation: StepValidation;
}

// ── Session state (persisted via chrome.storage.local) ───────

export interface ActionRecord {
  stepNumber: number;
  action: ActionType;
  url: string;
  timestamp: number;
}

export interface SessionState {
  goal: string;
  isActive: boolean;
  currentStepNumber: number;
  currentStep: GuidanceStep | null;
  actionHistory: ActionRecord[];
  plannerMode: PlannerMode;
}

// ── LLM configuration ────────────────────────────────────────

export interface LLMConfig {
  endpoint: string;   // e.g. "https://api.openai.com/v1/chat/completions"
  apiKey: string;
  model: string;      // e.g. "gpt-4o-mini"
  provider: 'openai' | 'anthropic' | 'custom';
}

// ── Messages between background ↔ content ↔ sidepanel ───────

export type Message =
  | { type: 'START_GUIDANCE'; goal: string; mode: PlannerMode }
  | { type: 'STOP_GUIDANCE' }
  | { type: 'RESCAN' }
  | { type: 'SKIP_STEP' }
  | { type: 'EXTRACT_PAGE' }
  | { type: 'PAGE_DATA'; data: PageData }
  | { type: 'SHOW_STEP'; step: GuidanceStep; stepNumber: number }
  | { type: 'CLEAR_OVERLAY' }
  | { type: 'ACTION_COMPLETED'; action: ActionType }
  | { type: 'STATE_UPDATE'; state: SessionState }
  | { type: 'NAVIGATION_DETECTED'; url: string }
  | { type: 'GET_STATE' }
  | { type: 'ERROR'; message: string };
