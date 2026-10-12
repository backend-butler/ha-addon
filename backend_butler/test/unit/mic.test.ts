import { describe, expect, it } from "vitest";
import { micAvailable } from "../../web/MicButton";

const win = (secure: boolean, gum: unknown) => ({ isSecureContext: secure, navigator: { mediaDevices: gum === undefined ? undefined : { getUserMedia: gum } } }) as never;

describe("micAvailable", () => {
  it("needs a secure context and getUserMedia", () => {
    expect(micAvailable(win(true, () => {}))).toBe(true);
    expect(micAvailable(win(false, () => {}))).toBe(false);
    expect(micAvailable(win(true, undefined))).toBe(false);
  });
});
