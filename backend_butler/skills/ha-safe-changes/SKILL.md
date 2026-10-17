---
name: ha-safe-changes
description: >
  Home Assistant safe changes, renames and recovery: renaming entities or devices, replacing template sensors with helpers, converting device_id triggers, restructuring existing automations, and backups, restores, rollbacks and upgrades. Load before modifying existing config, when asked to "rename", "migrate", "replace", "undo", "restore", "delete a backup", or "upgrade".
---
# Safe Changes, Renames and Recovery

## Core rules

**Core principle:** Use native Home Assistant constructs wherever possible. Templates bypass validation, fail silently at runtime, and make debugging opaque.

**Release-gating:** A feature marked with a release (2026.x) depends on the instance's HA version. Butler cannot read the version directly. If a 2026.x feature matters, ask the user (Settings > About) or say which version it needs, and name the older fallback with the version it needs.

**Butler's limits here.** Butler can search and edit automations and scripts (list_automations / get_automation, upsert_automation / upsert_script, delete_*; the user approves every change on a YAML preview or diff card). Butler can look up entities (find_entities, get_states) and control devices (call_service). Butler CANNOT rename entities, edit registries, edit dashboards, scenes, groups, helpers or configuration.yaml, take/restore/delete backups, restart or reload HA, or upgrade anything. For those, give the user the exact steps in HA's UI (Settings > ...) and say clearly that Butler can't do it itself.

### Decision Workflow step 0: gate for modifying existing config

If a change affects entity IDs, display names, or cross-component references (renaming entities or devices, replacing template sensors with helpers, converting device triggers, restructuring automations), complete the workflow below BEFORE proceeding: impact analysis, device-sibling discovery, display-name overrides, post-change verification. Steps for new config or pattern evaluation do not apply until this is done.

### Anti-pattern rows for this topic

| Anti-pattern | Use instead | Why |
|---|---|---|
| Renaming entity IDs without impact analysis | Follow the workflow below | Renames silently break dashboards, scripts, scenes, Config-Entry data and storage dashboards |
| Renaming members of Config-Entry-based groups (UI groups) without updating membership | Update group membership in the group's options (Settings > Devices & services > Helpers > the group > Options) after the rename | The registry rename does not update `options.entities` in the Config Entry; the group silently breaks |
| Renaming entities used by Min/Max helpers or custom Config-Entry integrations (e.g. Better Thermostat) without checking their config-entry data | Check each one's config; re-select the renamed entity in the Min/Max options. An integration that keeps it in `data` (Better Thermostat) has no API fix: tell the user and have a full backup taken before the rename | They store entity_ids in the Config Entry and a registry rename does not update them; single-source helpers such as Threshold (since 2025.6) and Generic Thermostat update themselves |
| `wait_for_trigger` with a state trigger for a condition that may already hold | `wait_template` | A state trigger fires only on a transition, so the wait lasts until the entity leaves and re-enters the state, or forever without a `timeout` |
| Backups: full restore to undo one object edit; no backup before an irreversible operation (registry deletion, integration removal, Core/OS upgrade); calling an action "reversible" without naming its inverse | Roll the single object back; have the backup taken *before*; name the exact inverse or treat it as irreversible | A full restore reverts every unrelated change since and restarts HA; a backup taken afterward captures the damage |
| Restoring a backup, deleting a backup, or upgrading Core or the OS without explicit user confirmation | Ask, name the concrete effect, and wait for an answer, every time, backup or not | A full restore discards everything since the archive and restarts HA; a Supervisor partial restore overwrites only the selected parts; deletion destroys a recovery point; a Core/OS upgrade is high-impact and its recovery path IS the pre-upgrade backup |

---

# Safe Refactoring Workflow

Follow this workflow whenever you modify existing Home Assistant configuration: renaming entities, replacing template sensors with helpers, converting device triggers, or restructuring automations.

**Core rule:** Search all consumers BEFORE changing anything. Verify zero stale references AFTER.

Sections: [Universal Workflow](#universal-workflow), [Entity Renames](#entity-renames), [Helper Replacements](#helper-replacements), [Trigger Restructuring](#trigger-restructuring), [Config-Entry Groups](#config-entry-groups), [Config-Entry Data blind spots](#config-entry-data-blind-spots-for-entity-registry-renames), [Storage-Mode Dashboards](#storage-mode-dashboards), [Backups and Recovery](#backups-and-recovery).

## Universal Workflow

Butler cannot perform the rename itself, so it hands the user the steps. The order still holds: their instructions open with the consumer search (Step 2), and the rename comes after it. Two checks need UI steps the user can follow: open each dashboard edited in the UI and look for the old entity ID (a rename does not update them), and open the options of each Min/Max helper and UI group that uses the entity and select it again.

### Step 1: Identify the full scope of change

Answer three questions before touching anything:

1. **What changes?** Entity ID, automation structure, sensor type, or trigger semantics.
2. **What sibling entities share the same device?** List every entity the device owns (battery sensor, update entity, diagnostic button) and plan changes for all siblings together. Butler: use find_entities (filter by device / name words) and get_states; the user can also check Settings > Devices & services > Devices.
3. **Rename one entity or all device entities?** Devices bundle 2-6 entities. Renaming the primary but leaving siblings with the old naming scheme creates inconsistency.

### Step 2: Search ALL consumers

Search every component type that references entity IDs. Do not limit searches to the component you are editing.

| Component | How to search |
|---|---|
| Automations | Butler: list_automations and get_automation (kind "automation") and look for the entity ID in each config |
| Scripts | Butler: list_automations / get_automation with kind "script" |
| Dashboards | Butler cannot read them. Ask the user to search each dashboard (raw configuration editor) for the entity ID. A rename does not update storage-mode (UI-edited) dashboards, see [Storage-Mode Dashboards](#storage-mode-dashboards) |
| Scenes | Butler cannot read them. Ask the user to check Settings > Automations & scenes > Scenes |
| Config-Entry-based groups | Members live in the group's options; entity registry renames do NOT update these automatically, see [Config-Entry Groups](#config-entry-groups) |
| Config-Entry integrations (Min/Max Helper, Better Thermostat and other custom integrations) | Entity IDs sit in the config entry's `data` or `options`; registry renames do NOT update them. Single-source helpers (Threshold, Generic Thermostat, Derivative, ...) update themselves, see [Config-Entry Data](#config-entry-data-blind-spots-for-entity-registry-renames) |
| Other | Ask the user about AppDaemon apps, Node-RED flows, Pyscript scripts, or any custom integration that references entity IDs |

Record every location found. This list becomes the update checklist for Step 4.

### Step 3: Make the change

Rename the entity, replace the template sensor, or restructure the automation. Butler can restructure automations and scripts (upsert_*, after fetching the current config first); renames and helper changes are done by the user in the UI.

### Step 4: Update every consumer

Work through each location from the Step 2 checklist. Update every reference to the new entity ID, helper entity, or automation structure. Butler edits automations and scripts; the user does the rest.

### Step 5: Verify

1. **Search for the OLD identifier** across all component types. Expect zero results.
2. **Search for the NEW identifier** to confirm all expected locations reference it.
3. **Reload or check dashboards** if entity IDs changed.
4. **If stale references remain that cannot be updated**, rename the entity back to its original ID to restore functionality, then report the blocking locations to the user.

## Entity Renames

Additional requirements beyond the universal workflow.

**Device-sibling discovery (Step 1):**
HA devices bundle multiple entities. A smart plug might expose `switch.*`, `sensor.*_energy`, and `update.*`. A multi-sensor exposes motion, temperature, illuminance, and battery entities. Rename all siblings to match.

> **One device entry per config entry (2026.8+).** HA used to merge a physical device set up through two config entries into a single device entry; each now keeps its own, and previously-merged devices were split automatically on upgrade. The boundary is the config entry, not the integration; two config entries of the same integration split too. So a single device query can return only *part* of a physical device's entities; a bulb reachable over both Matter and its vendor integration appears twice. Search by the shared name or identifier, not by one device entry, before concluding you have found every sibling.

Example, renaming a smart plug's entities from manufacturer defaults to room-based names:

| Domain | Old entity ID | New entity ID |
|---|---|---|
| switch | `switch.shellyplug_s_a1b2c3d4e5f6` | `switch.office_heater` |
| sensor | `sensor.shellyplug_s_a1b2c3d4e5f6_energy` | `sensor.office_heater_energy` |
| update | `update.shellyplug_s_a1b2c3d4e5f6` | `update.office_heater` |

**Dashboard reference locations (Step 2):**
Dashboard cards reference entities in multiple places. The user should search all of these:

- `entity:` field
- `tap_action` and `hold_action` targets
- Conditional card conditions
- Template card Jinja2 blocks
- `views[n].badges`: badge rows per view; badges are siblings of the cards array, not children, so any card-focused search will miss them. Always search the full dashboard config
- `views[n].header.card`: sections view only (HA 2025.3+); the view header accepts a Markdown card that supports Jinja2 templates and may contain entity references; it is a sibling of the cards array and is not reachable via card-focused search
- `views[n].footer.card`: sections view only (HA 2026.3+); the view footer accepts a card that may contain entity references; like the header it is a sibling of the cards array

**Display names are a separate field (Step 3):**

`entity_id` and display name are stored independently, and renaming in the UI writes a *user override* rather than changing the value the integration supplied. The registry keeps both:

| Registry | Integration-supplied | User override |
|---|---|---|
| entity | `original_name` | `name` |
| device | `name` | `name_by_user` |

The override takes precedence for as long as it is set. If the integration later reports a corrected name (the device is renamed in its vendor app, a firmware update fixes a typo), the new value lands in the integration-supplied field and never reaches the UI, so the stale override looks like an integration bug to whoever finds it later.

Rename at the source when the source is what is wrong, and reserve the override for names HA itself owns. To annotate without shadowing (marking an entity unused, grouping for a dashboard) use labels or areas, which live in their own fields and survive a source-side rename. Clearing the override restores the inherited name.

## Helper Replacements

When replacing a template sensor with a built-in helper (`min_max`, `threshold`, `derivative`):

**New entity ID (Step 1):**
The helper creates a new entity with a different entity_id. The old template sensor's entity_id stops existing. Update every consumer of the old entity_id to reference the new one.

**Test equivalence (Step 5):**
Verify the new helper produces the same values as the old template sensor. Check units, precision, and unavailable-state handling. Butler can compare with get_states on both entities.

## Trigger Restructuring

When converting `device_id` triggers to `entity_id` triggers, or replacing `wait_template` with `wait_for_trigger`:

**Behavioral equivalence (Step 1):**
`wait_for_trigger` waits for a state *change*; `wait_template` checks the *current state* and re-renders when a referenced entity changes. These differ when the target state is already true at wait start: `wait_for_trigger` waits for the next matching trigger (the entity must leave the state and re-enter it), or for the timeout if one is set; `wait_template` returns immediately.

**Automation callers (Step 2):**
Search for scripts or other automations that call the automation you are restructuring via `automation.trigger` or `automation.turn_on`. Renaming or splitting an automation changes its entity_id and breaks these callers. Butler can search these with get_automation on each automation and script.

## Config-Entry Groups

When renaming entities that are members of a HA **group** created via the UI (Config-Entry-based group, platform `group`):

**Entity registry renames do NOT update group members automatically.**

Group member entity IDs are stored in `options.entities` of the group's Config Entry, not in the entity registry. A registry rename leaves the group referencing the old (now non-existent) entity ID, silently breaking it. Butler cannot read or edit these groups.

**Detection (Step 2), user steps:** Settings > Devices & services > Helpers, open each group helper and check its members (Group options) for the old entity.

**Fix (Step 4), user steps:** After the registry rename, open the group's options and re-select the renamed entity in the members list. Keep the existing "hide members" setting as it was. Groups of type light, switch and binary_sensor also have an "all entities" option; leave it as it was.

(Under the hood this is the config entry's Options Flow: one active flow per Config Entry at a time, and the REST config-entries endpoint does not expose `options.entities`, so the options dialog is the only way to read current members. Verify by reopening the options and confirming only the updated entity IDs are listed.)

## Config-Entry Data blind spots for entity registry renames

**Only some integrations follow a rename.** Integrations that collect entity_ids during their setup flow store them in the Config Entry, not in YAML and not in the Entity Registry. A helper built on one source entity listens for registry renames, rewrites its own `options` and reloads (Threshold has done so since 2025.6). A helper with a list of entities, a UI group, or a custom integration does not, so its references keep pointing to the old (now non-existent) entity ID.

| Integration | Storage field | Fields containing entity_ids | Follows a rename (2026.9) |
|---|---|---|---|
| Threshold Helper | `options` | `entity_id` | yes |
| Generic Thermostat | `options` | `heater`, `target_sensor` | yes |
| Generic Hygrostat | `options` | `humidifier`, `target_sensor` | yes |
| Derivative, Integration, Statistics, Trend, Utility Meter, Switch-as-X | `options` | the source entity | yes |
| Min/Max Helper | `options` | `entity_ids` | NO |
| **Better Thermostat** (custom) | `data` (not accessible via REST) | `temperature_sensor`, `humidity_sensor`, `outdoor_sensor`, `window_sensors` | NO |

UI groups keep their members in `options.entities` and do not follow a rename either (see [Config-Entry Groups](#config-entry-groups)).

**Symptom:** Integration reports "associated entity missing" or behaves incorrectly after restart.

**Timing:** Fix the config-entry entity references **before any HA restart**. An integration that starts with stale entity_ids can cause integration setup failures on restart.

**Scan:** the entity IDs live in each integration's `data` and `options`. Butler cannot read config entries, so ask the user to open the options of each helper in the table above that uses the renamed entity. Some custom integrations (including Better Thermostat) do not expose their entity references through the API at all, so a scan can come back empty even when the integration is configured.

**Fix:**

- Integration marked NO that stores entity_ids in `options` (Min/Max Helper): the user opens the helper's options (Settings > Devices & services > Helpers > the helper > Options) and re-selects the renamed entity. Integrations marked yes need no patch; after the rename, check that their options show the new ID.
- Integration that stores entity_ids in `data` (Better Thermostat): `data` fields written during the initial config flow have no standard API for post-setup mutation; the options flow updates `options` only. No API-based fix path exists. Tell the user this limitation before proceeding with a rename. This is the one operation here that a fetch-before-write rollback cannot undo, so treat the rename as irreversible and have a full backup taken first (see [Backups and Recovery](#backups-and-recovery)).

## Storage-Mode Dashboards

**Entity registry renames do NOT update Lovelace storage dashboards** (the ones edited in the UI). Butler cannot edit dashboards, so give the user these steps for each dashboard:

1. Open the dashboard, Edit (pencil) > three-dot menu > Raw configuration editor.
2. Search for the old entity ID (include Jinja inside Markdown/template cards such as `{{ states('sensor.old') }}` and `states.sensor.old`, and `tap_action` / `hold_action` targets, badges, view header and footer cards).
3. Replace each match with the new ID and save. It takes effect immediately, no restart.
4. Search again for the old ID. Match whole IDs only: a plain substring search reports `sensor.old_backup` as a stale `sensor.old`, which would wrongly send you rolling back a rename that succeeded. Likewise do not blanket find-and-replace `sensor.x`, which also hits `sensor.x_backup` and `binary_sensor.x`.
5. If both the old and new IDs appear as keys of the same map (scene entity maps, card entity dicts), do not merge them blindly: they would collapse into one key and drop the other's settings. Resolve by hand.

Every dashboard (the default Overview and each custom one under Settings > Dashboards) needs this pass.

---

# Backups and Recovery

**Three different things get called a "backup" in Home Assistant work.** The first two matter here, and only the first is a Home Assistant feature:

1. A **full instance backup**: the archive Home Assistant creates at *Settings > System > Backups*, which is also the surface for restoring and deleting one. Butler cannot create, restore or delete these; the user does it.
2. **Object rollback**: not an HA feature but a workflow. Fetch an object's current definition *before* editing it, then write that definition back through the same config API to undo. One object, no restart. Butler does this: always get_automation (or the script equivalent) and keep the old config before upsert, and offer to write it back if the user wants to undo.
3. The **pre-edit file copy** a managed YAML write takes, a different mechanism entirely (not something Butler does).

**Three operations need explicit user confirmation before anyone acts, every time, including when a backup already exists.** They differ in kind, so say which one applies:

- **Restoring a backup**: *irreversible*. It discards every change made since that archive and restarts HA. The only way back is another backup taken before the restore.
- **Deleting a backup**: *irreversible*. The archive is gone, and with it any recovery point it was the last copy of.
- **Upgrading Core or the OS**: *high-impact rather than strictly irreversible*. It can break integrations and custom components, and the recovery path is restoring the pre-upgrade backup, which is why one has to exist first.

A backup lowers recovery risk; it does not authorize the action. Butler never does these itself; it explains the effect and gives the UI steps only after the user confirms.

## Which Recovery Path

| Situation | What to do |
|---|---|
| One automation / script / scene / dashboard / helper edit went wrong | **Roll the object back**: write its previous definition back through the config API. No restart, nothing else touched. Fetching before writing is what makes this possible (see [Universal Workflow](#universal-workflow)). Butler can do this for automations and scripts. |
| Several objects were edited in one session | **Roll each object back**, one at a time. Still no restart. |
| A device, entity, or area was deleted from the registry | **Restore a full backup.** Registry state (IDs, area/label assignments, and the references other config held to them) cannot be recovered by writing a definition back. |
| An integration or config entry was removed | **Restore a full backup.** Its entities went with it. |
| An App update or removal broke something | **Restore a full backup partially**: that App and its data only. Supervisor installs (OS/Supervised) only; elsewhere it is a full restore. |
| A Core or Operating System upgrade broke the instance | **Restore a full backup.** |
| The instance no longer boots | **Restore a full backup** through the Supervisor / onboarding restore flow. |

Prefer the narrowest path that can fix the fault. Object rollback is scoped to one object, needs no restart, and cannot lose unrelated work.

**Partial restore is a narrower restore, not a rollback.** HA's partial restore (`hassio.restore_partial`) picks which parts of an existing backup to put back: Home Assistant settings, specific Apps, and folders. Including Home Assistant settings restarts HA. That is a different mechanism from writing one object's definition back through the config API, which restarts nothing.

**Partial restore needs a Supervisor**, so it exists on Home Assistant OS and Supervised only. On Container and Core installs the `hassio` integration is not loaded, there is no partial restore, and the recovery options are object rollback or a full restore through whatever backup mechanism that install uses. Check which install the user has before offering a partial restore as a step.

## When a Full Backup Earns Its Cost

The test is reversibility, not how risky something feels: **have a backup taken before an operation you cannot undo by writing the old value back.**

**Irreversible: backup first, and confirm the operation with the user:**
- Deleting a device, entity, or area from the registry.
- Removing an integration or config entry.
- Removing an App, or a major App version jump.
- Core / Operating System upgrades.
- Restoring a *different* backup (a restore is itself destructive of current state).
- Bulk operations across many objects whose before-state was not captured.
- Editing a Config-Entry integration whose fields have no post-setup API write path (see [Config-Entry Data](#config-entry-data-blind-spots-for-entity-registry-renames)).

**Reversible: a backup is usually redundant:**
- Editing an automation / script / scene / dashboard / helper whose current definition was fetched first. Writing that definition back *is* the undo.
- Renaming a friendly name, changing an icon, moving an entity between areas.
- An action whose inverse you can name and target identically: `light.turn_on` and `light.turn_off` on the same entity, and only for a bare on/off from a known starting state. Once `light.turn_on` carries `brightness`, `color_*`, `profile` or `transition`, or the prior state is unknown, `turn_off` does not restore it. Snapshot the state first (`scene.create`) and restore that. (Butler cannot create scenes itself; with call_service it can only restore by explicitly setting the earlier values it read with get_states, so read and note them before changing.)

**Neither list: treat as irreversible until you have checked.** The exact-inverse test is the rule; these are the cases where passing it still is not enough:

- **No inverse exists.** `vacuum.send_command`, any `*.press`, `notify.*`: nothing to call to undo them.
- **The inverse exists but does not undo the consequence.** `lock.unlock` and `lock.lock`, `cover.open_cover` and `cover.close_cover` are exact inverses, yet the door was unlocked and the cover was open in between. Re-locking restores the state, not the exposure. Confirm these with the user first even though they are mechanically reversible.
- **The effect has already left Home Assistant.** A sent notification or a fired webhook cannot be recalled, whatever you call next.

"It's just an action" is not a reversibility argument: the inverse depends on the action and the target, and a reversible state change is not always a reversible event.

Three things this test depends on:

- **Timing is the whole point.** A backup taken *after* the destructive step captures the damage. It must precede the operation.
- **An existing schedule does not substitute.** On an instance with nightly automatic backups, the newest one can be almost a day stale: fine for reversible edits, not for an irreversible operation about to run now.
- **A git config repo does not substitute.** A `/config` directory tracked in git conventionally excludes the recorder database, along with `.storage` and `secrets.yaml`, which carry credentials and long-lived tokens in cleartext. Such a repo holds tracked files only, and the irreversible operations above destroy registry, config-entry, or install state that it does not hold. A repo that does track `.storage` carries those credentials into every clone, so it must not go anywhere the user has not chosen, and writing `.storage` back over a running instance is a direct edit of HA's internal state rather than a restore.

## What a Full Backup Contains

Backup contents are **selected per backup**, so what a given archive holds is a property of that archive, not of Home Assistant:

- **Home Assistant settings**: the config directory: `.storage` registries, YAML configuration, and the stored automations, scripts, scenes, dashboards, and helpers.
- **The recorder database: usually included, but confirm rather than assume.** Home Assistant Core's own backup config defaults `include_database` to true (2026.8.1), so history and long-term statistics normally *are* in the archive and *do* come back. Three things change that answer: the option can be switched off for an individual backup; on Supervised/OS the Supervisor API takes `homeassistant_exclude_database` per backup and the `backups_exclude_database` setting can make exclusion the *default* for every future one; and a recorder pointed at an external database lives outside the archive entirely. Check the archive and the install before telling a user their history will or won't return.
- **Apps**, individually selectable, with their data directories.
- **Folders**, individually selectable: `share`, `addons/local`, `ssl`, `media`.

Nothing else on the host is included, and a restore overwrites only the parts a given backup actually contains.

**Encryption and secrets.** Backups are password-protected by default, and restoring one requires its encryption key, the key issued in the backup emergency kit when HA sets up encrypted backups. **An archive without its key is not a recovery point**, so verify the user has the emergency kit before treating a backup as a fallback. A backup downloaded through the UI is decrypted on the way out, and that copy carries `.storage` in cleartext: credentials, long-lived tokens, API keys. Protect the archive and the emergency kit as separate secrets, and never move either anywhere the user has not chosen.

## Restoring: Consequences and Verification

- **Confirm before restoring.** Naming which changes will be lost is part of the ask.
- A **full restore** reverts every included part to its state at backup time and restarts HA. Unrelated work done in that window is gone.
- A **partial restore** narrows the blast radius; prefer it whenever the fault is localised. Including Home Assistant settings still restarts HA.
- An **object rollback** through the config API restarts nothing and touches one object.

After any restore, verify rather than assume (Butler can check entity availability with find_entities / get_states; the error log the user checks at Settings > System > Logs):
- Entities are available, not `unavailable`: a restored config entry whose credentials expired comes back broken.
- The error log is clean of startup failures.
- Cloud-backed integrations may need re-authentication; a restore replays a token that may have been rotated since.
- Objects that were disabled when the backup was taken come back disabled.

## Deleting Backups

Be precise about what Home Assistant protects here, because it is less than it looks:

- The **retention cleanup** that enforces a backup schedule will not delete the last remaining backup for a backup location.
- A **direct delete of one specific backup** (the operation performed when a user asks for a particular backup to be removed) has **no such guard**, and there is no minimum-age protection anywhere. Delete the only recovery point and Home Assistant will carry it out.

So on this operation the caution has to come from whoever is driving, not from the platform:

- **Confirm the specific backup with the user before deleting it**: name which one and how old it is.
- **Leave at least one recent, usable recovery point.** Usable includes having its encryption key available.
- **Delete oldest first** when clearing several.

Storage pressure is not the only legitimate reason to delete. A credential compromise can make the archive itself the liability; a privacy or retention requirement can mandate removal; and a user can simply ask. None of those removes the confirmation step or the keep-one-recovery-point guidance.

## Common Pitfalls

- **Backing up after the destructive step.** The archive now contains the damage.
- **Using a full restore to undo one config edit.** It reverts every unrelated change since, and restarts HA.
- **Assuming a direct backup delete is guarded.** It isn't; only the scheduled retention cleanup keeps a last backup.
- **Treating an archive without its encryption key as a recovery point.** It cannot be restored.
- **Treating a UI-downloaded backup as an ordinary file.** It is decrypted, and it holds cleartext credentials and tokens.
- **Claiming history will or won't come back without checking.** The recorder database is included by default, but per-backup selection and external databases both change the answer.
- **Calling an action "reversible" without naming its inverse**, or treating a mechanical inverse as undoing the consequence, when the door was still unlocked in between.
- **Treating a backup as a substitute for fetching the current definition before an edit.** Fetching is cheaper, object-scoped, and needs no restart to undo.
- **Keeping backups only on the instance they back up.** One disk or host failure takes the instance and its recovery points together.
- **Acting on an irreversible operation because a backup exists.** The backup is the safety net, not the authorization; the user's confirmation is.

<!-- Adapted for Backend Butler from homeassistant-ai/skills (MIT, (c) 2026 The Unofficial and Awesome Home Assistant MCP Server) at 3780b52: skills/home-assistant-best-practices/SKILL.md, references/safe-refactoring.md, references/backups.md. -->
