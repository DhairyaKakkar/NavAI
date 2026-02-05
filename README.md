# NavAI

AI-powered step-by-step navigation assistant for any website.

## What it does

NavAI guides users through complex websites one step at a time:

1. Enter a goal: "Book a flight on MakeMyTrip"
2. NavAI highlights the next element to interact with
3. User performs the action (click, type, etc.)
4. NavAI detects completion and moves to the next step
5. Repeat until goal is complete

**This is NOT automation.** NavAI never clicks or types for you — it only guides and explains.

## How to Run

1. Install dependencies:
   ```bash
   npm install
   ```

2. Build the extension:
   ```bash
   node build.mjs
   ```

3. Load in Chrome:
   - Go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist/` folder

4. Click the NavAI icon in your toolbar to open the side panel

## Modes

### Heuristic Mode (default)

Works without any API key. Uses keyword matching and scoring:

- Matches goal keywords to element text/labels
- Boosts CTAs: "apply", "submit", "next", "book"
- Penalizes traps: "logout", "cancel", "skip"
- Prefers visible, prominent elements
- Tracks history to avoid repeating actions

### LLM Mode (optional)

For better accuracy on complex sites:

1. Select "LLM (remote)" in the mode dropdown
2. Enter your API details:
   - **OpenAI**: endpoint = `https://api.openai.com/v1/chat/completions`, model = `gpt-4o-mini`
   - **Anthropic**: endpoint = `https://api.anthropic.com/v1/messages`
3. Click "Save"
4. Start guiding

## Architecture

- **Side Panel**: Goal input, step display, controls
- **Background**: Orchestrates flow, runs planner, persists state
- **Content Script**: Extracts DOM elements (max 80), renders overlay, detects actions
- **Planner**: Decides next step (heuristic-first, LLM-optional with 8s timeout)

## License

MIT
