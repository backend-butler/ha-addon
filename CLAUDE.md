# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Home Assistant app (add-on) repository. The only app is `backend_butler/`: a Node server plus a React chat UI, served through HA ingress, that runs an AI agent (via `@anthropic-ai/claude-agent-sdk`) which reads and controls Home Assistant and drafts automations and scripts for the user to approve. The repo root holds only `repository.yaml`, the README, and CI.

## Commands

Run everything from `backend_butler/`:

```sh
npm ci --ignore-scripts                     # install (no dependency needs install scripts)
npm run typecheck                           # tsc --noEmit over server, web, shared, test
npm test                                    # vitest run test/unit
npx vitest run test/unit/approvals.test.ts  # a single file
npx vitest run -t "name of test"            # tests matching a name
npm run build                               # vite → dist/web, esbuild → dist/server.mjs
npm run dev                                 # build the UI, then run the server with tsx (dev mode)
```

There are no live tests in this repo: tests against a real Home Assistant live elsewhere. The dashboard card is in the separate `backend-butler/ha-card` repo.

CI calls the shared workflow `backend-butler/.github/.github/workflows/node-ci.yml` and `frenck/action-app-linter` on `config.yaml`.

**Dev mode.** Without `SUPERVISOR_TOKEN`, `server/config.ts` reads the API key from `~/.anthropic_key` (or `ANTHROPIC_KEY_FILE`), the HA token from `~/.ha_token` (or `HA_TOKEN_FILE`), `HA_URL` (default `http://homeassistant.local:8123`), and stores data in `.data/`. It binds to 127.0.0.1:8099 with no peer filter. In app mode, options come from `/data/options.json`, HA is reached at `http://supervisor/core`, and only the ingress peer `172.30.32.2` may connect.

## Architecture

- `server/`: a plain `node:http` server with a hand-written router in `index.ts` (no framework). `/api/chat` streams SSE. Everything outside `/api/` is the built SPA, served with a hashed CSP.
- `web/`: the React 19 UI built by Vite with `root: "web"` and `base: "./"`. Asset URLs must stay relative so the page works under HA's per-install ingress prefix.
- `shared/`: code imported by both the server and the UI. `transcript.ts` has `applyEvent`/`settle`, the fold that turns agent events into message parts. The server records saved turns with the same fold the UI renders with, so if you change the event shape, change both sides through this file.
- `skills/`: bundled `ha-*` SKILL.md files (adapted from homeassistant-ai/skills, MIT). At runtime, `agent.ts:syncSkills` symlinks the bundled skills and the user's `/config/skills` into `CLAUDE_CONFIG_DIR/skills`. A user skill with the same name overrides the bundled one.
- `widget/`: a standalone Scriptable iPhone widget. It is not part of the build.

### One chat turn

`chat.ts:handleChat` → `buildTools` creates an in-process MCP server named `ha` (tools appear as `mcp__ha__<name>`, see `ha/tool-names.ts`) → `agent.ts:runAgent` calls the SDK `query()` → SDK messages are translated to SSE events (`text`, `tool`, `tool_result`, `approval`, `approval_result`, `done`, `error`) → the turn is saved by `ChatStore`, one JSON file per chat plus `index.json` under `<dataDir>/chats`. The chat's SDK `sessionId` is stored so the next turn can resume it.

### Agent sandbox (security-critical; keep these settings)

`runAgent` gives the SDK `tools: ["Skill"]` only, so the agent has no file, shell or web access. It also sets `permissionMode: "default"` explicitly (if omitted, the SDK's auto mode bypasses `canUseTool`), `settingSources: ["user"]` with an app-owned `CLAUDE_CONFIG_DIR`, and a fully replaced `env`. Bundled skills must therefore be self-contained: the agent cannot read other files in a skill folder.

### Approval gate (`server/approvals.ts`)

- Read tools (`ha/tools-read.ts`) and `Skill` are in `allowedTools` and run without asking.
- `call_service` and the automation/script write tools are deliberately left out of `allowedTools`, so every call goes through `ApprovalGate.canUseTool`. A `GatedTool` either auto-allows the call (everyday device control: `EVERYDAY` in `ha/tools-act.ts`) or calls `prepare()` to build a YAML or diff preview, emits an `approval` card, and waits for `POST /api/approval`.
- An approval grants one execution of exactly the approved input, keyed by `callKey(name, normalize(input))`. The tool handler must call `gate().consume(...)` before it writes, as defence in depth.
- Because of that key, **zod schemas of gated tools must not use defaults or transforms, and objects must be `looseObject`**. Otherwise the parsed args differ from the approved input and `consume` fails.
- `checkService` hard-blocks HA-internal domains, `reload*` services and physical-security domains (`lock`, `alarm_control_panel`, `cover`). These rules are enforced in code, not only in the prompt.

### Prompt (`server/prompt.ts`)

The system prompt is kept stable across turns for prompt caching: it holds the entity/area map and the household notes from `/config/household.md`, but no clock or live state. The current time is prepended to each user message by `withTime`. A `/skill` message keeps `/` as its first character because the SDK only treats a prompt as a command when it starts with `/`.

### Link protocol

`shared/intent.ts` parses `?butler=...` links. A link only puts text in the composer; it never sends. `test/fixtures/link-cases.json` is a copy of `spec/link-cases.json` from `github.com/backend-butler/backend-butler`. Update it from there rather than editing it locally.

## Releasing

A release bumps `version` in `backend_butler/config.yaml` (HA reads that version, not `package.json`) and adds an entry at the top of `backend_butler/CHANGELOG.md`, written for users. User-facing option text lives in `translations/en.yaml`, and the full user guide is `DOCS.md`. HA builds the image from `Dockerfile` on the user's machine (amd64/aarch64, Alpine base), so the build must work from source with `npm ci --ignore-scripts`.
