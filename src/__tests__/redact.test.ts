import { describe, it, expect } from "vitest";
import { redactFg, type FgInfo } from "../lib/redact";

describe("Privacy and title redaction (3.5)", () => {
  const sampleFg: FgInfo = {
    exe: "msedge",
    title: "Sensitive Document - InPrivate",
    full: false,
    max: true,
    top: false,
    shell: false,
    mon: [0, 0, 1920, 1080],
    private: false,
  };

  it("leaves title intact when private is false and hideSetting is false", () => {
    const redacted = redactFg(sampleFg, false);
    expect(redacted?.title).toBe("Sensitive Document - InPrivate");
    expect(redacted?.exe).toBe("msedge");
  });

  it("redacts title to empty string when private is true", () => {
    const redacted = redactFg({ ...sampleFg, private: true }, false);
    expect(redacted?.title).toBe("");
    expect(redacted?.exe).toBe("msedge");
    expect(redacted?.private).toBe(true);
  });

  it("redacts title to empty string when hideSetting is true, regardless of private flag", () => {
    const redacted = redactFg({ ...sampleFg, private: false }, true);
    expect(redacted?.title).toBe("");
    expect(redacted?.exe).toBe("msedge");
  });

  it("handles null and undefined gracefully", () => {
    expect(redactFg(null, true)).toBeNull();
    expect(redactFg(undefined, false)).toBeUndefined();
  });
});
