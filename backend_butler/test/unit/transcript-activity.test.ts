import { describe, expect, it } from "vitest";
import type { Part } from "../../shared/transcript";
import { parseStates, toBlocks } from "../../web/transcriptActivity";

const tool = (id: string, name: string, input: unknown, result?: string, isError = false): Part => ({
  kind: "tool", id, name: `mcp__ha__${name}`, input, ...(result !== undefined ? { result, isError } : {}),
});

const RESULT =
  'Called light.turn_off. State now:\n' +
  'light.kitchen: off (changed 2026-10-12T10:00:00Z) {"friendly_name":"Kitchen"}\n' +
  'light.hall: on (changed 2026-10-12T10:00:00Z) {"friendly_name":"Hall","brightness":153}';

describe("transcript activity", () => {
  it("folds consecutive lookups into one line and turns device control into an outcome row", () => {
    const blocks = toBlocks([
      tool("1", "find_entities", { domain: "light" }, "…"),
      tool("2", "get_states", { entity_ids: ["light.kitchen", "light.hall"] }, "…"),
      tool("3", "call_service", { domain: "light", service: "turn_off", entity_ids: ["light.kitchen", "light.hall"] }, RESULT),
      { kind: "text", text: "Done." },
    ]);
    expect(blocks.map((b) => (b.kind === "activity" ? b.activity.kind : b.part.kind))).toEqual(["lookups", "control", "text"]);
    const [lookups, control] = blocks.map((b) => (b.kind === "activity" ? b.activity : null));
    expect(lookups).toMatchObject({ label: "Looked up lights and checked 2 devices", status: "ok", failed: 0 });
    expect(control).toMatchObject({
      label: "Turned off",
      status: "ok",
      entities: [
        { id: "light.kitchen", name: "Kitchen", state: "off" },
        { id: "light.hall", name: "Hall", state: "on · 60%" },
      ],
    });
  });

  it("shows running and failed control in plain words", () => {
    const [running] = toBlocks([tool("1", "call_service", { domain: "vacuum", service: "start", entity_ids: ["vacuum.robo"] })]);
    expect(running.kind === "activity" && running.activity).toMatchObject({ label: "Starting", status: "running", entities: [{ name: "Robo", state: "" }] });
    const [failed] = toBlocks([tool("1", "call_service", { domain: "light", service: "turn_on", entity_ids: ["light.x"] }, "nope", true)]);
    expect(failed.kind === "activity" && failed.activity).toMatchObject({ label: "Couldn't turn on", status: "failed" });
  });

  it("links a saved automation to HA's editor only inside HA", () => {
    const part = tool("1", "upsert_automation", { config: { alias: "Door light" } }, "Saved automation id=171: automation.door_light is on. Use this id…");
    const [inside] = toBlocks([part], true);
    expect(inside.kind === "activity" && inside.activity).toMatchObject({ label: "Saved automation “Door light”", editUrl: "/config/automation/edit/171" });
    const [outside] = toBlocks([part], false);
    expect(outside.kind === "activity" && outside.activity).not.toHaveProperty("editUrl", expect.anything());
  });

  it("reads missing entities as not found rather than crashing", () => {
    expect(parseStates("Called x.y. State now:\nlight.gone: not found").size).toBe(0);
  });
});
