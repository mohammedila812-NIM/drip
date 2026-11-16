import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Motion guardrails", () => {
  it("verifies that all motion blocks exist and match golden hashes", () => {
    const root = path.resolve(__dirname, "..", "..");
    const appTsx = path.join(root, "src", "App.tsx");
    const goldenPath = path.join(root, "scripts", "motion.golden.json");

    expect(fs.existsSync(appTsx)).toBe(true);
    expect(fs.existsSync(goldenPath)).toBe(true);

    const golden = JSON.parse(fs.readFileSync(goldenPath, "utf8"));
    const content = fs.readFileSync(appTsx, "utf8");

    const lines = content.replace(/\r\n/g, "\n").split("\n");
    const beginRegex = /(?:\/\/|\{\/\*)\s*<motion:begin\s+([A-Za-z0-9_]+)>(?:\s*\*\/)?/;
    const endRegex = /(?:\/\/|\{\/\*)\s*<motion:end\s+([A-Za-z0-9_]+)>(?:\s*\*\/)?/;

    const blocks: Record<string, string> = {};
    let currentName: string | null = null;
    let currentLines: string[] = [];

    for (const line of lines) {
      const beginMatch = line.match(beginRegex);
      const endMatch = line.match(endRegex);

      if (beginMatch) {
        currentName = beginMatch[1];
        currentLines = [];
      } else if (endMatch) {
        if (currentName) {
          blocks[currentName] = currentLines.join("\n");
          currentName = null;
          currentLines = [];
        }
      } else if (currentName !== null) {
        currentLines.push(line);
      }
    }

    const expectedKeys = Object.keys(golden).sort();
    const actualKeys = Object.keys(blocks).sort();

    expect(actualKeys).toEqual(expectedKeys);

    for (const [name, expectedHash] of Object.entries(golden)) {
      const actualHash = crypto
        .createHash("sha256")
        .update(blocks[name], "utf8")
        .digest("hex");
      expect(actualHash).toBe(expectedHash);
    }
  });
});
