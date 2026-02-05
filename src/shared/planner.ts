// ═══════════════════════════════════════════════════════════════
// NavAI — Planner (Heuristic + LLM)
// ═══════════════════════════════════════════════════════════════

import type { PageData, PageElement, GuidanceStep, SessionState, LLMConfig, ActionType } from './types';

// ── Keywords ────────────────────────────────────────────────────

const STOP_WORDS = new Set(['a','an','the','for','to','of','in','on','and','or','is','my','i','it','this','that']);

function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !STOP_WORDS.has(w));
}

// ── CTA / Penalty words ─────────────────────────────────────────

const CTA = ['apply','start','next','continue','submit','search','book','confirm','proceed','sign','log','register','enroll','flight','hotel','add','create','send','save','checkout','buy','order','pay'];
const PENALTY = ['logout','cancel','back','close','skip','no thanks','maybe later','dismiss','advertisement','ad','cookie','privacy','terms','unsubscribe'];

// ── Heuristic scorer ────────────────────────────────────────────

function score(el: PageElement, keywords: string[], usedSelectors: Set<string>, usedTexts: string[], hasOpenDialog: boolean): number {
  let s = 0;
  const txt = el.text.toLowerCase();
  const lbl = el.label.toLowerCase();

  // Already used? Big penalty
  if (usedSelectors.has(el.selector)) return -1000;
  // Only penalize text match if text is non-empty and substantial
  if (el.text.length > 3 && usedTexts.some(t => t.length > 3 && t.includes(el.text.substring(0, 20)))) return -500;

  // CRITICAL: If dialog is open, elements outside it are essentially unusable
  if (hasOpenDialog) {
    if (el.isInDialog) {
      s += 30; // Big bonus for being inside the dialog
    } else {
      return -2000; // Can't interact with elements behind a dialog
    }
  }

  // Viewport bonus
  if (el.isInViewport) s += 5;

  // Keyword match
  for (const k of keywords) {
    if (txt.includes(k)) s += 15;
    if (lbl.includes(k)) s += 12;
    // Placeholder match (useful for inputs)
    const ph = (el.placeholder ?? '').toLowerCase();
    if (ph && ph.includes(k)) s += 10;
  }

  // CTA bonus
  for (const c of CTA) {
    if (txt.includes(c)) s += 8;
    if (lbl.includes(c)) s += 6;
  }

  // Penalty words
  for (const p of PENALTY) {
    if (txt.includes(p)) s -= 20;
    if (lbl.includes(p)) s -= 15;
  }

  // Element type bonuses
  if (el.tag === 'button') s += 5;
  if (el.role === 'button') s += 4;
  if (el.tag === 'a') s += 2;
  if (el.isInput) s += 3;

  // Size bonus (larger = more prominent)
  if (el.rect.width > 100 && el.rect.height > 30) s += 3;

  // Position bonus (higher on page = earlier in flow)
  if (el.rect.top < 600) s += 2;

  return s;
}

function actionFor(el: PageElement): ActionType {
  if (el.isInput) {
    const t = (el.inputType ?? 'text').toLowerCase();
    if (['checkbox','radio','submit','button','file'].includes(t)) return 'click';
    if (el.tag === 'select') return 'select';
    return 'type';
  }
  if (el.tag === 'select') return 'select';
  return 'click';
}

function instructionFor(el: PageElement, action: ActionType): string {
  const name = el.text.substring(0, 50) || el.label || el.placeholder || 'this element';
  if (action === 'click') return `Click "${name}"`;
  if (action === 'type') return `Enter your ${el.label || el.placeholder || 'information'} here`;
  if (action === 'select') return `Select an option from "${name}"`;
  return `Interact with "${name}"`;
}

// ── Heuristic Planner ───────────────────────────────────────────

export function heuristicPlan(page: PageData, state: SessionState): GuidanceStep | null {
  if (page.elements.length === 0) return null;

  const kw = tokenize(state.goal);
  const usedSelectors = new Set(state.history.map(h => h.selector));
  const usedTexts = state.history.map(h => h.text).filter(t => t.length > 3);

  // Score and rank
  const ranked = page.elements
    .map(el => ({ el, score: score(el, kw, usedSelectors, usedTexts, page.hasOpenDialog) }))
    .filter(x => x.score > -500)
    .sort((a, b) => b.score - a.score);

  // Require a minimum relevance score — don't suggest random elements
  // Score of 10+ means at least one keyword matched or strong CTA signal
  if (ranked.length === 0 || ranked[0].score < 10) {
    // No relevant element found — don't waste the user's time
    return null;
  }

  const best = ranked[0].el;
  const action = actionFor(best);

  return {
    stepNumber: state.step,
    action,
    selector: best.selector,
    textHint: best.text.substring(0, 60),
    instruction: instructionFor(best, action),
  };
}

// ═════════════════════════════════════════════════════════════════
// LLM Planner
// ═════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `You are NavAI, a browser navigation assistant that helps users accomplish tasks step-by-step.

You will receive:
1. The user's goal
2. The current page URL and title
3. Whether a dialog/modal is currently open
4. A numbered list of interactive elements on the page
5. Previous actions already taken

Your job: Pick the SINGLE best next action to make progress toward the goal.

Available actions:
- click(id) — Click on element with given ID
- type(id) — Focus on input element with given ID (user will type)
- select(id) — Focus on dropdown with given ID (user will select)
- wait() — No clear action available, wait

IMPORTANT RULES:
- Pick exactly ONE action per response
- Use the element ID number from the list
- NEVER repeat an action on the same element from "Previous actions"
- If a dialog/modal is open, you MUST pick an element marked [DIALOG] — elements behind the dialog are not clickable
- Prefer elements that logically advance the task (e.g., fill inputs before clicking submit)
- If the goal seems complete or you're stuck, use wait()

Response format:
<Thought>Brief reasoning about what to do next</Thought>
<Action>click(5)</Action>`;

export async function llmPlan(
  page: PageData,
  state: SessionState,
  config: LLMConfig
): Promise<GuidanceStep | null> {
  // Build element list — richer context
  const elementList = page.elements.slice(0, 50).map(el => {
    const parts = [`[${el.idx}]`];

    // Flags
    const flags: string[] = [];
    if (el.isInDialog) flags.push('DIALOG');
    if (!el.isInViewport) flags.push('OFFSCREEN');
    if (flags.length) parts.push(`[${flags.join(',')}]`);

    parts.push(el.tag);
    if (el.role !== el.tag) parts.push(`role="${el.role}"`);
    if (el.text) parts.push(`"${el.text.substring(0, 60)}"`);
    if (el.label) parts.push(`label="${el.label}"`);
    if (el.placeholder) parts.push(`placeholder="${el.placeholder}"`);
    if (el.isInput) parts.push(`(input:${el.inputType || 'text'})`);
    return parts.join(' ');
  }).join('\n');

  // Previous actions with text context
  const prevActions = state.history.length > 0
    ? state.history.slice(-8).map(h =>
        `Step ${h.step}: ${h.action} on "${h.text}" [${h.selector}]`
      ).join('\n')
    : '(none yet)';

  const dialogNote = page.hasOpenDialog
    ? '\n⚠️ A DIALOG/MODAL IS OPEN. You MUST pick an element marked [DIALOG]. Other elements are not clickable.'
    : '';

  const userPrompt = `Goal: ${state.goal}

Current URL: ${page.url}
Page title: ${page.title}${dialogNote}

Previous actions (${state.history.length} total):
${prevActions}

Interactive elements on page (${page.elements.length} total):
${elementList}

What is the single best next action?`;

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    let body: string;
    let url = config.endpoint;

    if (config.provider === 'openai') {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
      body = JSON.stringify({
        model: config.model || 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 300,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        stop: ['</Action>'],
      });
    } else if (config.provider === 'anthropic') {
      headers['x-api-key'] = config.apiKey;
      headers['anthropic-version'] = '2023-06-01';
      body = JSON.stringify({
        model: config.model || 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
        stop_sequences: ['</Action>'],
      });
    } else {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
      body = JSON.stringify({
        model: config.model,
        temperature: 0,
        max_tokens: 300,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      });
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);

    const res = await fetch(url, { method: 'POST', headers, body, signal: ctrl.signal });
    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('[NavAI] LLM error:', res.status, errText.substring(0, 200));
      return null;
    }

    const json = await res.json();
    let raw: string;

    if (config.provider === 'anthropic') {
      raw = (json.content?.[0]?.text ?? '') + '</Action>';
    } else {
      raw = (json.choices?.[0]?.message?.content ?? '') + '</Action>';
    }

    console.log('[NavAI] LLM response:', raw);

    // Parse response
    const actionMatch = raw.match(/<Action>(\w+)\((\d+)?\)<\/Action>/i);
    if (!actionMatch) {
      console.log('[NavAI] Could not parse action from response');
      return null;
    }

    const actionName = actionMatch[1].toLowerCase();
    const elementId = actionMatch[2] ? parseInt(actionMatch[2], 10) : -1;

    if (actionName === 'wait' || elementId < 0) {
      return null;
    }

    const el = page.elements.find(e => e.idx === elementId);
    if (!el) {
      console.log('[NavAI] Element not found:', elementId);
      return null;
    }

    const thoughtMatch = raw.match(/<Thought>(.*?)<\/Thought>/is);
    const thought = thoughtMatch ? thoughtMatch[1].trim() : '';

    let action: ActionType = 'click';
    if (actionName === 'type') action = 'type';
    if (actionName === 'select') action = 'select';

    return {
      stepNumber: state.step,
      action,
      selector: el.selector,
      textHint: el.text.substring(0, 60),
      instruction: thought || instructionFor(el, action),
    };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.log('[NavAI] LLM request timed out');
    } else {
      console.error('[NavAI] LLM error:', err.message);
    }
    return null;
  }
}
