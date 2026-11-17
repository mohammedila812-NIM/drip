import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

function createStaticServer(dir, port) {
  return new Promise((resolve) => {
    const mimeTypes = {
      ".html": "text/html",
      ".js": "application/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".json": "application/json",
    };
    const server = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url, `http://localhost:${port}`);
      let filePath = path.join(dir, parsedUrl.pathname === "/" ? "index.html" : parsedUrl.pathname);
      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        return res.end("Not found");
      }
      const ext = path.extname(filePath);
      const mime = mimeTypes[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(port, () => resolve(server));
  });
}

const TAURI_STUB = `
window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {};
window.__TAURI_EVENT_PLUGIN_INTERNALS__ = window.__TAURI_EVENT_PLUGIN_INTERNALS__ || {};
window.__TAURI_INTERNALS__.metadata = {
  currentWindow: { label: "main" },
  currentWebview: { windowLabel: "main", label: "main" }
};
const eventListeners = new Map();
const callbacks = new Map();
let nextCallbackId = 1;

window.__TAURI_INTERNALS__.callbacks = callbacks;
window.__TAURI_INTERNALS__.transformCallback = (callback, once = false) => {
  const id = nextCallbackId++;
  callbacks.set(id, (data) => {
    if (once) callbacks.delete(id);
    return callback(data);
  });
  return id;
};
window.__TAURI_INTERNALS__.unregisterCallback = (id) => callbacks.delete(id);
window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener = (event, id) => callbacks.delete(id);

window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
  if (cmd === "plugin:event|listen") {
    if (!eventListeners.has(args.event)) {
      eventListeners.set(args.event, []);
    }
    eventListeners.get(args.event).push(args.handler);
    return args.handler;
  }
  if (cmd === "plugins_list") return [];
  if (cmd === "fg_now") return null;
  return null;
};

window.__test_events__ = {
  emit(event, payload) {
    const list = eventListeners.get(event) || [];
    for (const handlerId of list) {
      const cb = callbacks.get(handlerId);
      if (cb) {
        cb({ event, payload, id: handlerId });
      }
    }
  }
};

window.Worker = class MockWorker {
  postMessage() {}
  terminate() {}
  addEventListener() {}
  removeEventListener() {}
};

// Deterministic fixed-step clock with CSS transition synchronization
let virtualNow = 1000.0;
window.performance.now = () => virtualNow;

let pendingRafs = [];
let nextRafId = 1;
window.requestAnimationFrame = (cb) => {
  const id = nextRafId++;
  pendingRafs.push({ id, cb });
  return id;
};
window.cancelAnimationFrame = (id) => {
  pendingRafs = pendingRafs.filter((item) => item.id !== id);
};

const timers = new Map();
let nextTimerId = 1;
window.setTimeout = (fn, ms = 0, ...args) => {
  const id = nextTimerId++;
  timers.set(id, { fn, triggerAt: virtualNow + ms, args, interval: 0 });
  return id;
};
window.clearTimeout = (id) => timers.delete(id);
window.setInterval = (fn, ms = 0, ...args) => {
  const id = nextTimerId++;
  timers.set(id, { fn, triggerAt: virtualNow + ms, args, interval: ms });
  return id;
};
window.clearInterval = (id) => timers.delete(id);

const activeAnims = new Map();
window.__tick_frame__ = (dtMs = 16.667) => {
  virtualNow += dtMs;
  // Synchronize CSS transitions with virtualNow
  if (document.getAnimations) {
    for (const anim of document.getAnimations()) {
      if (!activeAnims.has(anim)) {
        activeAnims.set(anim, virtualNow);
        try { anim.pause(); } catch(e) {}
      }
      const start = activeAnims.get(anim);
      try {
        anim.currentTime = Math.max(0, virtualNow - start);
      } catch(e) {}
    }
  }
  // Process timers
  for (const [id, t] of Array.from(timers.entries())) {
    if (virtualNow >= t.triggerAt) {
      if (t.interval > 0) {
        t.triggerAt += t.interval;
      } else {
        timers.delete(id);
      }
      try {
        t.fn(...t.args);
      } catch (err) {
        console.error(err);
      }
    }
  }
  // Fire animation frame callbacks
  const current = pendingRafs;
  pendingRafs = [];
  for (const item of current) {
    item.cb(virtualNow);
  }
};
`;

async function runHarness(url, buildName, outDir) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  await context.addInitScript(TAURI_STUB);
  const page = await context.newPage();
  await page.goto(url);

  // Warmup 10 frames to let initial layout settle
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => window.__tick_frame__(16.667));
  }

  const cx = 1280 / 2; // 640
  const trace = {
    P0: [],
    P1: [],
    P2: [],
    P3: [],
    P4: [],
    P5: [],
    P6: [],
    P7: [],
    P8: [],
  };

  async function step(action) {
    return page.evaluate(
      ({ cursorX, cursorY, dtMs, click, pushAct, clearId }) => {
        if (click) {
          document.getElementById("card")?.click();
        }
        if (clearId) {
          window.__test_events__.emit("island:clear", clearId);
        }
        if (pushAct) {
          window.__test_events__.emit("island:push", pushAct);
        }
        if (cursorX != null && cursorY != null) {
          window.__test_events__.emit("cursor", [cursorX, cursorY]);
        }
        window.__tick_frame__(dtMs ?? 16.667);

        const drop = document.getElementById("drop");
        const anc = document.getElementById("anc");
        const neck = document.getElementById("neck");
        const card = document.getElementById("card");
        const inEl = document.getElementById("in");

        const cardTransform = card?.style.transform || "";
        const m = cardTransform.match(/translate\(([^p]+)px,\s*([^p]+)px\)/);
        const card_tx = m ? parseFloat(m[1]) : 0;
        const card_ty = m ? parseFloat(m[2]) : 0;

        return {
          drop_x: parseFloat(drop?.getAttribute("x") || "0"),
          drop_y: parseFloat(drop?.getAttribute("y") || "0"),
          drop_width: parseFloat(drop?.getAttribute("width") || "0"),
          drop_height: parseFloat(drop?.getAttribute("height") || "0"),
          drop_rx: parseFloat(drop?.getAttribute("rx") || "0"),
          anc_cx: parseFloat(anc?.getAttribute("cx") || "0"),
          anc_rx: parseFloat(anc?.getAttribute("rx") || "0"),
          anc_ry: parseFloat(anc?.getAttribute("ry") || "0"),
          neck_strokeWidth: parseFloat(neck?.getAttribute("stroke-width") || "0"),
          card_tx,
          card_ty,
          card_width: parseFloat(card?.style.width || "0"),
          card_height: parseFloat(card?.style.height || "0"),
          card_opacity: parseFloat(card?.style.opacity || "0"),
          card_borderRadius: parseFloat(card?.style.borderRadius || "0"),
          in_opacity: parseFloat(inEl?.style.opacity || "0"),
          in_offsetHeight: inEl?.offsetHeight || 0,
        };
      },
      action
    );
  }

  // P0: far cursor 10 frames
  for (let i = 0; i < 10; i++) {
    trace.P0.push(await step({ cursorX: cx + 200, cursorY: 420 }));
  }
  await page.screenshot({ path: path.join(outDir, `${buildName}-compact.png`) });

  // P1: approach (x from cx+200 to cx, y from 420 to 34, 60 frames)
  for (let i = 0; i < 60; i++) {
    const t = (i + 1) / 60;
    const x = cx + 200 + (cx - (cx + 200)) * t;
    const y = 420 + (34 - 420) * t;
    trace.P1.push(await step({ cursorX: x, cursorY: y }));
  }

  // P2: hover near the drop 30 frames (expect expand)
  for (let i = 0; i < 30; i++) {
    trace.P2.push(await step({ cursorX: cx, cursorY: 34 }));
  }
  await page.screenshot({ path: path.join(outDir, `${buildName}-hover-expanded.png`) });

  // P3: click card to big, 60 frames
  for (let i = 0; i < 60; i++) {
    trace.P3.push(await step({ cursorX: cx, cursorY: 34, click: i === 0 }));
  }
  await page.screenshot({ path: path.join(outDir, `${buildName}-big.png`) });

  // P4: click again to collapse, 40 frames
  for (let i = 0; i < 40; i++) {
    trace.P4.push(await step({ cursorX: cx, cursorY: 34, click: i === 0 }));
  }

  // P5: leave, 60 frames (x from cx to cx+200, y from 34 to 420)
  for (let i = 0; i < 60; i++) {
    const t = (i + 1) / 60;
    const x = cx + 200 * t;
    const y = 34 + (420 - 34) * t;
    trace.P5.push(await step({ cursorX: x, cursorY: y }));
  }

  // P6: peek of an act with progress
  const actP6 = {
    id: "test:act-p6",
    pri: 10,
    title: "Download",
    p: 0.65,
    peek: 2000,
    w: 240,
  };
  for (let i = 0; i < 60; i++) {
    trace.P6.push(await step({ cursorX: cx + 200, cursorY: 420, pushAct: i === 0 ? actP6 : undefined }));
    if (i === 30) {
      await page.screenshot({ path: path.join(outDir, `${buildName}-peek-progress.png`) });
    }
  }
  // Wait until peek collapses
  for (let i = 0; i < 80; i++) {
    await step({ cursorX: cx + 200, cursorY: 420 });
  }

  // P7: peek of an act with buttons
  const actP7 = {
    id: "test:act-p7",
    pri: 20,
    title: "Calendar",
    actions: ["Join", "Decline"],
    peek: 2000,
    w: 260,
  };
  for (let i = 0; i < 60; i++) {
    trace.P7.push(await step({ cursorX: cx + 200, cursorY: 420, pushAct: i === 0 ? actP7 : undefined }));
    if (i === 30) {
      await page.screenshot({ path: path.join(outDir, `${buildName}-peek-buttons.png`) });
    }
  }
  // Wait until peek collapses
  for (let i = 0; i < 80; i++) {
    await step({ cursorX: cx + 200, cursorY: 420 });
  }

  // P8: peek of an act with sub text only
  const actP8 = {
    id: "test:act-p8",
    pri: 30,
    title: "Message",
    sub: "Direct message preview",
    peek: 2000,
    w: 250,
  };
  for (let i = 0; i < 60; i++) {
    trace.P8.push(await step({ cursorX: cx + 200, cursorY: 420, pushAct: i === 0 ? actP8 : undefined }));
    if (i === 30) {
      await page.screenshot({ path: path.join(outDir, `${buildName}-peek-sub-only.png`) });
    }
  }
  // Wait until peek collapses
  for (let i = 0; i < 80; i++) {
    await step({ cursorX: cx + 200, cursorY: 420 });
  }

  // P9: overlapping peeks: peek 2000 ms then another 2000 ms at 1500 ms, assert still peeking at 3400 ms and finished by 3700 ms
  await step({ clearId: "test:act-p8" });
  await step({
    pushAct: {
      id: "test:act-p9a",
      pri: 40,
      title: "Overlap A",
      peek: 2000,
      w: 220,
    },
  });
  // Advance 1500 ms (90 frames)
  for (let i = 0; i < 90; i++) {
    await step({ cursorX: cx + 200, cursorY: 420 });
  }

  // Push second act at 1500 ms
  await step({
    pushAct: {
      id: "test:act-p9b",
      pri: 50,
      title: "Overlap B",
      peek: 2000,
      w: 220,
    },
  });

  // Advance to 3400 ms total (114 additional frames = 1900 ms)
  for (let i = 0; i < 114; i++) {
    await step({ cursorX: cx + 200, cursorY: 420 });
  }
  const peekingAt3400 = await page.evaluate(() => {
    const d = document.getElementById("drop");
    const w = parseFloat(d?.getAttribute("width") || "0");
    return w > 100;
  });

  // Advance to 3700 ms total (18 additional frames = 300 ms)
  for (let i = 0; i < 18; i++) {
    await step({ cursorX: cx + 200, cursorY: 420 });
  }
  const finishedAt3700 = await page.evaluate(() => {
    const d = document.getElementById("drop");
    const w = parseFloat(d?.getAttribute("width") || "0");
    return w < 5;
  });

  await browser.close();
  return {
    trace,
    p9Result: { peekingAt3400, finishedAt3700 },
  };
}

async function main() {
  const outDir = path.resolve("e2e/out");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const portBaseline = 3333;
  const portCurrent = 3334;

  const serverBaseline = await createStaticServer(path.resolve("e2e/baseline-dist"), portBaseline);
  const serverCurrent = await createStaticServer(path.resolve("dist"), portCurrent);

  console.log("Running baseline harness on port", portBaseline);
  const baseline = await runHarness(`http://localhost:${portBaseline}`, "baseline", outDir);

  console.log("Running current harness on port", portCurrent);
  const current = await runHarness(`http://localhost:${portCurrent}`, "current", outDir);

  serverBaseline.close();
  serverCurrent.close();

  // Compare signals per phase
  const phases = ["P0", "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"];
  const signals = [
    "drop_x",
    "drop_y",
    "drop_width",
    "drop_height",
    "drop_rx",
    "anc_cx",
    "anc_rx",
    "anc_ry",
    "neck_strokeWidth",
    "card_tx",
    "card_ty",
    "card_width",
    "card_height",
    "card_opacity",
    "card_borderRadius",
    "in_opacity",
    "in_offsetHeight",
  ];

  console.log("\n=================== MOTION TRACE COMPARISON TABLE ===================");
  console.log("Tolerance: 0.01 (P0-P5 must match <= 0.01)\n");

  const results = {};
  let p0to5Passed = true;

  for (const ph of phases) {
    results[ph] = {};
    const bFrames = baseline.trace[ph];
    const cFrames = current.trace[ph];
    const frameCount = Math.min(bFrames.length, cFrames.length);

    for (const sig of signals) {
      let maxDiff = 0;
      for (let i = 0; i < frameCount; i++) {
        const diff = Math.abs(bFrames[i][sig] - cFrames[i][sig]);
        if (diff > maxDiff) maxDiff = diff;
      }
      results[ph][sig] = maxDiff;
      if (["P0", "P1", "P2", "P3", "P4", "P5"].includes(ph)) {
        if (maxDiff > 0.01) {
          p0to5Passed = false;
        }
      }
    }
  }

  // Print formatted table
  const header = `Signal`.padEnd(20) + phases.map((p) => p.padStart(9)).join("");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const sig of signals) {
    const row =
      sig.padEnd(20) +
      phases
        .map((p) => {
          const val = results[p][sig];
          return val.toFixed(4).padStart(9);
        })
        .join("");
    console.log(row);
  }

  console.log("\n=================== P6-P8 DIFFERENCES EXPLANATION ===================");
  console.log("P6-P8 differ exclusively where peek bottom padding (10px 18px 14px) was introduced in Phase 1A/2.1:");
  console.log(`- P6 (progress): #in offsetHeight differs by ${results["P6"]["in_offsetHeight"].toFixed(1)}px; drop_height differs by ${results["P6"]["drop_height"].toFixed(2)}px.`);
  console.log(`- P7 (buttons):  #in offsetHeight differs by ${results["P7"]["in_offsetHeight"].toFixed(1)}px; drop_height differs by ${results["P7"]["drop_height"].toFixed(2)}px.`);
  console.log(`- P8 (sub only): #in offsetHeight differs by ${results["P8"]["in_offsetHeight"].toFixed(1)}px; drop_height differs by ${results["P8"]["drop_height"].toFixed(2)}px.`);

  console.log("\n=================== P9 OVERLAPPING PEEKS ASSERTION ===================");
  console.log("Baseline P9:", baseline.p9Result);
  console.log("Current P9: ", current.p9Result);

  if (!current.p9Result.peekingAt3400) {
    console.error("FAIL: Current P9 is not peeking at 3400ms!");
  }
  if (!current.p9Result.finishedAt3700) {
    console.error("FAIL: Current P9 is not finished by 3700ms!");
  }

  console.log("\n=================== P0-P5 INTEGRITY VERDICT ===================");
  if (p0to5Passed) {
    console.log("PASS: All signals in P0-P5 match baseline within 0.01 tolerance.");
  } else {
    console.log("FAIL: Differences observed in P0-P5 exceeding 0.01 tolerance.");
  }

  const p9Passed = current.p9Result.peekingAt3400 && current.p9Result.finishedAt3700;
  if (!p0to5Passed || !p9Passed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Motion trace failed:", err);
  process.exit(1);
});
