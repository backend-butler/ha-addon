# Changelog

All notable changes to this app are listed here, newest first.

## 0.6.0

### Security
- **Service calls beyond everyday device control now ask first.** Lights, switches, fans, climate, media players and vacuums still run at once. Scripts, scenes, automation triggers, buttons, notifications, MQTT, media URLs and every other service now show an approval card with the exact call. Before, only a deny-list stood in the way, and text the agent reads (a song title, a calendar invite) could have steered it into those.
- **A link never sends a message by itself.** `?butler=say` puts the words in the box with a Send button. Before, anyone who got you to open a link could make Butler act.
- Butler action links are removed from the agent's replies, and link actions only count on Butler's own page.
- The agent is told that text inside Home Assistant data is never an instruction, and long attribute text is cut to 300 characters.
- Photos must really be JPEG, PNG or WebP (their first bytes are checked), and a stored photo is never overwritten.
- New response headers: a Content-Security-Policy on the page, `nosniff` and `no-referrer` everywhere.

### Changed
- The app image now builds from source inside Home Assistant, on a pinned base image, with dependency install scripts blocked. The final image carries Node only.

## 0.5.0

### Added
- An iPhone home screen widget for Scriptable (`widget/butler-widget.js`), styled like the ChatGPT widget. Its microphone and waveform buttons use iPhone dictation, so they work without HTTPS.
- Home Assistant app links open Butler ready for an action: `?butler=camera`, `?butler=say&text=…` and so on (see DOCS).

### Fixed
- The card's new-chat button could land in the resumed chat when Butler was not already open.

## 0.4.0

### Added
- A dashboard card, `custom:butler-quick-card`: a compact launcher in two layouts (`chatgpt` and `grok`) that opens Butler from any dashboard.
- Buttons for camera, photo, microphone, voice and a new chat. Each opens Butler with a one-tap prompt, because browsers need a tap before they allow the camera or microphone.
- Any button can run a standard Home Assistant action instead (navigate, perform-action, assist and more), and `conversation_agent` sends buttons to Home Assistant Assist.
- A visual card editor, and `theme: auto` to follow your Home Assistant theme.
- `scripts/deploy-local.sh` now also copies the card into Home Assistant and registers its dashboard resource.

## 0.3.0

### Added
- Voice input: a microphone button in the message box records you and turns it into text with a Home Assistant Assist pipeline.
- The **Voice pipeline** option (`stt_pipeline`) picks which pipeline does the transcription. `auto` chooses one with a cloud speech-to-text engine.
- The transcript lands in the message box so you can review and edit it before sending.

## 0.2.0

### Added
- Archive chats from the chat list and restore them later. Archived chats are hidden and never resumed automatically.
- Send photos with a message: up to 4 per message, resized on your phone before upload.
- Skills: type `/` in the message box to run a skill from your skills folder.
- Household notes: standing facts in `household.md` that the agent always knows.
- The app has its own config folder in `/addon_configs`, where skills and household notes live.
- A Documentation tab, option labels, and an app icon and logo.

## 0.1.0

### Added
- Chat with a Claude agent that reads and controls your Home Assistant devices.
- Approval cards for creating, editing and deleting automations and scripts.
- Chat history, resuming your last chat within 2 hours, and delete.
- A layout for phone and desktop inside Home Assistant, following your Home Assistant theme.
- Home Assistant errors are shown as they were returned.
