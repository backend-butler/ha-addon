---
name: ha-dashboards
description: >
  Home Assistant dashboards and cards (Lovelace): view types, sections layout, grid_options, tile/heading/markdown/shortcut cards, tile features, badges, tap actions, visibility conditions, custom cards, HACS, themes, card-mod. Load when the user asks to design, fix or add a dashboard, view, card or badge, or which card to use.
---
# Home Assistant Dashboards and Cards

**Butler cannot edit dashboards.** Butler has no dashboard, file, or registry access. Everything here is advice plus ready-to-paste card YAML for the user to apply in HA: open the dashboard, three-dots menu > Edit dashboard, then on a card choose Show code editor (or the dashboard's three-dots > Raw configuration editor) and paste. Say clearly that Butler can't apply it itself. Use `find_entities` / `get_states` to confirm real entity IDs and their domains before writing any card, and never invent entity IDs. The examples below are written as JSON for compactness; when handing the user YAML to paste into the card editor, convert the same keys to YAML.

## Core rules

- **Core principle:** use native Home Assistant constructs wherever possible. Templates bypass validation, fail silently at runtime, and make debugging opaque. For dashboards: prefer built-in cards (tile, heading, grid, area, shortcut) and `visibility` conditions over custom cards, card-mod or template tricks; the markdown card is the one built-in place where Jinja is the right tool.
- **Release gating.** A feature marked with a release (2026.x) depends on the instance's version. Butler cannot read HA's version: if a 2026.x feature matters, ask the user to check Settings > About, or state which version the feature needs. On that release or later, use the feature and do not offer the older way as an equal choice. If the version is unknown, assume a current release and name the older fallback with the version it needs.
- Default to `sections` views, `tile` cards for entities, a `heading` card to start each section, and `grid_options` for sizing.
- Never use Jinja inside tap/hold actions; call a script instead (Butler can create one with `upsert_script`, with user approval).
- Related anti-patterns from the upstream guide: do not tell the user to edit `.storage` files; do not rename entity IDs without checking what uses them (dashboards break silently, see the ha-safe-changes skill). For dashboard cards that depend on a Template Helper or other helper, see the ha-helpers and ha-templates skills.
- Terminology: HA "add-ons" are now called "Apps" (since 2026.2).

## Dashboard Structure

```json
{
  "title": "My Home",
  "icon": "mdi:home",
  "config": {
    "background": {"image": "/local/background.jpg", "opacity": 30, "size": "cover"},
    "views": [
      {
        "title": "Overview",
        "path": "home",
        "type": "sections",
        "max_columns": 4,
        "sections": [
          {"type": "grid", "cards": [
            {"type": "heading", "heading": "Climate", "icon": "mdi:thermometer"},
            ...
          ]},
          {"type": "grid", "cards": [
            {"type": "heading", "heading": "Lights", "icon": "mdi:lightbulb"},
            ...
          ]}
        ]
      }
    ]
  }
}
```

Section `title` is soft-deprecated (frontend source marks it `@deprecated Use heading card instead`). It still parses and renders: the frontend converts a section `title` into a prepended `heading` card on every config load, in YAML mode as well as storage mode, so existing configs are not broken - don't reject or flag a user's `title`. Prefer starting each section with an explicit `heading` card for new configs. Heading cards support `heading_style` (`"title"` or `"subtitle"`), `icon`, `tap_action`, and entity `badges`.

**url_path rules** (when the user creates a dashboard at Settings > Dashboards > Add dashboard):
- New dashboards must contain a hyphen: `my-dashboard` (not `mydashboard`)
- `lovelace` is the built-in default dashboard
- `url_path` is the URL identifier (user-facing, used in dashboard URLs)

## View Types

| Type | Use for |
|------|---------|
| `sections` | Most dashboards (RECOMMENDED) - grid-based, responsive |
| `panel` | Full-screen single cards (maps, cameras, iframes) |
| `sidebar` | Two-column layouts with primary/secondary content |
| `masonry` | Legacy - auto-arranges cards, less control |

### View Configuration

```json
{
  "title": "View Name",
  "path": "unique-path",
  "type": "sections",
  "icon": "mdi:icon",
  "max_columns": 4,
  "sections": [...],
  "subview": false,
  "badges": ["sensor.entity_id"],
  "background": {"image": "/local/background.jpg", "opacity": 30, "size": "cover"}
}
```

`background.image` is a plain path or media-source reference (the `url(...)` wrapper belongs only to the legacy string form of `background`); `opacity` is an integer 0-100. The same shape works at dashboard level, next to `views`, and each view that sets its own `background` overrides it. Badges also accept full objects: `{"type": "entity", "entity": "person.jane", "show_name": true, "color": "accent", "visibility": [...]}`.

A `sections` view also supports a `header` (a markdown card plus badge positioning) and a `footer`:

```json
{
  "header": {"layout": "responsive", "badges_position": "top", "card": {"type": "markdown", "content": "# Welcome home"}},
  "footer": {"max_width": 600}
}
```

`header.layout`: `start` / `center` / `responsive`; `badges_position`: `top` / `bottom`.

## Card Sizing and Responsive Layout

How sections views lay out - required background for sizing cards across screen sizes:

- Each section is a **12-column grid** (cell height 56px, gap 8px). Cards default to the full 12 columns.
- Size cards with `grid_options`: `{"columns": 6, "rows": 2}`. `columns` accepts 1-12 or `"full"`; `rows` accepts a number or `"auto"`. The older `layout_options` (`grid_columns`/`grid_rows`) is deprecated - still parsed, never write it.
- Section columns reflow by available width (viewport minus sidebar; minimum section column width is 320px), clamped to the view's `max_columns` (default 4): roughly 1 column on phones, 2 around 700px, 3 around 1050px, more as width allows. Cards never reflow *within* a section - a card's `columns` value is fixed; what changes with width is the number of section columns shown, and the grid width of spanned sections (next point).
- A spanned section's grid widens with it: a `column_span: 2` section has a **24-column grid** (span x 12) on wide screens, but is 12 columns again once the layout collapses to one section column. Pick values that degrade well: in a `column_span: 2` section, `"columns": 6` gives 4-up on desktop and 2-up on phones; `"columns": 12` gives 2-up on desktop and full-width on phones; `"columns": "full"` is always a full row.
- Give graph/map cards explicit `grid_options` (`"columns": "full"` plus fixed `rows`) so they are never squeezed unreadable in a shared row.
- Responsive show/hide uses the `screen` visibility condition with any CSS media query: `{"condition": "screen", "media_query": "(max-width: 767px)"}`. These are visibility-targeting examples you choose, *not* section-reflow thresholds - sections reflow on content width, not on these fixed viewport widths. Convenient values: `(max-width: 767px)`, `(min-width: 768px) and (max-width: 1023px)`, `(min-width: 1024px)`; `(pointer: coarse)` targets touch devices.
- View badges wrap to multiple lines on narrow screens by default; the view `header` supports `"badges_wrap": "scroll"` for a single scrollable row.

Reflow transitions (useful when the user reports layout oddities): column count is `floor((content_width - padding + gap) / (column_min_width + gap))`, clamped to `max_columns`, with `column_min_width` defaulting to 320px. Transitions land at roughly 360px (1 column), 700px (2) and 1050px (3) of **content** width (viewport minus sidebar and padding; add about 256px for an expanded sidebar to get the viewport width). `screen` visibility conditions only take effect at the widths they target.

## Dashboard Strategies

A **strategy** generates a dashboard (or a single view) from code instead of a static card list. The default Overview/Home dashboard **is** a strategy dashboard - its raw config is just:

```yaml
strategy:
  type: original-states   # built-in strategy; auto-generates views from current entities/areas
views: []
```

A strategy can be set at dashboard level (`strategy:` at the top) or per view (`views: - strategy: {type: ...}`). Custom strategies use the `custom:` prefix; any extra keys are strategy-specific options. The only universal key is `type`.

```yaml
strategy:
  type: custom:my-area-dashboard
  # extra keys here are passed to the custom strategy
views: []
```

**"Take control":** to convert an auto-generated strategy dashboard into a static, hand-editable one, the user uses the dashboard's three-dots menu > **Take control**. This is **one-way** - once taken over, the dashboard no longer auto-updates as new entities/areas appear. Pasting cards into a strategy dashboard without taking control first is a common failure mode: tell the user to take control first (and that it is irreversible), or to edit the strategy options instead.

## Built-in Cards

| Category | Cards |
|----------|-------|
| **Modern Primary** | tile, area, shortcut, button, grid |
| **Container** | vertical-stack, horizontal-stack, grid |
| **Logic** | conditional, entity-filter |
| **Display** | sensor, history-graph, statistics-graph, gauge, calendar, distribution, the energy cards |
| **Legacy Control** | entity, entities, light, thermostat (use tile instead) |

**Default:** use the `tile` card for most entities. See [Card Types](#card-types) below for the full list.

### Tile Card

```json
{
  "type": "tile",
  "entity": "climate.bedroom",
  "name": "Master Bedroom",
  "icon": "mdi:thermostat",
  "features": [
    {"type": "target-temperature"},
    {"type": "climate-hvac-modes", "style": "dropdown"}
  ],
  "tap_action": {"action": "more-info"}
}
```

### Grid Card

```json
{
  "type": "grid",
  "columns": 3,
  "square": false,
  "cards": [
    {"type": "tile", "entity": "light.kitchen"},
    {"type": "tile", "entity": "light.dining"},
    {"type": "tile", "entity": "light.hallway"}
  ]
}
```

In sections views, prefer per-card `grid_options` on the section's own 12-column grid (see [Card Sizing and Responsive Layout](#card-sizing-and-responsive-layout)) - it's what the drag-and-drop editor writes. A nested grid card is still useful when a group must stay N-up at every viewport width.

### Heading Card

The official way to label a section, replacing a bare section `title`. Supports a title/subtitle style, an icon, a tap action, and inline entity/button badges.

```json
{
  "type": "heading",
  "heading": "Kitchen",
  "heading_style": "title",
  "icon": "mdi:fridge",
  "tap_action": {"action": "navigate", "navigation_path": "/lovelace/kitchen"},
  "badges": [
    {"type": "entity", "entity": "sensor.kitchen_temperature", "show_state": true},
    {"type": "button", "icon": "mdi:lightbulb-off", "tap_action": {"action": "perform-action", "perform_action": "light.turn_off"}}
  ]
}
```

Use `"heading_style": "subtitle"` for sub-headers.

### Markdown Card

The only built-in card that renders Jinja2 templates - the go-to for computed/composite status text without a custom card.

```json
{
  "type": "markdown",
  "content": "Temp {{ states('sensor.living_room') }}°. Door {{ 'open' if is_state('binary_sensor.door','on') else 'closed' }}.",
  "entity_id": ["sensor.living_room", "binary_sensor.door"]
}
```

The card auto-detects entities referenced in the template; `entity_id` (a list) is an optional fallback for when that analysis misses some, forcing a re-render on those. `text_only: true` strips the card chrome for inline labels.

### Shortcut Card

One tap to navigate, open a URL, launch Assist or run an action (2026.5). Left out, the label and icon come from the action. The text key is `label`, not `name`.

```json
{
  "type": "shortcut",
  "tap_action": {"action": "assist"}
}
```

Use it instead of a `button` card with a `tap_action`. A `button` card is the fallback only before 2026.5.

### Per-Entity Graph Colors

`history-graph` and `statistics-graph` cards accept a per-entity `color` via the entity object form (2026.6):

```json
{
  "type": "history-graph",
  "entities": [
    {"entity": "sensor.living_room_temp", "name": "Living Room", "color": "red"},
    {"entity": "sensor.bedroom_temp", "color": "#1f77b4"}
  ]
}
```

`color` accepts a named color (`red`), hex (`'#ff0000'`), or `rgb(255, 0, 0)`.

## Features

Quick controls available on tile, area, humidifier, and thermostat cards.

| Domain | Feature types |
|--------|--------------|
| Climate | `climate-hvac-modes`, `climate-fan-modes`, `climate-preset-modes`, `climate-swing-modes`, `climate-swing-horizontal-modes`, `target-temperature`, `target-humidity` (humidifier entities, and climate entities that support it since 2026.9) |
| Light | `light-brightness`, `light-color-temp`, `light-color-favorites`, `light-effect` (`effects:` filter list) |
| Cover/Valve | `cover-open-close`, `cover-position`, `cover-position-favorite`, `cover-tilt`, `cover-tilt-position`, `cover-tilt-favorite`, `valve-open-close`, `valve-position`, `valve-position-favorite` |
| Fan | `fan-speed`, `fan-preset-modes`, `fan-direction`, `fan-oscillate` |
| Media | `media-player-playback` (configurable `controls`), `media-player-volume-slider`, `media-player-volume-buttons`, `media-player-source`, `media-player-sound-mode` |
| Weather | `temperature-forecast`, `precipitation-forecast` |
| Generic display | `trend-graph` (history sparkline; `hours_to_show`), `bar-gauge` (`min`/`max`) |
| Generic control | `toggle`, `button` (run an action), `numeric-input` (`style`: `"buttons"`/`"slider"`), `select-options`, `counter-actions`, `date-set` |
| Area card | `area-controls` |
| Domain-specific | `alarm-modes`, `lock-commands`, `lock-open-door`, `vacuum-commands`, `vacuum-fan-speed` (`fan_speeds:` filter list), `lawn-mower-commands`, `humidifier-modes`, `humidifier-toggle`, `update-actions`, `water-heater-operation-modes` |

Mode-list features accept `style`: `"dropdown"` or `"icons"`. Tile cards also support `features_position`: `"bottom"` (default) or `"inline"`.

**Weather features (2026.6):** `forecast_type` (`daily`/`twice_daily`/`hourly`), `days_to_show`/`hours_to_show`, `show_labels`; `precipitation-forecast` also takes `precipitation_type` (`amount`/`probability`).

**Media features:** `media-player-volume-slider` / `media-player-volume-buttons` accept `show_mute_button` (volume-buttons also `step`); `media-player-playback` `controls:` accepts transport buttons plus `volume_up`, `volume_down`, `volume_mute`, `shuffle`, `repeat`; `media-player-source` takes a `sources:` filter list and `media-player-sound-mode` a `sound_modes:` filter list.

## Badges

Badges appear at the top of a view. The simple form is a list of entity IDs, but the **object form** unlocks more:

```json
{
  "badges": [
    "person.john",
    {
      "type": "entity",
      "entity": "sensor.kitchen_temperature",
      "show_name": true,
      "show_state": true,
      "color": "amber",
      "state_content": ["state", "last_changed"]
    }
  ]
}
```

- `type: entity` options: `show_name`, `show_state`, `show_icon`, `show_entity_picture`, `state_content` (`state`/`last_changed`/`last_updated`/an attribute), and per-badge `visibility`.
- **`color` accepts a color token or hex only - not a Jinja template.**

A **`type: shortcut`** badge (2026.5) is the badge-row counterpart of the shortcut card - a labelled action chip:

```json
{
  "type": "shortcut",
  "text": "Good night",
  "icon": "mdi:weather-night",
  "color": "indigo",
  "tap_action": {"action": "perform-action", "perform_action": "script.good_night"}
}
```

## Actions

```json
{
  "tap_action": {"action": "toggle"},
  "hold_action": {"action": "more-info"},
  "double_tap_action": {"action": "navigate", "navigation_path": "/lovelace/lights"}
}
```

Action types: `toggle`, `perform-action`, `more-info`, `navigate`, `url`, `assist`, `none`.

`perform-action` is the renamed `call-service` - existing `action: call-service` configs (and the older `service`/`service_data` keys) still work, so don't flag them as broken; write new ones with `perform-action`.

```json
{
  "tap_action": {
    "action": "perform-action",
    "perform_action": "light.turn_on",
    "target": {"entity_id": "light.kitchen"},
    "data": {"brightness_pct": 40},
    "confirmation": {"text": "Turn on the kitchen?"}
  }
}
```

Templates are not allowed inside actions - call a script instead.

### Visibility Conditions

Cards, sections, and badges all accept `visibility` (a list of conditions, implicitly AND-ed). Supported condition types: `state` (`state`/`state_not`), `numeric_state` (`above`/`below`), `screen` (`media_query`), `user` (`users`), `time` (`after`/`before`/`weekdays`), `location`, and nestable `and`/`or`/`not`.

```json
{
  "visibility": [
    {"condition": "user", "users": ["user_id_hex"]},
    {"condition": "numeric_state", "entity": "sensor.co2", "above": 1000},
    {"condition": "screen", "media_query": "(min-width: 1024px)"}
  ]
}
```

`screen` is the canonical way to show/hide cards by viewport (desktop vs. mobile).

**Automation conditions (2026.10+).** `visibility` also accepts `template`, `sun`, `zone`, `device` and integration-provided conditions, written as in an automation. `trigger` is not accepted. They mix with the types above, also inside `and`/`or`/`not`.

```json
{
  "visibility": [
    {"condition": "sun", "after": "sunset"},
    {"condition": "screen", "media_query": "(max-width: 767px)"}
  ]
}
```

`state` and `numeric_state` have two shapes since 2026.10: the dashboard one with `entity` (shown above; works on every version) and the automation one with `entity_id`, which the 2026.10 editor writes when a condition is edited. Keep whichever shape a config already has; write `entity` unless the instance runs 2026.10 or later.

## Custom Cards

Use custom JavaScript cards only when built-in cards don't support the visualization.

### Minimal Custom Card

```javascript
class MyCard extends HTMLElement {
  setConfig(config) {
    if (!config.entity) throw new Error("Please define an entity");
    this.config = config;
  }
  set hass(hass) {
    if (!this.content) {
      this.innerHTML = `<ha-card header="${this.config.title || 'My Card'}">
        <div class="card-content"></div>
      </ha-card>`;
      this.content = this.querySelector(".card-content");
    }
    const state = hass.states[this.config.entity];
    this.content.innerHTML = state ? `State: ${state.state}` : "Entity not found";
  }
  getCardSize() { return 2; }
}
customElements.define("my-card", MyCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: "my-card", name: "My Card", description: "A custom card" });
```

Usage: `{"type": "custom:my-card", "entity": "sensor.temperature"}`

For isolated styling, use Shadow DOM (`this.attachShadow({ mode: "open" })`) and scope CSS inside the shadow root.

### Custom Card Workflow (user steps; Butler can't install or host files)

1. The user saves the card JavaScript as a file under `/config/www/` (served as `/local/...`), or installs it through HACS.
2. Register it as a dashboard resource: Settings > Dashboards > three-dots > Resources, add the URL with resource type `module`.
3. Use the card in the dashboard config with the `custom:` prefix:

```json
{
  "type": "custom:quick-status-card",
  "entity": "sensor.temperature",
  "name": "Living Room"
}
```

**Resource caching:** `/local/` is served with `public, max-age=2678400`, a 31-day cache, in desktop browsers as well as the Companion app. Editing a registered `.js` file in place leaves clients on the old copy until it expires or the client clears its cache.

- HACS versions the plugin resource URLs it manages in storage (`?hacstag=<installed version>`), so a card installed through HACS is re-fetched on update. With YAML-mode resources HACS cannot update the URL, so that version string is the user's to bump.
- A resource registered by hand needs the same: bump a version query string on the resource `url`, `/local/quick-status-card.js?v=2.0.0`. Only a changed URL forces every client to re-fetch, so renaming the element tag does not help; the cached module still registers the old tag name.
- A client already holding a stale copy needs a client-side fix: hard refresh, clear site data for the HA origin, or **Settings** > **Reset frontend cache** in the Companion app.

## CSS Styling

### Themes

Global styling is done with HA **themes** (YAML maps of CSS variables), not raw CSS. Themes are defined under `frontend: themes:` in YAML (the user edits configuration.yaml; Butler can't) or installed via HACS, and selected per user (profile) or per view/card with the `theme` option. Define both modes so OS dark/light switching applies cleanly to both:

```yaml
frontend:
  themes:
    my_theme:
      modes:
        dark:
          ha-card-border-radius: "16px"
          primary-color: "#03a9f4"
        light:
          ha-card-border-radius: "16px"
          primary-color: "#0288d1"
```

### Card-mod (Per-Card Styling)

Requires the `card-mod` HACS component. Use sparingly: it patches frontend internals via shadow-DOM selectors, which makes it a frequent source of breakage after HA upgrades - prefer native options and theme variables where they exist, and re-test card-mod styling after every HA update:

```yaml
type: entities
card_mod:
  style: |
    ha-card {
      --ha-card-background: teal;
      color: var(--primary-color);
    }
entities:
  - light.bed_light
```

## HACS Integration

HACS installs are done by the user in the HACS panel (Butler can't install anything).

| Use case | Solution |
|----------|----------|
| Popular community card | HACS - search and install in the HACS panel |
| Small custom styling | Theme variables, or card-mod (HACS) |
| One-off custom card | A `.js` file in `/config/www/`, registered as a `module` resource |
| Large/complex card | HACS or filesystem (`/config/www/`) |

### Popular HACS Cards

- **mushroom** - Modern, clean card collection (v5+ aligns with the native tile card; its template card covers Jinja-driven icon/color/content)
- **button-card** - Highly customizable buttons with JS templating
- **mini-graph-card** - Compact graphs; lighter-weight than apexcharts-card
- **card-mod** - CSS styling for any card (see upgrade caveat above)
- **apexcharts-card** - Professional charts; heavy (ships a full charting library), best kept to dedicated analytics views
- **layout-card** - Pre-sections layout control; superseded by sections views for new dashboards, still useful for legacy masonry views

Custom cards predating sections views (early 2024) that haven't updated since are often dormant or superseded by native equivalents - check a repository's release activity before recommending it.

## Complete Example: Multi-View Dashboard

```json
{
  "views": [
    {
      "title": "Overview",
      "path": "home",
      "type": "sections",
      "max_columns": 4,
      "badges": ["person.john", "person.jane"],
      "sections": [
        {
          "type": "grid",
          "cards": [{
            "type": "heading",
            "heading": "Quick Actions",
            "icon": "mdi:gesture-tap-button"
          }, {
            "type": "grid",
            "columns": 4,
            "square": false,
            "cards": [
              {"type": "button", "name": "Lights", "icon": "mdi:lightbulb", "tap_action": {"action": "navigate", "navigation_path": "/lovelace/lights"}},
              {"type": "button", "name": "Climate", "icon": "mdi:thermostat", "tap_action": {"action": "navigate", "navigation_path": "/lovelace/climate"}},
              {"type": "button", "name": "Security", "icon": "mdi:shield-home", "tap_action": {"action": "navigate", "navigation_path": "/lovelace/security"}},
              {"type": "button", "name": "Energy", "icon": "mdi:lightning-bolt", "tap_action": {"action": "navigate", "navigation_path": "/lovelace/energy"}}
            ]
          }]
        },
        {
          "type": "grid",
          "cards": [
            {"type": "heading", "heading": "Favorites", "icon": "mdi:star"},
            {"type": "tile", "entity": "light.living_room", "features": [{"type": "light-brightness"}], "grid_options": {"columns": 6}},
            {"type": "tile", "entity": "climate.bedroom", "features": [{"type": "target-temperature"}], "grid_options": {"columns": 6}},
            {"type": "tile", "entity": "lock.front_door", "grid_options": {"columns": 6}}
          ]
        }
      ]
    },
    {
      "title": "Lights",
      "path": "lights",
      "type": "sections",
      "icon": "mdi:lightbulb",
      "max_columns": 3,
      "sections": [
        {
          "type": "grid",
          "cards": [
            {"type": "heading", "heading": "Living Room", "icon": "mdi:sofa"},
            {"type": "tile", "entity": "light.overhead", "features": [{"type": "light-brightness"}], "grid_options": {"columns": 4}},
            {"type": "tile", "entity": "light.lamp", "features": [{"type": "light-brightness"}], "grid_options": {"columns": 4}},
            {"type": "tile", "entity": "light.accent", "features": [{"type": "light-color-temp"}], "grid_options": {"columns": 4}}
          ]
        }
      ]
    }
  ]
}
```

(The entity IDs above are placeholders; verify real ones with `find_entities` before handing config to the user.) Note that the `button` cards used for navigation here are the fallback only before 2026.5; from 2026.5 use `shortcut` cards.

## Common Pitfalls

| Issue | Solution |
|-------|----------|
| url_path rejected | New dashboards need a hyphen: `my-dashboard` not `mydashboard`. Use `lovelace` for the default dashboard. |
| Entity not found | Use full entity ID: `light.living_room` not `living_room` |
| Features not working | Match feature type to entity domain (e.g., `light-brightness` only works on `light.*`) |
| Custom card not loading | Check resource type is `module` and verify URL is accessible |
| Card too large for inline | Use HACS or filesystem instead |
| Section title ignored/flagged | Section `title` is deprecated - use a `heading` card as the section's first card |
| Cards sized with `layout_options` | Deprecated - use `grid_options` (`columns`/`rows`) |
| Map card markers show entity-name initials instead of values | `label_mode` is a **per-entity** option, not card-level: `"entities": [{"entity": "sensor.x", "label_mode": "state"}]` |
| Cards lay out differently in spanned sections | A spanned section's grid widens with it (24 columns in a `column_span: 2` section) but is 12 when collapsed - see [Card Sizing and Responsive Layout](#card-sizing-and-responsive-layout) |
| Map entities missing from map card | Only entities with `latitude`/`longitude` attributes are plotted - use template sensors carrying coordinates as attributes for fixed locations |
| Custom card still stale after its file was updated | `/local/` is cached for 31 days: bump a version query string on the resource URL (`/local/my-card.js?v=2.0.0`), see [Custom Card Workflow](#custom-card-workflow-user-steps-butler-cant-install-or-host-files). On a client already holding the old copy: hard refresh or **Settings** > **Reset frontend cache** in the Companion app |
| Graph/chart looks half-drawn | History-backed cards (graphs, statistics) hydrate asynchronously over the websocket; on slow recorder queries wait several seconds or reload before concluding the config is broken |

## Modern Best Practices

- Use **sections** view type with grid-based layouts
- Use **tile** cards as primary card type (replaces legacy entity/light/climate cards)
- Size cards with per-card **`grid_options`** on the section's 12-column grid; reserve nested grid cards for groups that must stay N-up at every width
- Create **multiple views** with explicit `path` slugs (deep-linkable; avoid single-view endless scrolling); use `subview: true` with an explicit `back_path` for drill-down views
- Use **area** cards with navigation for hierarchical organization
- Start sections with **heading** cards (`title`/`subtitle` styles); subtitle headings work well for inline caveats

### Recent Dashboard Features (2026.2-2026.9)

| Feature | Version | Details |
|---------|---------|---------|
| **Distribution card** | 2026.2 | Proportional horizontal bars across multiple entities (power monitoring, storage usage) |
| **Heading button badges** | 2026.2 | `{"type": "button"}` badges on heading cards run actions inline |
| **Section background colors** | 2026.4 | Section `background` accepts `{"color": ..., "opacity": ...}` (or `true`) |
| **Card favorites** | 2026.4 | Light color favorites and cover position favorites display on tile/light cards |
| **Auto-height cards** | 2026.4 | Cards auto-adjust height based on content via the layout editor |
| **Shortcut card + badge** | 2026.5 | One-tap navigate (dashboard/view/area/device), URL, Assist, or action with smart defaults |
| **Media player tile features** | 2026.5 | `media-player-source`, `media-player-sound-mode`, configurable playback `controls` |
| **Weather forecast features** | 2026.6 | `temperature-forecast`, `precipitation-forecast` tile features |
| **Per-entity graph color** | 2026.6 | `color` on each entity of `history-graph` / `statistics-graph` |
| **Light effect feature** | 2026.9 | `light-effect` tile feature, for lights that report effects |
| **Vacuum fan speed feature** | 2026.9 | `vacuum-fan-speed` tile feature |
| **Climate target humidity** | 2026.9 | `target-humidity` now works on climate entities that support it |
| **Dashboard background editor** | 2026.9 | A Background tab in the dashboard detail dialog edits the dashboard-level `background` key, which applies to every view that sets none of its own. The key itself predates 2026.9 |
| **Visibility automation conditions** | 2026.10 | `template`, `sun`, `zone`, `device` conditions in `visibility` (see Visibility Conditions) |

**Legacy patterns to avoid:**
- Single-view dashboards with all cards in one long scroll
- Excessive use of vertical-stack/horizontal-stack instead of grid
- Masonry view (auto-layout) - use sections for precise control
- Putting all entities in generic "entities" cards

## Card Types

A card's visual editor in the running instance shows the fields that instance accepts, at its installed version. It is not the full list: a card can accept YAML-only options its editor omits, and a custom card may have no editor at all. A field missing from the editor is not proof that it is invalid. The lists below are the built-in cards the card picker offers as of 2026.10. Custom cards have a `custom:` type and depend on what the instance has installed.

Butler cannot read a card's fields from the instance. Suggest the user open the card's visual editor (edit dashboard, add or edit the card) to see its fields, or its docs page, which describes the latest release and no custom cards:
`https://raw.githubusercontent.com/home-assistant/home-assistant.io/refs/heads/current/source/_dashboards/{page}.markdown`, where `{page}` is the card type (e.g. `tile`, `grid`, `button`); all energy cards share one page, `energy` (its example writes `energy-compare-card`; the type is `energy-compare`); view types (`masonry`, `panel`, `sections`, `sidebar`) have pages of the same name and are the view's `"type"`, not cards.

**Core:** alarm-panel, area, button, calendar, clock, conditional, distribution, entities, entity-filter, entity, gauge, glance, grid, heading, history-graph, horizontal-stack, humidifier, iframe, light, logbook, map, markdown, media-control, picture-elements, picture-entity, picture-glance, picture, plant-status, sensor, shortcut, statistic, statistics-graph, thermostat, tile, todo-list, vertical-stack, weather-forecast

**Energy:** energy-carbon-consumed-gauge, energy-compare, energy-date-selection, energy-devices-detail-graph, energy-devices-graph, energy-distribution, energy-gas-graph, energy-grid-balance, energy-grid-neutrality-gauge, energy-sankey, energy-self-sufficiency-gauge, energy-solar-consumed-gauge, energy-solar-graph, energy-sources-table, energy-usage-graph, energy-water-graph, power-sankey, power-sources-graph, water-flow-sankey, water-sankey

**Legacy:** `shopping-list` still renders but cannot be added from the UI. Use `todo-list`.

### Quick Card Selection Guide

| Need | Card |
|------|------|
| Control any entity | `tile` (modern default) |
| Layout multiple cards in columns | `grid` |
| One-tap launcher: navigate, URL, Assist or an action | `shortcut` (2026.5+), e.g. `{"type": "shortcut", "tap_action": {"action": "assist"}}`; text key `label`. `button` with a `tap_action` only before 2026.5 |
| Room overview with controls | `area` |
| Historical data graph | `history-graph` or `statistics-graph` |
| Sensor value display | `sensor` or `gauge` |
| Proportional data across entities | `distribution` |
| Show/hide cards conditionally | `conditional` |
| Embed external page | `iframe` |
| Rich text / instructions | `markdown` |
| Camera or image with overlays | `picture-elements` |

## Helping the user apply it

1. Confirm entity IDs with `find_entities` / `get_states`; match feature types to each entity's domain.
2. Give a complete, ready-to-paste card or view as YAML, with a one-line note on where to paste it (edit dashboard > card > Show code editor, or Raw configuration editor for a whole view).
3. If the dashboard is an auto-generated strategy dashboard, tell the user to use Take control first (one-way).
4. If a card needs a script to act on (templates are not allowed in tap actions), offer to create the script with `upsert_script`; the user approves it.
5. Say plainly that Butler can't edit the dashboard, and ask the user to check how it looks, especially on a phone width.

<!-- Adapted for Backend Butler from homeassistant-ai/skills (MIT, (c) 2026 The Unofficial and Awesome Home Assistant MCP Server) at 3780b52: skills/home-assistant-best-practices/SKILL.md, references/dashboard-guide.md, references/dashboard-cards.md. -->
