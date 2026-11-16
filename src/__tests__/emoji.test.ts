import { describe, it, expect } from "vitest";
// @ts-expect-error mjs script without bundled declaration
import { EMOJI_REGEX, checkEmojiInFiles } from "../../scripts/check-emoji.mjs";

describe("Emoji scanner (scripts/check-emoji.mjs)", () => {
  it("flags samples from all required Unicode ranges using escape sequences", () => {
    // 1. U+1F000 - U+1FAFF (e.g. U+1F600 grinning face)
    const sample1 = "\u{1F600}";
    expect(EMOJI_REGEX.test(sample1)).toBe(true);

    // 2. U+2300 - U+23FF (e.g. U+231A watch)
    const sample2 = "\u{231A}";
    expect(EMOJI_REGEX.test(sample2)).toBe(true);

    // 3. U+2600 - U+27BF (e.g. U+26A1 high voltage / U+2705 check mark)
    const sample3 = "\u{26A1}";
    expect(EMOJI_REGEX.test(sample3)).toBe(true);

    // 4. U+2B00 - U+2BFF (e.g. U+2B50 star)
    const sample4 = "\u{2B50}";
    expect(EMOJI_REGEX.test(sample4)).toBe(true);

    // 5. U+FE0F (Variation Selector-16)
    const sample5 = "\u{FE0F}";
    expect(EMOJI_REGEX.test(sample5)).toBe(true);

    // 6. U+200D (Zero Width Joiner)
    const sample6 = "\u{200D}";
    expect(EMOJI_REGEX.test(sample6)).toBe(true);

    // 7. U+20E3 (Combining Enclosing Keycap)
    const sample7 = "\u{20E3}";
    expect(EMOJI_REGEX.test(sample7)).toBe(true);
  });

  it("does not false-positive on standard ASCII or typography punctuation", () => {
    const cleanStrings = [
      "Hello world!",
      "drip v0.1.0",
      "K_TABLE: [180, 16]",
      "<svg viewBox=\"0 0 24 24\">",
      "{ \"pri\": 2, \"side\": \"Focus\" }",
      "translate(10px, 20px) alpha(#ff453a, 0.5)",
    ];
    for (const str of cleanStrings) {
      expect(EMOJI_REGEX.test(str)).toBe(false);
    }
  });

  it("verifies repository contains zero forbidden emojis across src, src-tauri, plugins", () => {
    const violations = checkEmojiInFiles();
    expect(violations).toEqual([]);
  });
});
