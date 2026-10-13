import { describe, expect, it } from "vitest";
import { describeAction, describeCondition, describeTrigger, outline } from "../../server/ha/outline";

const names = (id: string) => ({ "light.kitchen": "Kitchen", "light.hall": "Hall", "binary_sensor.door": "Front door" })[id] ?? id;

describe("approval outline", () => {
  it("reads an automation as When / If / Then with entity names", () => {
    const cfg = {
      alias: "Door light",
      triggers: [{ trigger: "state", entity_id: "binary_sensor.door", to: "on" }],
      conditions: [{ condition: "sun", after: "sunset" }],
      actions: [{ action: "light.turn_on", target: { entity_id: ["light.kitchen", "light.hall"] } }, { delay: "00:05:00" }],
    };
    expect(outline("automation", cfg, names)).toEqual([
      { label: "When", items: ["Front door changes to on"] },
      { label: "If", items: ["It's after sunset"] },
      { label: "Then", items: ["Turn on Kitchen and Hall", "Wait 00:05:00"] },
    ]);
  });

  it("leaves out empty sections and reads a script's sequence as Then", () => {
    expect(outline("automation", { triggers: [{ trigger: "time", at: "07:00" }], actions: [] }, names)).toEqual([{ label: "When", items: ["At 07:00"] }]);
    expect(outline("script", { sequence: [{ action: "scene.turn_on", target: { entity_id: "scene.movie" } }] }, names)).toEqual([
      { label: "Then", items: ["Activate scene.movie"] },
    ]);
  });

  it("names what it does not understand instead of guessing", () => {
    expect(describeTrigger({ trigger: "mqtt", topic: "x" }, names)).toBe("A mqtt trigger");
    expect(describeCondition("{{ is_state('a', 'b') }}", names)).toBe("A template is true");
    expect(describeAction({ mystery: 1 }, names)).toBe("A step");
    expect(describeAction({ action: "notify.mobile_app_phone", data: { message: "hi" } }, names)).toBe("Send a notification (notify.mobile_app_phone)");
  });

  it("supports the legacy platform/service keys", () => {
    expect(describeTrigger({ platform: "numeric_state", entity_id: "sensor.t", above: 25 }, names)).toBe("sensor.t goes above 25");
    expect(describeAction({ service: "light.turn_off", entity_id: "light.kitchen" }, names)).toBe("Turn off Kitchen");
  });

  it("shortens long target lists", () => {
    expect(describeAction({ action: "light.turn_off", target: { entity_id: ["a.1", "a.2", "a.3", "a.4", "a.5"] } }, names)).toBe("Turn off a.1, a.2 and 3 more");
  });
});
