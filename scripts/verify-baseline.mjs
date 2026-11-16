import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const APP_TSX = path.join(ROOT, "src", "App.tsx");

const oldContent = execSync("git show 060c23c:src/App.tsx", { encoding: "utf8" }).replace(/\r\n/g, "\n");
const headContent = fs.readFileSync(APP_TSX, "utf8").replace(/\r\n/g, "\n");

const BEGIN_REGEX = /(?:\/\/|\{\/\*)\s*<motion:begin\s+([A-Za-z0-9_]+)>(?:\s*\*\/)?/;
const END_REGEX = /(?:\/\/|\{\/\*)\s*<motion:end\s+([A-Za-z0-9_]+)>(?:\s*\*\/)?/;

function extractMarkedBlocks(text) {
  const lines = text.split("\n");
  const blocks = {};
  let current = null;
  let linesBuf = [];
  for (const line of lines) {
    const b = line.match(BEGIN_REGEX);
    const e = line.match(END_REGEX);
    if (b) {
      current = b[1];
      linesBuf = [];
    } else if (e) {
      blocks[current] = linesBuf.join("\n");
      current = null;
      linesBuf = [];
    } else if (current) {
      linesBuf.push(line);
    }
  }
  return blocks;
}

const headBlocks = extractMarkedBlocks(headContent);

// Extract from oldContent by finding the exact text corresponding to each block
const oldBlocks = {};

// K_TABLE
const kStart = oldContent.indexOf("const K = {");
const kEnd = oldContent.indexOf("type Sp = { v: number; t: number; x: number };") + "type Sp = { v: number; t: number; x: number };".length;
oldBlocks["K_TABLE"] = oldContent.slice(kStart, kEnd);

// KICK
const kickStart = oldContent.indexOf("    const kick = (k: Key, v: number) => {");
const kickEnd = oldContent.indexOf("    };", kickStart) + "    };".length;
oldBlocks["KICK"] = oldContent.slice(kickStart, kickEnd);

// TICK
const tickStart = oldContent.indexOf("    const tick = (now: number) => {");
const tickMarker = "S.raf = moving || S.cur !== S.want ? requestAnimationFrame(tick) : 0;\n    };";
const tickEnd = oldContent.indexOf(tickMarker, tickStart) + tickMarker.length;
oldBlocks["TICK"] = oldContent.slice(tickStart, tickEnd);

// WAKE
const wakeStart = oldContent.indexOf("    S.wake = () => {");
const wakeMarker = "S.raf = requestAnimationFrame(tick);\n      }\n    };";
const wakeEnd = oldContent.indexOf(wakeMarker, wakeStart) + wakeMarker.length;
oldBlocks["WAKE"] = oldContent.slice(wakeStart, wakeEnd);

// SVG_BLOB
const svgStart = oldContent.indexOf("      <svg\n        style={{");
const svgMarker = "      </svg>";
const svgEnd = oldContent.indexOf(svgMarker, svgStart) + svgMarker.length;
oldBlocks["SVG_BLOB"] = oldContent.slice(svgStart, svgEnd);

const names = ["K_TABLE", "KICK", "TICK", "WAKE", "SVG_BLOB"];
let allMatch = true;

console.log("=== MOTION BLOCK BYTE-BY-BYTE BASELINE COMPARISON ===");
console.log("Commit baseline: 060c23c vs HEAD\n");

for (const name of names) {
  const oldText = oldBlocks[name];
  const headText = headBlocks[name];

  const oldHash = crypto.createHash("sha256").update(oldText, "utf8").digest("hex");
  const headHash = crypto.createHash("sha256").update(headText, "utf8").digest("hex");

  const match = oldHash === headHash && oldText === headText;
  if (!match) allMatch = false;

  console.log(`Block: ${name}`);
  console.log(`  060c23c SHA-256: ${oldHash}`);
  console.log(`  HEAD    SHA-256: ${headHash}`);
  console.log(`  Byte match:      ${match ? "EXACT MATCH (IDENTICAL)" : "MISMATCH"}`);
  if (!match) {
    console.log(`  Length old: ${oldText?.length}, length head: ${headText?.length}`);
  }
  console.log("");
}

if (!allMatch) {
  console.error("FAIL: Motion blocks do not match 060c23c byte-for-byte!");
  process.exit(1);
} else {
  console.log("SUCCESS: All 5 motion blocks are 100% byte-identical to pre-Phase 0 commit 060c23c.");
}
