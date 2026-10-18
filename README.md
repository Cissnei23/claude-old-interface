# Claude local interface

A small local Claude-style chat interface with streaming responses, project context, artifacts, and a local bridge for Claude Code or an OpenAI-compatible relay.

## Requirements

- Windows
- Node.js 18 or newer
- Claude Code installed and authenticated if using the Claude Code provider

## Run locally

Double-click `start-app.cmd`, or run:

```powershell
node server.js
```

Then open <http://127.0.0.1:8780>.

The app starts in local Mock mode when no provider credentials are configured. A custom relay can be configured from the Settings panel. Credentials are kept in browser local storage and are not part of this repository.

## Local data and privacy

Runtime data is stored under `data/` and is intentionally ignored by Git. This includes conversations, project files, artifacts, and shared UI state. Do not remove that directory if you want to preserve local history.

The repository also ignores local screenshots, device-specific URLs, environment files, and private key files.

## Main files

- `index.html` — app structure
- `style.css` — interface styling and responsive layouts
- `script.js` — client state, chat UI, streaming, projects, and artifacts
- `server.js` — local HTTP server and provider bridge
- `claude-wordmark-source.svg` — official wordmark source used by the UI

