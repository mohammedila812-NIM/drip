// Drip plugin host. Plugins live in %APPDATA%\dev.drip.app\plugins\<id>\plugin.json and come in two kinds:
//   { "name": "..", "main": "index.js", "permissions": [] }                 sandboxed Web Worker; talks through the global `drip`
//   { "name": "..", "exec": ["powershell","-File","x.ps1"], "permissions": [] }   child process; one JSON object per line on stdout / stdin
// permissions: "fg" = receives foreground app + window title, "peek" = may open the island by itself.
// Both kinds speak the same protocol and everything they send is sanitised here: ids are namespaced "<plugin>:<id>",
// priority is clamped to 1..9 (core alerts own 10+), text is length-limited, colours are validated.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Act } from "./App";
import { TokenBucketRateLimiter } from "./lib/rateLimit";

export type Man = {
  id: string;
  hash?: string;
  name?: string;
  main?: string;
  exec?: string[];
  code?: string;
  permissions?: string[];
  enabled?: boolean;
  error?: string;
};

export type Host = {
  push(a: Act): void;
  clear(id: string, prefix?: boolean): void;
  peek(ms: number): void;
};

type Live = {
  m: Man;
  post(x: unknown): void;
  kill(): void;
  _hash?: string;
};

// worker prelude = the whole plugin API: drip.push / clear / peek / on("action"|"fg") / every / store.get / store.set
const PRE = `(()=>{const H={},S={},P=m=>postMessage(m);
self.drip={push:a=>P({push:a}),clear:i=>P({clear:i}),peek:ms=>P({peek:ms}),on:(e,f)=>(H[e]??=[]).push(f),every:(ms,f)=>setInterval(f,ms),store:{get:k=>S[k],set:(k,v)=>{S[k]=v;P({store:[k,v]})}}};
onmessage=e=>{const m=e.data;if(m.init)Object.assign(S,m.init.store);else(H[m.ev]||[]).forEach(f=>f(m.data))}})();`;

const COL = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d\s.,%/a-z]+\))$/i;

// Built-in bundled plugins ensuring out-of-the-box functionality even without manual folder copying
export const BUILTIN_PLUGINS: Man[] = [
  {
    id: "focus-timer",
    name: "Focus Timer",
    main: "index.js",
    permissions: ["peek"],
    hash: "builtin:focus-timer",
    code: `
      const LEN = 25 * 60;
      let end = 0, paused = 0, rem = LEN;
      const mmss = s => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");

      function showOffer() {
        drip.push({
          id: "offer",
          pri: 2,
          icon: "clock",
          title: "Focus Session",
          side: "25 min",
          actions: ["Start"],
          sub: "25-minute Pomodoro focus block"
        });
      }

      showOffer();

      drip.on("action", ({ id, action }) => {
        if (action === "Start") {
          end = Date.now() + rem * 1000;
          paused = 0;
          drip.clear("offer");
          updateRun();
        } else if (action === "Pause") {
          rem = Math.max(0, Math.round((end - Date.now()) / 1000));
          end = 0;
          paused = 1;
          drip.push({
            id: "run",
            pri: 4,
            icon: "clock",
            title: mmss(rem),
            side: "Paused",
            p: 1 - rem / LEN,
            color: "#ffd60a",
            w: 230,
            actions: ["Resume", "Reset"],
            sub: "Session paused"
          });
        } else if (action === "Resume") {
          end = Date.now() + rem * 1000;
          paused = 0;
          updateRun();
        } else if (action === "+5m") {
          if (end) end += 300 * 1000; else rem += 300;
          updateRun();
        } else if (action === "Reset" || action === "Stop") {
          end = 0; paused = 0; rem = LEN;
          drip.clear("run");
          showOffer();
        }
      });

      function updateRun() {
        const s = Math.max(0, Math.round((end - Date.now()) / 1000));
        drip.push({
          id: "run",
          pri: 4,
          icon: "clock",
          title: mmss(s),
          side: "Focus",
          p: 1 - s / LEN,
          color: "#ff453a",
          w: 230,
          actions: ["Pause", "+5m", "Stop"],
          sub: "Deep work session in progress"
        });
      }

      drip.every(1000, () => {
        if (!end || paused) return;
        const s = Math.max(0, Math.round((end - Date.now()) / 1000));
        if (s === 0) {
          end = 0;
          drip.push({
            id: "run",
            pri: 5,
            icon: "clock",
            title: "Done!",
            side: "Break",
            p: 1,
            color: "#30d158",
            w: 230,
            actions: ["Restart", "Dismiss"],
            sub: "Time for a 5-minute break",
            peek: 5000
          });
        } else {
          updateRun();
        }
      });
    `
  },
  {
    id: "scratchpad",
    name: "Scratchpad",
    main: "index.js",
    permissions: [],
    hash: "builtin:scratchpad",
    code: `
      const NOTES = [
        "Drink a glass of water",
        "Stretch and fix posture",
        "Review today's goals",
        "Deep breath, stay focused"
      ];
      let idx = drip.store.get("idx") || 0;
      function show() {
        drip.store.set("idx", idx);
        drip.push({
          id: "note",
          pri: 1,
          icon: "info",
          title: NOTES[idx],
          side: (idx + 1) + "/" + NOTES.length,
          color: "#0a84ff",
          w: 240,
          actions: ["Next"]
        });
      }
      drip.on("action", ({ id, action }) => {
        if (action === "Next") {
          idx = (idx + 1) % NOTES.length;
          show();
        }
      });
      show();
    `
  }
];

export function startPlugins(h: Host) {
  const live = new Map<string, Live>();
  const limiters = new Map<string, TokenBucketRateLimiter>();
  let fg: unknown = null;
  let disposed = false;
  let loadGen = 0;
  const can = (m: Man, p: string) => !!m.permissions?.includes(p);
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : undefined);
  const num = (v: unknown, lo: number, hi: number) =>
    typeof v === "number" && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : undefined;

  const clean = (m: Man, a: any): Act | null => {
    if (!a || typeof a.title !== "string") return null;
    return {
      id: m.id + ":" + (str(a.id, 40) ?? "main"),
      pri: num(a.pri, 1, 9) ?? 2,
      title: a.title.slice(0, 60),
      icon: str(a.icon, 16),
      side: str(a.side, 24),
      sub: str(a.sub, 140),
      p: num(a.p, 0, 1),
      color: typeof a.color === "string" && COL.test(a.color) ? a.color : undefined,
      w: num(a.w, 170, 380),
      ttl: num(a.ttl, 500, 3600000),
      peek: can(m, "peek") ? num(a.peek, 500, 10000) : undefined,
      when: typeof a.when?.app === "string" ? { app: a.when.app.slice(0, 80) } : undefined,
      actions: Array.isArray(a.actions) ? a.actions.slice(0, 3).map((x: unknown) => String(x).slice(0, 16)) : undefined,
    };
  };

  const onMsg = (m: Man, d: any) => {
    if (!d || typeof d !== "object") return;
    let limiter = limiters.get(m.id);
    if (!limiter) {
      limiter = new TokenBucketRateLimiter(20, 50);
      limiters.set(m.id, limiter);
    }
    if ("push" in d) {
      const a = clean(m, d.push);
      if (a) {
        limiter.submit("push", a.id, a, (act) => h.push(act));
      }
    } else if ("clear" in d) {
      const clearId = m.id + ":" + String(d.clear).slice(0, 40);
      limiter.submit("clear", clearId, clearId, (id) => h.clear(id));
    } else if ("action" in d) {
      limiter.submit("action", undefined, d.action, () => {});
    } else if ("peek" in d) {
      if (can(m, "peek")) {
        const ms = num(d.peek, 500, 10000) ?? 3000;
        limiter.submit("peek", undefined, ms, (val) => h.peek(val));
      }
    } else if ("store" in d && Array.isArray(d.store)) {
      try {
        localStorage.setItem(`drip:${m.id}:${String(d.store[0]).slice(0, 40)}`, JSON.stringify(d.store[1]));
      } catch {}
    } else if (typeof d.title === "string") {
      const a = clean(m, d);
      if (a) {
        limiter.submit("push", a.id, a, (act) => h.push(act));
      }
    }
  };

  const sendFg = (p: Live) => {
    if (fg && can(p.m, "fg")) p.post({ ev: "fg", data: fg });
  };

  const run = (m: Man, hashKey?: string) => {
    if (typeof m.main === "string" && typeof m.code === "string") {
      const url = URL.createObjectURL(new Blob([PRE + "\n" + m.code], { type: "text/javascript" }));
      const w = new Worker(url),
        pre = `drip:${m.id}:`,
        store: Record<string, unknown> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!;
        if (k.startsWith(pre)) {
          try {
            store[k.slice(pre.length)] = JSON.parse(localStorage.getItem(k)!);
          } catch {}
        }
      }
      w.onmessage = (e) => onMsg(m, e.data);
      w.onerror = (e) => console.warn(`[drip:${m.id}]`, e.message);
      const p: Live = {
        m,
        post: (x) => w.postMessage(x),
        kill: () => {
          w.terminate();
          URL.revokeObjectURL(url);
        },
        _hash: hashKey,
      };
      live.set(m.id, p);
      p.post({ init: { store } });
      sendFg(p);
    } else if (m.exec) {
      const p: Live = {
        m,
        post: (x) => {
          invoke("plugin_send", { id: m.id, line: JSON.stringify(x) }).catch(() => {});
        },
        kill: () => {
          invoke("plugin_stop", { id: m.id }).catch(() => {});
        },
        _hash: hashKey,
      };
      live.set(m.id, p);
      invoke("plugin_run", { id: m.id })
        .then(() => sendFg(p))
        .catch((e) => console.warn(`[drip:${m.id}]`, e));
    }
  };

  const stopAll = () => {
    live.forEach((p, id) => {
      p.kill();
      h.clear(id + ":", true);
    });
    live.clear();
  };

  const unPlugin = listen<{ id: string; line: string }>("island:plugin", (e) => {
    const p = live.get(e.payload.id);
    if (p) {
      try {
        onMsg(p.m, JSON.parse(e.payload.line));
      } catch {}
    }
  });

  const unExit = listen<{ id: string; code?: number }>("island:plugin-exit", (e) => {
    const { id, code } = e.payload;
    console.log("[drip:plugin-exit]", id, code);
    const p = live.get(id);
    if (p) {
      p.kill();
      live.delete(id);
    }
    h.clear(id + ":", true);
  });

  return {
    // Differential auto-reconciliation: auto-detects new/modified plugins without restarting unchanged ones
    async load() {
      if (disposed) return;
      const gen = ++loadGen;
      let diskList: Man[];
      try {
        diskList = await invoke<Man[]>("plugins_list");
      } catch (e) {
        console.warn("[drip:plugins] failed to list plugins; keeping current running plugins:", e);
        return;
      }
      if (disposed || gen !== loadGen) return;

      const diskIds = new Set(diskList.map((m) => m.id));
      const allPlugins = [...diskList, ...BUILTIN_PLUGINS.filter((b) => !diskIds.has(b.id))];
      const nextIds = new Set(allPlugins.filter((m) => m.enabled !== false && !m.error).map((m) => m.id));

      // Remove deleted, disabled, or broken plugins
      for (const [id, p] of live.entries()) {
        if (!nextIds.has(id)) {
          p.kill();
          h.clear(id + ":", true);
          live.delete(id);
          const lim = limiters.get(id);
          if (lim) {
            lim.dispose();
            limiters.delete(id);
          }
        }
      }

      // Add new or update modified plugins
      for (const m of allPlugins) {
        if (m.enabled === false) continue;
        if (m.error) {
          console.warn(`[drip:${m.id}] plugin error: ${m.error}`);
          continue;
        }

        const hashKey = m.hash ?? (m.code ?? "") + (m.exec ? JSON.stringify(m.exec) : "");
        const existing = live.get(m.id);

        if (existing) {
          if (existing._hash === hashKey) {
            // Unchanged: keep running
            continue;
          }
          // Modified: kill old instance and acts
          existing.kill();
          h.clear(m.id + ":", true);
          live.delete(m.id);
        }

        // Fetch code if required and not yet present
        if (m.main && !m.code) {
          try {
            m.code = await invoke<string>("plugin_code", { id: m.id });
          } catch (e) {
            console.warn(`[drip:${m.id}] failed to load plugin code:`, e);
            continue;
          }
        }

        run(m, hashKey);
      }
    },
    fg(f: unknown) {
      fg = f;
      live.forEach(sendFg);
    },
    action(id: string, action: string) {
      const i = id.indexOf(":");
      if (i > 0) {
        live.get(id.slice(0, i))?.post({ ev: "action", data: { id: id.slice(i + 1), action } });
      }
    },
    dispose() {
      disposed = true;
      loadGen++;
      stopAll();
      for (const lim of limiters.values()) {
        lim.dispose();
      }
      limiters.clear();
      unPlugin.then((f) => f());
      unExit.then((f) => f());
    },
  };
}
