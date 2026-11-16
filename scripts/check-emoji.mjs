#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const DIRS = ["src", "src-tauri", "plugins"];

// Widened emoji & pictograph detection regex:
// U+1F000-U+1FAFF, U+2300-U+23FF, U+2600-U+27BF, U+2B00-U+2BFF, U+FE0F, U+200D, U+20E3
export const EMOJI_REGEX = /[\u{1F000}-\u{1FAFF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]/u;

export function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "target" || entry.name === "gen" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (/\.(tsx?|jsx?|rs|toml|json|md|ps1|css|html)$/i.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

export function checkEmojiInFiles(dirs = DIRS, root = ROOT) {
  const violations = [];
  for (const dirName of dirs) {
    const dirPath = path.join(root, dirName);
    const files = walk(dirPath);
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (EMOJI_REGEX.test(lines[i])) {
          const rel = path.relative(root, file).replace(/\\/g, "/");
          violations.push({ file: rel, line: i + 1, text: lines[i].trim() });
        }
      }
    }
  }
  return violations;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const violations = checkEmojiInFiles();
  if (violations.length > 0) {
    for (const v of violations) {
      console.error(`[check:emoji] Emoji found in ${v.file}:${v.line}: ${v.text}`);
    }
    console.error(`\n[check:emoji] Total ${violations.length} emoji occurrence(s) found! Rule 2 violation.`);
    process.exit(1);
  } else {
    console.log("[check:emoji] Zero emojis found across src, src-tauri, plugins.");
  }
}
