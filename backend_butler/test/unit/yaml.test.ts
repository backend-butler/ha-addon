import { describe, expect, it } from "vitest";
import { lineDiff, toYaml } from "../../server/yaml";

describe("toYaml", () => {
  it("renders an automation readably", () => {
    const y = toYaml({
      alias: "Monitor bars at sunset",
      triggers: [{ trigger: "sun", event: "sunset" }],
      conditions: [{ condition: "time", weekday: ["mon", "tue"] }],
      actions: [{ action: "light.turn_on", target: { entity_id: "light.monitor_light_bars" } }],
      mode: "single",
    });
    expect(y).toBe(
      [
        "alias: Monitor bars at sunset",
        "triggers:",
        "  - trigger: sun",
        "    event: sunset",
        "conditions:",
        "  - condition: time",
        "    weekday:",
        "      - mon",
        "      - tue",
        "actions:",
        "  - action: light.turn_on",
        "    target:",
        "      entity_id: light.monitor_light_bars",
        "mode: single",
      ].join("\n"),
    );
  });
  it("quotes values YAML would misread", () => {
    expect(toYaml({ a: "on", b: "12:00:00", c: "", d: "x: y" })).toBe('a: "on"\nb: "12:00:00"\nc: ""\nd: "x: y"');
  });
});

describe("lineDiff", () => {
  it("marks added and removed lines", () => {
    expect(lineDiff("a\nb\nc", "a\nc\nd")).toEqual([
      { op: " ", text: "a" }, { op: "-", text: "b" }, { op: " ", text: "c" }, { op: "+", text: "d" },
    ]);
  });
});
