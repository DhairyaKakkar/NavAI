// ═══════════════════════════════════════════════════════════════
// NavAI — Shared Types
// ═══════════════════════════════════════════════════════════════

export type ActionType = 'click' | 'type' | 'select' | 'scroll' | 'wait';
export type PlannerMode = 'heuristic' | 'llm';

// ── Page Element ────────────────────────────────────────────────

export interface PageElement {
  idx: number;
  tag: string;
  role: string;
  text: string;
  label: string;
  selector: string;
  rect: { top: number; left: number; width: number; height: number };
  isInput: boolean;
  inputType?: string;
  placeholder?: string;
  isInViewport: boolean;
  isInDialog: boolean;
}

export interface PageData {
  url: string;
  title: string;
  elements: PageElement[];
  hasOpenDialog: boolean;
}

// ── Guidance Step ───────────────────────────────────────────────

export interface GuidanceStep {
  stepNumber: number;
  action: ActionType;
  selector: string;
  textHint: string;
  instruction: string;
}

// ── Session State ───────────────────────────────────────────────

export interface ActionRecord {
  step: number;
  action: ActionType;
  selector: string;
  text: string;
}

export interface SessionState {
  goal: string;
  active: boolean;
  step: number;
  current: GuidanceStep | null;
  history: ActionRecord[];
  mode: PlannerMode;
}

// ── LLM Config ──────────────────────────────────────────────────

export interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'custom';
  endpoint: string;
  apiKey: string;
  model: string;
}

// ── Messages ────────────────────────────────────────────────────

export type Message =
  | { type: 'START'; goal: string; mode: PlannerMode }
  | { type: 'STOP' }
  | { type: 'SKIP' }
  | { type: 'RESCAN' }
  | { type: 'EXTRACT' }
  | { type: 'PAGE_DATA'; data: PageData }
  | { type: 'SHOW_STEP'; step: GuidanceStep }
  | { type: 'HIDE_OVERLAY' }
  | { type: 'ACTION_DONE'; action: ActionType }
  | { type: 'NAV_CHANGE'; url: string }
  | { type: 'GET_STATE' }
  | { type: 'STATE'; state: SessionState }
  | { type: 'ERROR'; msg: string };
