# Backend Butler

Backend Butler is a chat with an AI agent that can look at your Home Assistant, control your devices, and write automations and scripts for you. Open it from **Backend Butler** in the sidebar.

## Setup

1. Get an API key from [console.anthropic.com](https://console.anthropic.com).
2. Open the app's **Configuration** tab and paste it into **Anthropic API key**.
3. Optionally change **Model**. The default is `claude-sonnet-5-5`.
4. Save, then restart the app.

Until a key is set, the chat tells you to add one.

## What it can do

- **Reads and everyday device control run directly.** Looking up entities and states, and turning lights, switches, fans, climate, media players and vacuums on, off or up and down, happen without asking.
- **Everything else asks first.** Running a script or scene, triggering an automation, pressing a button, sending a notification, publishing MQTT, playing a media URL and any other service shows an approval card with the exact call. Text the agent reads (a song title, a calendar invite, a device name) could carry instructions, and these services reach further than one device.
- **Some things are never available.** Physical-security devices (locks, alarms and covers such as garage doors) cannot be controlled, and nothing that changes Home Assistant itself runs (restarts, reloads, backups, updates, shell commands).
- **Automations and scripts always ask first.** Creating, editing or deleting an automation or script shows an approval card with what will change. Nothing is written until you approve it.

## Chats

- Opening the app resumes your last chat if you used it within the past 2 hours. Otherwise you start a new one.
- **Archive** a chat from the chat list to hide it. Archived chats are kept, can be restored, and are never resumed automatically.
- **Delete** removes a chat for good.

## Photos

Attach up to 4 photos to a message and ask about them. Photos are resized on your phone before they are sent.

## Skills

A skill is a saved set of instructions you run by name.

### Built-in Home Assistant skills

Backend Butler ships with seven skills, adapted from the community [Home Assistant best practices](https://github.com/homeassistant-ai/skills) skill:

| Skill | Covers |
|---|---|
| `ha-automations` | Automations and scripts: native triggers and conditions, modes, waits, actions |
| `ha-devices` | Device control, scenes, and why a device isn't responding as expected |
| `ha-safe-changes` | Renames without breaking things, backups, recovering from a bad change |
| `ha-helpers` | Which built-in helper to use instead of a template sensor |
| `ha-templates` | When Jinja is the right tool, and shared macros |
| `ha-dashboards` | Views and card types (advice: Butler can't edit dashboards itself) |
| `ha-blueprints` | Writing and using blueprints |

The agent loads the matching skill by itself before it writes or changes config. You can also run one from the `/` menu. To change a built-in skill, create your own skill with the same name; yours replaces it.

### Your own skills

1. Open the app's config folder: `addon_configs/<id>_backend_butler` (`app_configs/…` on newer Home Assistant versions), reachable with the Samba share or a file editor app. On first start the app creates a `skills` folder there with a README. Create `skills/<name>/SKILL.md`.
2. Start the file with a header giving the skill's `name` and `description`:

   ```
   ---
   name: goodnight
   description: Turn off the living room and dim the nightstands.
   ---
   Turn off every light in the Living Room. Then set the nightstand lights to 10%.
   ```

3. In the chat, type `/goodnight`, or type `/` and pick it from the menu.

Skills are instructions only. They add no new abilities, so everything a skill does still follows the rules above, including approval cards. A skill cannot run shell commands: a skill that tries (a `` !`command` `` line) fails to load.

## Household notes

Create `household.md` in the same folder. The agent always knows what it says, and it wins over general knowledge. Use it for facts about your home and how you talk about it:

```
- "Saffron" means #FF9933.
- The lantern is a plug, not a light.
```

Notes are limited to about 4,000 characters. They are read on each message, so edits apply right away.

## Dashboard card

`butler-quick-card` is a small launcher you put on a dashboard. It never chats itself: a tap opens Butler, optionally ready to take a photo or record your voice.

Install it with [HACS](https://hacs.xyz): **HACS → ⋮ → Custom repositories**, add `https://github.com/backend-butler/ha-card` with the type **Dashboard**, then download **Butler quick card** and reload the browser. Or install it by hand: copy `butler-quick-card.js` from the card repository's latest release to `/config/www/`, then add `/local/butler-quick-card.js` as a JavaScript module under **Settings → Dashboards → ⋮ → Resources**.

### Layouts

**`chatgpt`** is a wide card with a pill and four round buttons: camera, photo, mic and voice.

```yaml
type: custom:butler-quick-card
layout: chatgpt
```

**`grok`** is a square card with a pill and two buttons: new chat and voice.

```yaml
type: custom:butler-quick-card
layout: grok
title: Ask Butler
```

### What the buttons do

Tapping the pill opens Butler with the message box focused. By default each button opens Butler with a single large prompt:

- **Camera** asks you to take a photo, **Photo** asks you to choose one. Browsers only allow the camera and photo picker after a tap, so Butler cannot open them for you. Tap the prompt and it starts.
- **Mic** asks you to start recording. The transcript lands in the message box so you can review it before sending.
- **Voice** works the same way, but sends the message automatically once your words are transcribed.
- **New chat** (Grok layout) opens Butler on a fresh chat.

Mic and voice need the voice pipeline set up (see **Voice pipeline** in the app's Configuration tab).

### Options

| Option | Default | What it does |
|---|---|---|
| `layout` | `chatgpt` | `chatgpt` or `grok` |
| `title` | `Ask Butler` | The text in the pill |
| `show_logo` / `logo_url` | logo shown | Hide the logo, or use your own image |
| `panel_path` | found automatically | Where Butler's sidebar panel lives. Only set it if you renamed or forked the app |
| `theme` | `dark` | `dark`, or `auto` to follow your Home Assistant theme |
| `tap_action` | open Butler | Action for the pill |
| `conversation_agent` | none | Send buttons to Home Assistant Assist instead of Butler |
| `actions` | the layout's buttons | Choose and customise the buttons (up to 4) |

The visual editor covers everything except the actions of individual buttons. Those are set in YAML.

### Changing what a button does

Each button accepts a standard Home Assistant `tap_action`. Use `action: butler` (with an optional `intent`) for the default behaviour.

```yaml
type: custom:butler-quick-card
layout: chatgpt
theme: auto
actions:
  - id: camera
  - id: image
  - id: mic
    tap_action:
      action: navigate
      navigation_path: /lovelace/rooms
  - id: voice
    tap_action:
      action: perform-action
      perform_action: script.turn_on
      target:
        entity_id: script.goodnight
```

To start Home Assistant Assist from a button, use the `assist` action:

```yaml
type: custom:butler-quick-card
layout: grok
actions:
  - id: compose
  - id: voice
    tap_action:
      action: assist
      start_listening: true
```

`conversation_agent` is a shorthand for that: every button without its own `tap_action` runs Assist with that agent's pipeline.

```yaml
type: custom:butler-quick-card
conversation_agent: conversation.home_assistant
```

## iPhone home screen widget

`widget/butler-widget.js` is a widget for [Scriptable](https://scriptable.app), a free iOS app. On a medium widget it shows an **Ask Butler** bar and four buttons, like the ChatGPT widget:

| Tap | What happens |
|---|---|
| Ask Butler | Opens Butler with the message box ready |
| Camera / photo | Opens Butler with one tap left to open the camera or your library |
| Microphone | You dictate on the phone; Butler opens a new chat with your words in the box to check |
| Waveform | You dictate on the phone; Butler opens a new chat with your words and one big **Send** button |

Dictation happens in Scriptable, with iPhone dictation, so it works at home over plain `http` too. A small widget is a single button that opens the message box.

To install it: in Scriptable tap **+**, paste the file, and name the script `Butler`. Then add a Scriptable widget to the home screen, edit it, and pick the script **Butler**.

If you installed Butler some other way than from `https://github.com/backend-butler/ha-addon`, set `PANEL` at the top of the script to your panel's path: open Butler in a browser and copy what follows the host in the address bar (for a local copy, `local_backend_butler`).

The widget uses Home Assistant app links, which you can also use from Shortcuts or anywhere else: `homeassistant://navigate/<panel>?butler=<kind>`, where kind is `field`, `camera`, `photo`, `mic`, `voice` or `new`. `butler=say&text=<words>` puts the words in a new chat with a **Send** button, and `butler=draft&text=<words>` just puts them in the box. A link never sends anything by itself: anyone can make a link, so you always see the words and tap Send. If a change is waiting for your approval, Butler stays in that chat and puts the words in the box instead.

## Privacy

**What leaves your home:** your messages and photos, your household notes, and what the agent looks up (entity names, areas, states and attributes, and automation and script configs it reads to edit) go to Anthropic's API with your key. Nothing goes anywhere else. Voice is transcribed by the Assist pipeline you choose in Home Assistant, so where the audio goes depends on its speech-to-text engine. The app keeps no audio.

**What stays on your Home Assistant:** chats, the photos you send, and the agent's session history, in the app's data folder. They are kept until you delete the chat; deleting it removes its photos and history too. Archived chats are kept. App backups include this folder. Your API key is stored in the app's options like any other app setting.

**Who can see chats:** every Home Assistant administrator. The panel is admin-only, and all admins share one chat list.

## Troubleshooting

- **"No Anthropic API key is configured":** add your key on the Configuration tab and restart the app.
- **An error from Home Assistant:** the agent shows Home Assistant's error text as it was returned and says what it will try next.
- **A request is refused:** locks, alarms and covers are never controlled, and services that change Home Assistant itself (restarts, reloads, backups, updates, shell commands) are not available. Other services that aren't everyday device control show an approval card first.
- **A skill or note is missing:** check the file name and location (`skills/<name>/SKILL.md`, `household.md`) and that the skill header has both `name` and `description`.
