---
name: ha-devices
description: >
  Home Assistant device control and scenes: action/target structure, entity_id vs device_id, lights, climate, covers, media players, vacuum, notifications, button/remote triggers (event entities, ZHA, Z2M), scenes, snapshot and restore, and why a device does not respond as expected. Load for "turn on/set the light", "my remote/button automation", "make a scene", "put it back after", "why won't X respond".
---
# Device Control and Scenes

## Core rules

**Core principle:** Use native Home Assistant constructs wherever possible. Templates bypass validation, fail silently at runtime, and make debugging opaque.

**Features marked with a release (2026.5+) depend on the instance's version.** Butler cannot read HA's version directly. If a 2026.x feature matters (for example `speed` on covers needs 2026.9, `vacuum.clean_area` needs 2026.3, purpose-specific triggers are default since 2026.7), ask the user to check Settings > About, or say which version it needs. On that release or later, use the feature and do not offer the older way as an equal choice. If you cannot learn the version, assume a current release and name the older fallback with the version it needs.

**What Butler can and cannot do here.**
- Butler can read state (`find_entities`, `get_states`), control devices (`call_service` with explicit entity ids only, never areas; locks, alarms, covers and HA system/reload services are blocked by a deny-list), and create/edit/delete automations and scripts (`upsert_automation`, `upsert_script`, `delete_automation`, `delete_script`; the user approves a YAML preview or diff).
- Butler cannot edit configuration.yaml or files, create helpers, edit dashboards, rename entities, edit registries, restart/reload HA, or take backups. For those, give the user the exact steps or config to apply in HA's UI (Settings > ...) and say clearly that Butler cannot do it itself.
- Scenes: Butler has no scene-editing tool. It can activate an existing scene or apply states via `call_service` (if the domain is not blocked), and it can use `scene.create` / `scene.turn_on` / `scene.apply` inside a script or automation it upserts. Creating a persistent scene is something the user does in Settings > Automations & Scenes > Scenes.

**Decision workflow steps that concern devices:**
- Check for a purpose-specific, then generic native, trigger/condition before any template. Since 2026.7 the default building blocks are purpose-specific triggers/conditions (`<domain>.<name>`: motion detected, battery low, door opened) with area/floor/label targets. A purpose-specific trigger takes `entity_id` in its `target:` too, so one known sensor is not a reason to fall back to `trigger: state`.
  - `trigger: state` on a motion/occupancy/door `binary_sensor` becomes `motion.detected`/`motion.cleared`, `occupancy.detected`/`occupancy.cleared` or `door.opened`/`door.closed` with `target: {entity_id: ...}`, or `area_id` when the area is known.
  - A list of individual sensor entities in a trigger becomes one purpose-specific trigger with an area/floor/label `target:`.
- Use entity_id over device_id. `device_id` breaks when devices are re-added. Exception: Zigbee2MQTT autodiscovered device triggers are acceptable.
- For buttons and remotes:
  - Any integration exposing an `event.*` entity: use `event.received` targeting that entity.
  - ZHA: no event entities; use an `event` trigger with `device_ieee` (persistent).
  - Z2M: event entities are experimental and off by default; use a `device` trigger (autodiscovered) or `mqtt` trigger.

**Critical anti-patterns for this topic:**

| Anti-pattern | Use instead | Why |
|---|---|---|
| `device_id` in triggers | `entity_id` (or `device_ieee` for ZHA) | device_id breaks on re-add |
| `event` trigger on an integration's bus event (e.g. `hue_event`) for a button that has an `event.*` entity | `event.received` targeting that entity, with values read from its `event_types` attribute | The entity can be renamed and survives a re-add when the integration keeps a stable unique ID; bus event data differs per integration |
| `vacuum.send_command` with vendor room IDs | `vacuum.clean_area` with HA area IDs in `cleaning_area_id` (if segments are mapped) | Uses native HA areas, works across integrations, but requires segment-to-area mapping in entity settings first |
| `color_temp` (mireds) in light actions | `color_temp_kelvin`, converted: Kelvin = 1,000,000 / mireds (500 mireds = 2000 K) | `color_temp` was removed in 2026.3; only Kelvin is supported, and HA accepts any positive number there, so a mireds value copied across is read as Kelvin (500 mireds becomes 500 K) |
| Saving states or attributes in `variables:`, or hard-coding values, to put devices back after a temporary change | `scene.create` with `snapshot_entities` before the change, then `scene.turn_on` on that scene | The snapshot keeps each entity's own state, including a light that was off, in one call; variables need a template per attribute and a restore step per entity |
| Entity list in a trigger where an area/floor/label target fits | Purpose-specific trigger with `target: {area_id: ...}` | Automation follows area membership as devices change; no stale entity lists |

> The YAML in this skill shows config shape. Butler submits actions and triggers as part of an automation or script object through `upsert_automation` / `upsert_script`, which HA validates; the user approves before it is saved. Never ask the user to hand-edit files for these.

> Check for a purpose-specific trigger first. Since 2026.7 the default building block is a purpose-specific trigger/condition (`motion.detected`, `door.opened`, `switch.turned_on`, `temperature.crossed_threshold`) aimed at a `target:` that accepts an area, floor, or label instead of a list of entity IDs. The generic `state` patterns below remain correct and are the right answer when no purpose-specific block matches. A purpose-specific `target:` takes `entity_id` / `area_id` / `floor_id` / `label_id` (and `device_id`, which you should still avoid); targeting an area removes the stale entity list and the `device_id` at once. For the full trigger/condition reference, see the ha-automations skill.

## Entity ID vs Device ID

### The core problem

`device_id` is a Home Assistant internal identifier that **changes when a device is re-added** (e.g., after Zigbee mesh repair, integration re-setup, or hardware replacement). Automations using `device_id` will break silently.

`entity_id` is user-controllable, stable across device re-adds, and can be renamed for clarity.

### Device triggers vs state triggers

```yaml
# WRONG — device_id changes if device is re-added
triggers:
  - trigger: device
    device_id: abc123def456
    domain: binary_sensor
    type: motion

# RIGHT — entity_id is stable and renameable
#    (generic fallback — check motion.detected with an area target first)
triggers:
  - trigger: state
    entity_id: binary_sensor.hallway_motion
    to: "on"
```

### When device_id is acceptable

1. **Device-only triggers**: some devices expose triggers without entities (see the Zigbee sections).
2. **Temporary automations**: quick tests you will delete.
3. **UI-created automations**: the UI defaults to device triggers; convert to entity triggers for production.

## Action best practices

### Use target: structure

Modern Home Assistant actions use the `target:` key to specify entities, areas, or devices:

```yaml
actions:
  - action: light.turn_on
    target:
      entity_id: light.living_room
    data:
      brightness_pct: 100
```

(Butler's own `call_service` tool is stricter than automation YAML: always pass explicit entity ids, never an area.)

### Target types

| Type | Use case | Persistence |
|---|---|---|
| `entity_id` | Specific entities | Stable (recommended) |
| `area_id` | All entities in a room | Stable |
| `device_id` | All entities on a device | Changes on re-add |

Caution: an area target hits every matching entity in that area, including entities that are not what the user means (see Troubleshooting below).

### Multiple targets

```yaml
# Multiple entities
target:
  entity_id:
    - light.living_room
    - light.kitchen
    - light.bedroom

# Area targeting (all lights in living room)
target:
  area_id: living_room

# Combined (entities + areas)
target:
  entity_id: light.hallway
  area_id:
    - bedroom
    - bathroom
```

### Template in targets

```yaml
# Dynamic entity selection
target:
  entity_id: "{{ state_attr('sensor.motion_zone', 'light_entity') }}"

# All lights currently on (advanced)
target:
  entity_id: >
    {{ states.light
       | selectattr('state', 'eq', 'on')
       | map(attribute='entity_id')
       | list }}
```

## Button/remote patterns

### First: does the integration expose an `event.*` entity?

Many integrations now represent a stateless button press as an **event entity** rather than a bus event or a device trigger. Where one exists and is stable, it is the best target: a normal entity, so it can be renamed, is reachable by area or label, and survives a device re-add as long as the integration assigns a stable unique ID. Trigger on it with `event.received`:

```yaml
triggers:
  - trigger: event.received
    target:
      entity_id: event.living_room_remote_button
    options:
      event_type:
        - short_release   # values are integration-defined; read them off the entity
```

The available `event_type` values come from the entity's own `event_types` attribute. Read them (with `get_states` on the event entity) rather than guessing. A plain `state` trigger on the entity fires on *any* event type, which is the right choice only when you genuinely want all of them.

No double-press value in that list means the device does not report one. For example, HA's Hue integration leaves `double_short_release` out of every Hue button's `event_types`. Say so, and offer to count two presses within a short window instead of inventing a value.

Two Zigbee stacks are exceptions:

- **ZHA has no event platform**, so ZHA remotes use the `zha_event` pattern below.
- **Zigbee2MQTT's event entities are experimental and off by default**: they need `homeassistant: {experimental_event_entities: true}`, and Z2M documents both the feature and its event-type names as subject to change. Prefer its autodiscovered `device` trigger or an `mqtt` trigger unless the user has already opted in.

### ZHA (Zigbee Home Automation)

ZHA buttons fire `zha_event` events. Use **event triggers** with `device_ieee` (the device's IEEE address), which is **persistent** across re-adds.

```yaml
# RIGHT — device_ieee is persistent across re-adds
triggers:
  - trigger: event
    event_type: zha_event
    event_data:
      device_ieee: "00:15:8d:00:07:26:f2:8a"
      command: "toggle"
```

For a multi-button remote, use `trigger_id` on each trigger plus a `choose` in the actions (see the ha-automations skill).

#### Finding ZHA event data (user steps; Butler cannot do this)

1. Go to **Tools > Events** (named **Developer Tools** before 2026.8).
2. Subscribe to `zha_event`.
3. Press the button.
4. Copy the `device_ieee` and `command` values.

### Zigbee2MQTT (Z2M)

Z2M creates **MQTT device triggers** that are autodiscovered. These are acceptable because Z2M manages the device-to-trigger mapping.

```yaml
# RIGHT — Z2M device_id is managed by autodiscovery
triggers:
  - trigger: device
    device_id: abc123def456  # OK for Z2M, managed by autodiscovery
    domain: mqtt
    type: action
    subtype: single

# Alternative: MQTT topic trigger (more explicit)
triggers:
  - trigger: mqtt
    topic: "zigbee2mqtt/Bedroom Button/action"
    payload: "single"
```

#### Z2M device trigger discovery (user steps)

1. Open the device in **Settings > Devices**.
2. Look for available triggers under "Automations".
3. The UI shows valid trigger types and subtypes.

### Z2M vs ZHA comparison

| Aspect | ZHA | Zigbee2MQTT |
|---|---|---|
| Trigger type | `event` trigger | `device` trigger or `mqtt` trigger |
| Identifier | `device_ieee` (persistent) | `device_id` (autodiscovered) |
| Event name | `zha_event` | MQTT device trigger |
| Button actions | `command` field | `type` and `subtype` |

## Domain-specific patterns

### Lights

**Color temperature:** Always use `color_temp_kelvin` (e.g., `3000`). The legacy `color_temp` parameter (in mireds) was removed in 2026.3. When migrating, convert the value: Kelvin = 1,000,000 / mireds (500 mireds = 2000 K).

```yaml
# Turn on with brightness and transition
actions:
  - action: light.turn_on
    target:
      entity_id: light.living_room
    data:
      brightness_pct: 80
      transition: 2
      color_temp_kelvin: 3000

# Turn on multiple lights differently
actions:
  - action: light.turn_on
    target:
      entity_id: light.main
    data:
      brightness_pct: 100
  - action: light.turn_on
    target:
      entity_id: light.accent
    data:
      brightness_pct: 30
      rgb_color: [255, 147, 41]
```

### Climate

```yaml
# Set temperature with HVAC mode
actions:
  - action: climate.set_temperature
    target:
      entity_id: climate.living_room
    data:
      temperature: 22
      hvac_mode: heat

# Set preset mode
actions:
  - action: climate.set_preset_mode
    target:
      entity_id: climate.living_room
    data:
      preset_mode: away
```

### Covers (blinds/shades)

Note: Butler's `call_service` blocks the cover domain. Covers can be written into an automation or script Butler upserts (the user approves it), or the user operates them directly.

```yaml
# Set to specific position (0 = closed, 100 = open)
actions:
  - action: cover.set_cover_position
    target:
      entity_id: cover.living_room_blinds
    data:
      position: 50

# Tilt control
actions:
  - action: cover.set_cover_tilt_position
    target:
      entity_id: cover.living_room_blinds
    data:
      tilt_position: 75
```

**Speed (2026.9+):** `cover.open_cover`, `cover.close_cover` and `cover.set_cover_position` take an optional `speed`. The values are per entity: read its `supported_speeds` attribute (with `get_states`) and pass one of those strings. A value outside that list raises a validation error. A cover with no `supported_speeds` ignores the option and moves at its normal speed.

```yaml
actions:
  - action: cover.set_cover_position
    target:
      entity_id: cover.living_room_blinds
    data:
      position: 50
      speed: fast          # one of the entity's supported_speeds
```

### Media players

```yaml
# Play media
actions:
  - action: media_player.play_media
    target:
      entity_id: media_player.living_room_speaker
    data:
      media_content_id: "https://example.com/audio.mp3"
      media_content_type: music

# Set volume (0.0 to 1.0)
actions:
  - action: media_player.volume_set
    target:
      entity_id: media_player.living_room_speaker
    data:
      volume_level: 0.5
```

### Notifications

```yaml
# Mobile app notification
actions:
  - action: notify.mobile_app_phone
    data:
      title: "Motion Detected"
      message: "Motion in {{ entity_name(trigger.entity_id) }}"
      data:
        tag: "motion-alert"
        actions:
          - action: "DISMISS"
            title: "Dismiss"
          - action: "VIEW_CAMERA"
            title: "View Camera"

# Persistent notification
actions:
  - action: notify.persistent_notification
    data:
      title: "Reminder"
      message: "Check the laundry"
      data:
        notification_id: "laundry_reminder"   # nested: a top-level key is rejected
```

## Vacuum control

```yaml
# Start cleaning
actions:
  - action: vacuum.start
    target:
      entity_id: vacuum.roborock

# Return to dock
actions:
  - action: vacuum.return_to_base
    target:
      entity_id: vacuum.roborock

# Clean specific areas (2026.3+ — uses HA areas, not vendor room IDs)
# Requires mapping vacuum segments to HA areas in entity settings first
# Supported integrations include Matter, Ecovacs, Roborock (list may grow)
actions:
  - action: vacuum.clean_area
    target:
      entity_id: vacuum.roborock
    data:
      cleaning_area_id:           # NOT area_id: under data: that is read as a target
        - kitchen
        - living_room
```

**Prefer `vacuum.clean_area`** when the user has mapped vacuum segments to HA areas (entity settings). It works across supported integrations without vendor lock-in.

**Fallback:** when the integration does not support `clean_area` or segments are not mapped, use `vacuum.send_command` with integration-specific parameters:

```yaml
# Integration-specific room cleaning (fallback)
actions:
  - action: vacuum.send_command
    target:
      entity_id: vacuum.roborock
    data:
      command: app_segment_clean
      params:
        - 16  # Vendor-specific room ID
        - 17
```

Suggest the user configure segment-to-area mapping (in the vacuum entity's settings in the UI; Butler cannot do it) to avoid vendor lock-in.

## Response data

Some actions return data. Use `response_variable` to capture it:

```yaml
actions:
  - action: weather.get_forecasts
    target:
      entity_id: weather.home
    data:
      type: hourly
    response_variable: forecast
  - action: notify.mobile_app_phone
    data:
      message: "Tomorrow's high: {{ forecast['weather.home'].forecast[0].temperature }}°C"
```

## Common mistakes

### Using entity_id in data instead of target

```yaml
# WRONG — entity_id inside data: is the pre-2024.8 form
actions:
  - action: light.turn_on
    data:
      entity_id: light.living_room
      brightness: 255

# RIGHT — entities go in target:, parameters in data:
actions:
  - action: light.turn_on
    target:
      entity_id: light.living_room
    data:
      brightness: 255
```

### Hardcoding device_id for regular devices

```yaml
# WRONG — breaks on device re-add
actions:
  - action: light.turn_on
    target:
      device_id: abc123def456

# RIGHT — entity_id survives a device re-add
actions:
  - action: light.turn_on
    target:
      entity_id: light.living_room
```

### Forgetting action data structure

```yaml
# WRONG — brightness_pct at wrong level
actions:
  - action: light.turn_on
    target:
      entity_id: light.living_room
    brightness_pct: 100

# RIGHT — brightness_pct inside data
actions:
  - action: light.turn_on
    target:
      entity_id: light.living_room
    data:
      brightness_pct: 100
```

## Quick reference: action structure

```yaml
actions:
  - action: <domain>.<name>       # Required
    target:                       # Optional but recommended
      entity_id: entity.id        # Single or list
      area_id: area_name          # Single or list
      device_id: device_id        # Avoid except for Z2M
    data:                         # Action-specific parameters
      parameter: value
    response_variable: result     # Capture response (if needed)
```

## Quick reference: trigger types for devices

Read left to right and stop at the first column that applies.

| Device type | Purpose-specific (check first) | Generic fallback | Zigbee specifics |
|---|---|---|---|
| Button/Remote | `event.received` on the `event.*` entity, when one exists | `state` on the `event.*` entity (fires on any event type) | ZHA: `event` trigger on `zha_event` + `device_ieee`. Z2M: `device` or `mqtt` trigger |
| Motion sensor | `motion.detected` / `motion.cleared` | `state` | — |
| Door/Window | `door.opened` / `door.closed`, `window.opened` / `window.closed` | `state` | — |
| Temperature | `temperature.crossed_threshold` / `temperature.changed` | `numeric_state` or `state` | — |
| Switch | `switch.turned_on` / `switch.turned_off` | `state` | — |
| Battery (low flag, `binary_sensor`) | `battery.became_low` / `battery.no_longer_low` | `state` | — |
| Battery (percentage, `sensor`) | `battery.level_crossed_threshold` / `battery.level_changed` | `numeric_state` | — |

`battery.level_changed` fires on every level change while the reading is inside its threshold. For a one-time "dropped below N%" alert use `battery.level_crossed_threshold`: it fires only on the crossing, and ignores changes coming from `unavailable`/`unknown`, so a restart does not fire it again.

Two rules survive whichever column you land in: **do not key a trigger off a `device_id`** outside the cases in "When device_id is acceptable", and **prefer a `target:` over a list of entity IDs** when the automation is really about "this area" rather than these specific entities. The area keeps working as devices are added, swapped, or removed.

## Scenes

> Scenes have a config API like automations and scripts; editing `scenes.yaml` is the fallback, not the default. Butler has no scene-editing tool: the user creates or edits persistent scenes in Settings > Automations & Scenes > Scenes. The YAML below shows config shape.

A scene is a **saved snapshot of target entity states, applied atomically**, not a sequential script. Activating it pushes every listed entity toward its stored state at once (optionally with a transition). Use a scene to *restore a set of states*; use a script's `sequence` when you need ordered, conditional, or timed steps.

### Scene config shape

```yaml
# One scene object (no `scene:` file wrapper)
name: Romantic            # required; `id:` optional but recommended (stable unique id)
icon: "mdi:flower-tulip"  # optional
entities:
  light.tv_back_light: "on"          # simple form: entity_id → state string
  light.ceiling:                     # object form: state + attributes
    state: "on"
    brightness: 200                  # 0–255
    color_temp_kelvin: 2700          # Kelvin — NOT color_temp/mireds (removed 2026.3)
  climate.living_room:
    state: "heat"
    temperature: 21
```

- `entities` is a dict mapping `entity_id` to a state string, or an object with `state` plus the entity's attributes.
- Light color attributes use `color_temp_kelvin` / `rgb_color` / `xy_color` / `hs_color`. The mireds-based `color_temp` (and `kelvin`/`min_mireds`/`max_mireds`) were removed in 2026.3.
- A scene only sets the attributes you list; unlisted entities/attributes are untouched.
- UI-created scenes live in `scenes.yaml` and snapshot the *current* state of each added entity at save time.

### Activating a scene

```yaml
actions:
  - action: scene.turn_on
    target:
      entity_id: scene.romantic
    data:
      transition: 2.5      # optional, seconds
```

### Snapshot + restore (scene.create)

Capture live states into a transient scene, then restore them later: the canonical "save current state, do something, put it back" pattern. This goes inside a script or automation (Butler can upsert one).

```yaml
# Capture current states (transient scene — discarded on a config/scene reload)
- action: scene.create
  data:
    scene_id: before_alert          # required; lowercase + underscores
    snapshot_entities:              # capture the CURRENT state of these
      - light.living_room
      - light.kitchen
    entities:                       # optionally also set explicit states
      light.porch:
        state: "on"
        brightness: 255
# ...later, restore exactly what was captured:
- action: scene.turn_on
  target:
    entity_id: scene.before_alert
```

`scene.create` requires at least one of `snapshot_entities` / `entities` (they combine). The created scene is temporary and lost on a config/scene reload.

### Apply states without storing (scene.apply)

Push a one-off set of states atomically, with no `scene.*` entity created.

```yaml
- action: scene.apply
  data:
    entities:                       # same shape as a scene's `entities`
      light.tv_back_light:
        state: "on"
        brightness: 100
      light.ceiling: "off"
    transition: 2.5                 # optional, seconds
```

### Reloading scenes

After editing scene YAML by hand, the user applies it without a restart with `scene.reload` (Butler cannot reload HA services itself; the UI scene editor reloads automatically).

```yaml
- action: scene.reload
```

## Domain, trigger, condition and action documentation

Butler cannot fetch web pages. When exact keys or options are uncertain, tell the user which doc page to check, or rely on `get_states` attributes (for example `event_types`, `supported_speeds`) for per-entity values. Do not guess keys.

- Integration/domain docs: `https://raw.githubusercontent.com/home-assistant/home-assistant.io/refs/heads/current/source/_integrations/{domain}.markdown` (replace `{domain}` with e.g. `light`, `climate`, `mqtt`).
- Since 2026.7, every purpose-specific trigger and condition, and every action, has a dedicated doc page covering what it does, when to use it, config shape, options and worked examples:
  - `https://raw.githubusercontent.com/home-assistant/home-assistant.io/refs/heads/current/source/_triggers/{trigger}.markdown`
  - `https://raw.githubusercontent.com/home-assistant/home-assistant.io/refs/heads/current/source/_conditions/{condition}.markdown`
  - `https://raw.githubusercontent.com/home-assistant/home-assistant.io/refs/heads/current/source/_actions/{action}.markdown`
  - `{trigger}`/`{condition}`/`{action}` use `<domain>.<name>` (e.g. `motion.detected`, `zone.in_zone`, `light.turn_on`). Rendered pages: `https://www.home-assistant.io/triggers/<domain>.<name>/` (same pattern for `/conditions/` and `/actions/`). The generic trigger types (`state`, `numeric_state`, `time`, `time_pattern`, `homeassistant`) have pages in the same tree under their bare names.
  - Caveat: some pages still show the pre-2026.6 trigger `behavior` values `any`/`last`; the current values are `each`/`first`/`all` (conditions keep `any`/`all`).

## Troubleshooting: a device does not respond as expected

Only causes the source material supports. Check these in order using `get_states` / `find_entities` before changing anything.

1. **Wrong entity or wrong target level.** Confirm the exact entity id with `find_entities`. Entities may be separate from what the user means (for example a feature toggle vs the light itself). Area targets hit every matching entity in the area; prefer explicit entity ids.
2. **Parameters in the wrong place.** Entities go in `target:`, parameters in `data:`. `entity_id` inside `data:` is the pre-2024.8 form; `brightness_pct` outside `data:` is ignored/invalid; `cleaning_area_id` for `vacuum.clean_area` goes under `data:` (an `area_id` there is read as a target).
3. **Light color temperature wrong.** `color_temp` (mireds) was removed in 2026.3. HA accepts any positive number as `color_temp_kelvin`, so a mireds number (500) is silently read as Kelvin (500 K). Convert: Kelvin = 1,000,000 / mireds.
4. **Automation stopped working after a device was re-added / mesh repaired.** A `device_id` trigger or target changed. Switch to `entity_id` (ZHA: `device_ieee`). Z2M autodiscovered device triggers are managed and acceptable.
5. **Button/remote does nothing.** Check whether an `event.*` entity exists and use `event.received` with a value from its `event_types` attribute (read via `get_states`), not a guessed one. A "double press" that the device does not list (e.g. Hue `double_short_release`) will never fire: offer a two-presses-within-a-window approach instead. ZHA remotes need `zha_event` with the right `device_ieee` and `command` (user finds these under Tools > Events). Z2M event entities are off by default (experimental); use its `device` or `mqtt` trigger.
6. **Cover speed rejected.** `speed` (2026.9+) must be one of the entity's `supported_speeds`; otherwise validation error. No `supported_speeds` means the option is ignored.
7. **Vacuum room cleaning ignored.** `vacuum.clean_area` (2026.3+) needs segments mapped to HA areas in the entity settings and an integration that supports it (Matter, Ecovacs, Roborock so far). Otherwise fall back to `vacuum.send_command` with vendor parameters.
8. **Scene did not restore.** A `scene.create` snapshot is transient and lost on a config/scene reload. A scene only sets the attributes listed; unlisted entities are untouched. Light color attributes in a scene must be Kelvin, not mireds.
9. **Notification not showing as expected.** For `notify.persistent_notification`, `notification_id` belongs nested under `data:`; a top-level key is rejected.
10. **Butler's own limits.** `call_service` refuses areas and blocked domains (locks, alarms, covers, HA system/reload). If the user asks for those, say so and give them the UI steps or an automation/script for them to approve.

<!-- Adapted for Backend Butler from homeassistant-ai/skills (MIT, (c) 2026 The Unofficial and Awesome Home Assistant MCP Server) at 3780b52: SKILL.md, references/device-control.md, references/scenes.md, references/domain-docs.md. -->
