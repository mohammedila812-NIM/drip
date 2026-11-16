#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const APP_TSX = path.join(ROOT, "src", "App.tsx");
const GOLDEN_PATH = path.join(ROOT, "scripts", "motion.golden.json");

const BEGIN_REGEX = /(?:\/\/|\{\/\*)\s*<motion:begin\s+([A-Za-z0-9_]+)>(?:\s*\*\/)?/;
const END_REGEX = /(?:\/\/|\{\/\*)\s*<motion:end\s+([A-Za-z0-9_]+)>(?:\s*\*\/)?/;

function extractMotionBlocks(content) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks = {};
  let currentName = null;
  let currentLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const beginMatch = line.match(BEGIN_REGEX);
    const endMatch = line.match(END_REGEX);

    if (beginMatch) {
      if (currentName) {
        console.error(`[check:motion] Error at line ${i + 1}: nested begin tag "${beginMatch[1]}" inside "${currentName}"`);
        process.exit(1);
      }
      currentName = beginMatch[1];
      currentLines = [];
    } else if (endMatch) {
      if (!currentName) {
        console.error(`[check:motion] Error at line ${i + 1}: unexpected end tag "${endMatch[1]}" without begin tag`);
        process.exit(1);
      }
      if (currentName !== endMatch[1]) {
        console.error(`[check:motion] Error at line ${i + 1}: mismatched end tag "${endMatch[1]}", expected "${currentName}"`);
        process.exit(1);
      }
      blocks[currentName] = currentLines.join("\n");
      currentName = null;
      currentLines = [];
    } else if (currentName !== null) {
      currentLines.push(line);
    }
  }

  if (currentName) {
    console.error(`[check:motion] Error: unclosed motion block "${currentName}" at end of file`);
    process.exit(1);
  }

  return blocks;
}

function computeHashes(blocks) {
  const hashes = {};
  for (const [name, text] of Object.entries(blocks)) {
    hashes[name] = crypto.createHash("sha256").update(text, "utf8").digest("hex");
  }
  return hashes;
}

function run() {
  const isUpdate = process.argv.includes("--update");

  if (!fs.existsSync(APP_TSX)) {
    console.error(`[check:motion] Missing file: ${APP_TSX}`);
    process.exit(1);
  }

  const content = fs.readFileSync(APP_TSX, "utf8");
  const blocks = extractMotionBlocks(content);
  const hashes = computeHashes(blocks);

  const blockNames = Object.keys(hashes);
  if (blockNames.length === 0) {
    console.error("[check:motion] No motion blocks found in src/App.tsx!");
    process.exit(1);
  }

  if (isUpdate) {
    fs.writeFileSync(GOLDEN_PATH, JSON.stringify(hashes, null, 2) + "\n", "utf8");
    console.log(`[check:motion] Updated golden hashes for: ${blockNames.join(", ")}`);
    return;
  }

  if (!fs.existsSync(GOLDEN_PATH)) {
    console.error(`[check:motion] Golden file not found: ${GOLDEN_PATH}`);
    console.error("Run with --update to generate it from the current baseline.");
    process.exit(1);
  }

  const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, "utf8"));
  let failed = false;

  for (const [name, expectedHash] of Object.entries(golden)) {
    const actualHash = hashes[name];
    if (!actualHash) {
      console.error(`[check:motion] FAIL: Missing motion block "${name}"`);
      failed = true;
    } else if (actualHash !== expectedHash) {
      console.error(`[check:motion] FAIL: Hash mismatch for "${name}"`);
      console.error(`  Expected: ${expectedHash}`);
      console.error(`  Actual:   ${actualHash}`);
      failed = true;
    }
  }

  for (const name of Object.keys(hashes)) {
    if (!golden[name]) {
      console.error(`[check:motion] FAIL: Extra motion block "${name}" not in golden file`);
      failed = true;
    }
  }

  if (failed) {
    console.error("\n[check:motion] Droplet physics/animation code has diverged from golden freeze!");
    process.exit(1);
  }

  console.log(`[check:motion] OK: All ${blockNames.length} motion blocks match golden freeze (${blockNames.join(", ")})`);
}

run();
