# Backend Butler

A Home Assistant app: a chat with a Claude agent that looks at your home, controls your devices, and writes automations and scripts for you, asking before it changes anything that matters.

[![Add repository to my Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fbackend-butler%2Fha-addon)

## What it does

- **Ask and control.** "Which lights are on?", "Set the bedroom to 20% warm white." Reads and everyday device control (lights, switches, fans, climate, media players, vacuums) run straight away.
- **Automations and scripts with approval.** It drafts the YAML and shows an approval card, with a diff when it edits. Nothing is written until you approve.
- **Everything else asks too.** Scripts, scenes, automation triggers, buttons, notifications and any other service show a card with the exact call. Locks, alarms and covers are never controlled, and nothing that changes Home Assistant itself (restarts, reloads, updates, backups) runs.
- **Photos, voice, skills.** Send a photo, dictate with your Assist pipeline, and type `/` for skills: seven Home Assistant skills are built in, and you can add your own.
- **iPhone widget and dashboard card.** A [Scriptable](https://scriptable.app) home screen widget ships in [`backend_butler/widget`](backend_butler/widget), and a dashboard launcher card is at [butler-quick-card](https://github.com/backend-butler/ha-card).

## Install

1. Use the button above, or go to **Settings → Apps → App store → ⋮ → Repositories** and add `https://github.com/backend-butler/ha-addon`.
2. Install **Backend Butler**. Home Assistant builds it on your machine, which takes a few minutes on a Raspberry Pi.
3. On the **Configuration** tab, paste an API key from [console.anthropic.com](https://console.anthropic.com), save, and start the app.
4. Open **Backend Butler** in the sidebar.

Needs Home Assistant OS or Supervised, on amd64 or aarch64. Using the agent costs Anthropic API credits on your key, typically a few cents per message, more when it loads a skill.

The full guide is [DOCS.md](backend_butler/DOCS.md), and what changed is in the [CHANGELOG](backend_butler/CHANGELOG.md).

## Security and privacy

- The app is reachable only through Home Assistant's ingress, and only administrators see the panel.
- The agent has no file or shell access. It works through a small set of Home Assistant tools, and the rules above are enforced in code, not just in its instructions. Text it reads from your home (a song title, a calendar invite) is treated as data, never as instructions.
- Your messages, photos, household notes, and the entities and configs the agent looks up go to Anthropic's API with your key, and nowhere else. Chats stay on your Home Assistant until you delete them.

Found a security problem? Please open a [private security advisory](https://github.com/backend-butler/ha-addon/security/advisories/new) rather than a public issue.

## Development

```sh
cd backend_butler
npm ci --ignore-scripts
npm run typecheck && npm test
npm run build
```

`npm test` runs the unit tests. The live tests in a development checkout need a running Home Assistant (`HA_URL`, plus a token) and are not part of this repository.

## License

[MIT](LICENSE). The bundled `ha-*` skills are adapted from [homeassistant-ai/skills](https://github.com/homeassistant-ai/skills), also MIT; see [NOTICE](backend_butler/skills/NOTICE.md).
