# NavAI — AI Navigation Assistant (Chrome Extension)

A Manifest V3 Chrome extension that reads any webpage and guides the user
step-by-step toward a stated goal. Designed for **minimal cognitive load**
(especially helpful for neurodivergent users).

## How it works

1. Open the side panel (click the NavAI toolbar icon).
2. Type a goal — e.g. *"Apply for driver's license"*.
3. Click **Start guiding**.
4. The extension highlights the best next action on the page with a
   spotlight overlay + instruction card.
5. Perform the action (click / type / select). The extension detects
   completion and advances to the next step — even across page navigations
   and different domains.
6. Press **Stop** at any time to end guidance.

### Example scenario

> **Goal:** "Apply for driver's license"
>
> | Step | Page | Action |
> |------|------|--------|
> | 1 | Gov portal homepage | Click **"Driver licensing"** |
> | 2 | Driver licensing page | Click **"Apply for a new license"** |
> | 3 | Application form | Type your ID in **"NRIC / ID"** |
> | 4 | Application form | Click **"Next"** |

The system is generic — it works on any site, not just this example.

## Planner modes

| Mode | Requires API key | Description |
|------|------------------|-------------|
| **Local (heuristic)** | No | Rule-based keyword scorer. Matches goal keywords to element text, aria-labels, and link targets. Prioritises CTAs and primary buttons. Works out of the box. |
| **LLM (remote)** | Yes | Sends a simplified page representation (not raw HTML) to a configurable LLM endpoint (OpenAI / Anthropic / custom). Returns a strict JSON response. |

To use LLM mode:

1. Select *LLM (remote)* in the side panel.
2. Choose provider, paste your API key, and optionally set the model name.
3. Click **Save LLM settings**.
4. Settings are stored in `chrome.storage.local` (never leaves your browser
   unless you start guidance).

## Build & install

### Prerequisites

- Node.js >= 18
- npm (or pnpm / yarn)

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Build
npm run build          # one-shot build → dist/

# or watch mode for development:
npm run watch

# 3. Load in Chrome
#    - Open chrome://extensions
#    - Enable "Developer mode" (top-right toggle)
#    - Click "Load unpacked"
#    - Select the  dist/  folder
```

After any rebuild, go to `chrome://extensions` and click the refresh icon on
the NavAI card (or press Ctrl+Shift+E → Update).

### Type-checking (optional)

```bash
npm run typecheck
```

## Project structure

```
NavAI/
├── manifest.json              Manifest V3 config
├── package.json
├── tsconfig.json
├── build.mjs                  esbuild bundler script
├── README.md
└── src/
    ├── background.ts          Service worker — orchestrator
    ├── content.ts             Content script — DOM extraction + overlay
    ├── shared/
    │   ├── types.ts           Shared TypeScript interfaces / message types
    │   └── planner.ts         Heuristic planner + LLM planner stub
    └── ui/
        ├── sidepanel.html     Side-panel markup
        ├── sidepanel.ts       Side-panel logic
        └── sidepanel.css      Side-panel styles
```

Build output lands in `dist/` (this is the folder you point Chrome at).

## Key design decisions

- **No auto-click / auto-type.** The extension only highlights and instructs.
  The user always performs the action.
- **Shadow DOM overlay.** The highlight UI lives inside a closed shadow root
  so it never conflicts with the host page's styles.
- **SPA-aware.** Patches `history.pushState` / `replaceState`, listens for
  `popstate` / `hashchange`, and runs a `MutationObserver` to catch
  client-side navigations.
- **Cross-site.** State is persisted in `chrome.storage.local`; navigation
  to a new origin triggers a fresh page scan automatically.
- **Stable selectors.** Prefers `id`, `data-testid`, `aria-label`, `name`
  over brittle nth-child paths.

## LLM JSON schema

When using LLM mode, the model is instructed to return **only** this JSON:

```json
{
  "stepTitle":   "string",
  "instruction": "string",
  "action":      "click | type | select | scroll | wait",
  "target": {
    "strategy":  "css | xpath | text",
    "selector":  "string",
    "textHint":  "string"
  },
  "validation": {
    "event":       "click | input | change | navigation",
    "successHint": "string"
  }
}
```

## Testing

1. Build and load the extension.
2. Navigate to any multi-page flow (e.g. a government services portal, an
   e-commerce checkout, a university enrollment site).
3. Open the NavAI side panel, enter your goal, and click **Start guiding**.
4. Verify the overlay highlights a relevant element.
5. Click / type / select as instructed and confirm the extension advances.
6. Test **Rescan** (re-evaluates the page) and **Skip** (jumps to next step).
7. Test **Stop** to end guidance and confirm the overlay disappears.

## Permissions

| Permission | Why |
|------------|-----|
| `activeTab` | Read the active tab's URL and inject scripts |
| `scripting` | Programmatic script injection (fallback) |
| `storage` | Persist session state and LLM config |
| `sidePanel` | Open the side-panel UI |
| `webNavigation` | Detect full-page navigations |
| `<all_urls>` (host) | Content script runs on all sites |

## License

MIT
