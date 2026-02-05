/**
 * NavAI Planner — decides the next guidance step.
 *
 * Two modes:
 *   1. **Heuristic** (default, no API key) — rule‑based keyword scorer.
 *   2. **LLM**       (optional) — sends simplified page to a remote endpoint.
 *
 * ── Example scenario (driver's licence) ──────────────────────
 * Goal: "Apply for driver's license"
 *  Step 1 — homepage:  highlight link "Driver licensing"        → click
 *  Step 2 — sub‑page:  highlight link "Apply for a new license" → click
 *  Step 3 — form page: highlight input "NRIC / ID"              → type
 *  Step 4 — form page: highlight button "Next"                  → click
 */

import type {
  PageData,
  PageElement,
  GuidanceStep,
  ActionType,
  SessionState,
  LLMConfig,
} from './types';

// ── Helpers ──────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'a','an','the','for','to','of','in','on','at','and','or','is',
  'my','i','me','it','do','be','this','that','with','from','by',
]);

function keywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));
}

// ── Heuristic scorer ─────────────────────────────────────────

const CTA_WORDS = [
  'apply','start','begin','next','continue','submit',
  'proceed','go','sign up','register','log in','login',
  'search','get started','enroll','renew','schedule',
];

function score(el: PageElement, kw: string[], stepNum: number): number {
  if (!el.isVisible || el.isDisabled) return -1000;

  let s = 0;
  const txt   = el.text.toLowerCase();
  const aria  = (el.ariaLabel  ?? '').toLowerCase();
  const href  = (el.href       ?? '').toLowerCase();
  const ph    = (el.placeholder ?? '').toLowerCase();
  const label = (el.formContext?.label ?? '').toLowerCase();

  // keyword relevance
  for (const k of kw) {
    if (txt.includes(k))   s += 10;
    if (aria.includes(k))  s += 8;
    if (href.includes(k))  s += 5;
    if (ph.includes(k))    s += 4;
    if (label.includes(k)) s += 8;
  }

  // CTA bonus
  for (const c of CTA_WORDS) {
    if (txt.includes(c))  s += 5;
    if (aria.includes(c)) s += 4;
  }

  // element‑type bonuses
  if (el.tag === 'button' || el.type === 'submit') s += 3;
  if (el.role === 'button')                        s += 2;
  if (el.tag === 'a' && el.href)                   s += 1;

  // form‑field boost on later steps (likely a form page)
  if (stepNum > 1 && ['input','textarea','select'].includes(el.tag)) {
    s += 2;
  }

  // primary / cta class hints
  const cls = (el.dataTestId ?? '').toLowerCase();
  if (/primary|cta|main/.test(cls)) s += 3;

  // penalise tiny or far‑off elements
  if (el.rect.width < 10 || el.rect.height < 10) s -= 50;
  if (el.rect.top < -500 || el.rect.top > 8000)  s -= 20;

  // small bonus for stable identifiers
  if (el.id)         s += 1;
  if (el.dataTestId) s += 1;

  return s;
}

function actionFor(el: PageElement): ActionType {
  const tag = el.tag;
  if (tag === 'input') {
    const t = (el.type ?? 'text').toLowerCase();
    if (['checkbox','radio','submit','button','reset','file','image'].includes(t)) return 'click';
    return 'type';
  }
  if (tag === 'textarea') return 'type';
  if (tag === 'select')   return 'select';
  return 'click';
}

function instructionFor(el: PageElement, action: ActionType, _stepNum: number): string {
  const label =
    el.text.trim().substring(0, 60) ||
    el.ariaLabel ||
    el.placeholder ||
    el.name ||
    'this element';

  switch (action) {
    case 'click':
      return `Click "${label}"`;
    case 'type': {
      const field = el.formContext?.label || el.placeholder || el.ariaLabel || el.name || 'the field';
      return `Type your information in "${field}"`;
    }
    case 'select': {
      const field = el.formContext?.label || el.ariaLabel || el.name || 'the dropdown';
      return `Select an option from "${field}"`;
    }
    case 'scroll':
      return 'Scroll down to see more options';
    case 'wait':
      return 'Wait for the page to finish loading';
  }
}

function buildStep(el: PageElement, action: ActionType, stepNum: number): GuidanceStep {
  return {
    stepTitle: `Step ${stepNum}`,
    instruction: instructionFor(el, action, stepNum),
    action,
    target: {
      strategy: el.cssSelector ? 'css' : 'text',
      selector: el.cssSelector,
      textHint: el.text.substring(0, 80),
    },
    validation: {
      event: action === 'type' ? 'input' : action === 'select' ? 'change' : 'click',
      successHint: `Completed: ${action} on "${el.text.substring(0, 40)}"`,
    },
  };
}

// ── Public: heuristic planner ────────────────────────────────

export function heuristicPlan(
  page: PageData,
  state: SessionState,
): GuidanceStep | null {
  if (page.elements.length === 0) return null;

  const kw = keywords(state.goal);

  const ranked = page.elements
    .map(el => ({ el, s: score(el, kw, state.currentStepNumber) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s);

  if (ranked.length > 0) {
    const best   = ranked[0].el;
    const action = actionFor(best);
    return buildStep(best, action, state.currentStepNumber);
  }

  // Fallback — pick the most prominent visible interactive element
  const fallback = page.elements
    .filter(el => el.isVisible && !el.isDisabled)
    .filter(el => ['button','a','input','textarea','select'].includes(el.tag))
    .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height));

  if (fallback.length === 0) return null;

  const best   = fallback[0];
  const action = actionFor(best);
  return buildStep(best, action, state.currentStepNumber);
}

// ── Public: LLM planner ──────────────────────────────────────

const LLM_SYSTEM = `You are NavAI, a navigation assistant.
Given a user's goal and a webpage's interactive elements, determine the single best next action.

Respond with ONLY valid JSON matching this schema:
{
  "stepTitle":   "string",
  "instruction": "string (human‑friendly, e.g. 'Click the Apply Now button')",
  "action":      "click|type|select|scroll|wait",
  "target":      { "strategy": "css|xpath|text", "selector": "string", "textHint": "string" },
  "validation":  { "event": "click|input|change|navigation", "successHint": "string" }
}

Rules:
- Pick ONLY ONE action — the most important next step toward the goal.
- Prefer stable selectors (id, name, aria‑label, data‑testid).
- Keep instructions concise and friendly.
- If no clear action exists, use action "wait".`;

export async function llmPlan(
  page: PageData,
  state: SessionState,
  config: LLMConfig,
): Promise<GuidanceStep | null> {
  // Build a concise element list (max 50)
  const elSummary = page.elements
    .filter(el => el.isVisible && !el.isDisabled)
    .slice(0, 50)
    .map(el => {
      const p = [`[${el.index}] <${el.tag}>`];
      if (el.text)        p.push(`text="${el.text.substring(0, 100)}"`);
      if (el.ariaLabel)   p.push(`aria="${el.ariaLabel}"`);
      if (el.id)          p.push(`id="${el.id}"`);
      if (el.name)        p.push(`name="${el.name}"`);
      if (el.type)        p.push(`type="${el.type}"`);
      if (el.href)        p.push(`href="${el.href.substring(0, 100)}"`);
      if (el.placeholder) p.push(`placeholder="${el.placeholder}"`);
      if (el.cssSelector) p.push(`css="${el.cssSelector}"`);
      return p.join(' ');
    })
    .join('\n');

  const history = state.actionHistory
    .slice(-5)
    .map(h => `  Step ${h.stepNumber}: ${h.action} at ${h.url}`)
    .join('\n') || '  (none)';

  const userMsg = [
    `Goal: "${state.goal}"`,
    `Current step: ${state.currentStepNumber}`,
    `URL: ${page.url}`,
    `Title: ${page.title}`,
    '',
    'Previous actions:',
    history,
    '',
    'Interactive elements:',
    elSummary,
    '',
    'Page text (excerpt):',
    page.pageText.substring(0, 500),
  ].join('\n');

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    let body: string;

    if (config.provider === 'openai') {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
      body = JSON.stringify({
        model: config.model || 'gpt-4o-mini',
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: LLM_SYSTEM },
          { role: 'user',   content: userMsg },
        ],
      });
    } else if (config.provider === 'anthropic') {
      headers['x-api-key']          = config.apiKey;
      headers['anthropic-version']   = '2023-06-01';
      body = JSON.stringify({
        model: config.model || 'claude-sonnet-4-20250514',
        max_tokens: 512,
        system: LLM_SYSTEM,
        messages: [{ role: 'user', content: userMsg }],
      });
    } else {
      // Custom / OpenAI‑compatible
      headers['Authorization'] = `Bearer ${config.apiKey}`;
      body = JSON.stringify({
        model: config.model,
        temperature: 0.1,
        messages: [
          { role: 'system', content: LLM_SYSTEM },
          { role: 'user',   content: userMsg },
        ],
      });
    }

    const res = await fetch(config.endpoint, { method: 'POST', headers, body });
    if (!res.ok) {
      console.error(`[NavAI] LLM ${res.status}: ${res.statusText}`);
      return null;
    }

    const json = await res.json();

    let raw: string;
    if (config.provider === 'anthropic') {
      raw = json.content?.[0]?.text ?? '';
    } else {
      raw = json.choices?.[0]?.message?.content ?? '';
    }

    // Strip markdown fences if present
    const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const parsed: GuidanceStep = JSON.parse(m ? m[1].trim() : raw.trim());

    if (!parsed.stepTitle || !parsed.instruction || !parsed.action || !parsed.target || !parsed.validation) {
      console.error('[NavAI] LLM response missing required fields');
      return null;
    }
    return parsed;
  } catch (err) {
    console.error('[NavAI] LLM planner error:', err);
    return null;
  }
}
