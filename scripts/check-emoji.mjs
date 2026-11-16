#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const DIRS = ["src", "src-tauri", "plugins"];
const EMOJI_REGEX = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "target" || entry.name === "gen") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (/\.(tsx?|jsx?|rs|toml|json|md|ps1|css|html)$/i.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

let found = 0;
for (const dirName of DIRS) {
  const dirPath = path.join(ROOT, dirName);
  const files = walk(dirPath);
  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (EMOJI_REGEX.test(lines[i])) {
        const rel = path.relative(ROOT, file).replace(/\\/g, "/");
        console.error(`[check:emoji] Emoji found in ${rel}:${i + 1}: ${lines[i].trim()}`);
        found++;
      }
    }
  }
}

if (found > 0) {
  console.error(`\n[check:emoji] Total ${found} emoji occurrence(s) found! Rule 2 violation.`);
  process.exit(1);
} else {
  console.log("[check:emoji] Zero emojis found across src, src-tauri, plugins.");
}
