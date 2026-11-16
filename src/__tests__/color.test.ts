import { describe, it, expect } from "vitest";
import { alpha, isValidColor } from "../lib/color";

describe("Color alpha helper (B2)", () => {
  it("formats hex3 correctly", () => {
    expect(alpha("#f00", 0.2)).toBe("color-mix(in srgb, #f00 20%, transparent)");
  });

  it("formats hex6 correctly", () => {
    expect(alpha("#ff453a", 0.8)).toBe("color-mix(in srgb, #ff453a 80%, transparent)");
  });

  it("formats hex8 correctly", () => {
    expect(alpha("#30d158ff", 0.53)).toBe("color-mix(in srgb, #30d158ff 53%, transparent)");
  });

  it("formats rgb() correctly", () => {
    expect(alpha("rgb(255, 69, 58)", 0.3)).toBe("color-mix(in srgb, rgb(255, 69, 58) 30%, transparent)");
  });

  it("formats hsl() correctly", () => {
    expect(alpha("hsl(120, 85%, 62%)", 0.5)).toBe("color-mix(in srgb, hsl(120, 85%, 62%) 50%, transparent)");
  });

  it("falls back to safe neutral for undefined or invalid input", () => {
    expect(alpha(undefined, 0.5)).toBe("rgba(255, 255, 255, 0.12)");
    expect(alpha("not-a-color", 0.5)).toBe("rgba(255, 255, 255, 0.12)");
    expect(alpha("javascript:alert(1)", 0.5, "transparent")).toBe("transparent");
  });

  it("validates color strings accurately", () => {
    expect(isValidColor("#fff")).toBe(true);
    expect(isValidColor("#123456")).toBe(true);
    expect(isValidColor("#12345678")).toBe(true);
    expect(isValidColor("rgb(0, 0, 0)")).toBe(true);
    expect(isValidColor("rgba(0, 0, 0, 0.5)")).toBe(true);
    expect(isValidColor("hsl(210, 100%, 50%)")).toBe(true);
    expect(isValidColor("bad")).toBe(false);
    expect(isValidColor("")).toBe(false);
  });
});
