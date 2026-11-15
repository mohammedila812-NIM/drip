// Drip: liquid dynamic island core for Windows. Drop in as src/App.tsx of a Tauri 2 + React-TS app.
// Native code, plugins or other apps feed it with `emit("island:push", Act)`; it emits "island:action" back on button clicks.
// [drip] added on top of the original: foreground-window awareness (fullscreen retreat, hot-edge over maximized windows,
//        per-app clock card), `peek` (alerts drip out on their own) and a plugin host (see plugins.ts).
import { useEffect, useRef, useState } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { startPlugins } from "./plugins";

// peek: ms to auto-open without hover; when: only eligible while the foreground exe matches this regex
export type Act = { id: string; pri: number; title: string; icon?: string; side?: string; sub?: string; p?: number; color?: string; w?: number; ttl?: number; actions?: string[]; peek?: number; when?: { app: string } };
export type Fg = { exe: string; title: string; full: boolean; max: boolean; top: boolean; shell: boolean };

// [stiffness, damping] per spring: loose droplet, jelly pill, tight cursor smoothing
const K = { ix: [180, 16], dx: [110, 9], dy: [170, 11], dw: [200, 13], dh: [240, 15], ar: [200, 18], sx: [260, 28], sy: [260, 28], cf: [300, 30] } as const;
type Key = keyof typeof K;
type Sp = { v: number; t: number; x: number };
const RM = matchMedia("(prefers-reduced-motion:reduce)").matches;
const cl = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const $ = (id: string) => document.getElementById(id)!;
const set = (id: string, o: Record<string, number>) => { for (const k in o) $(id).setAttribute(k, String(o[k])); };

// [drip] localStorage "drip.mode": "auto" (default) | "free" (never hot-edge) | "edge" (always hot-edge)
const MODE = (() => { try { return localStorage.getItem("drip.mode") ?? "auto"; } catch { return "auto"; } })();
const APPS: Record<string, [string, string]> = { chrome: ["Chrome", "🌐"], msedge: ["Edge", "🌐"], firefox: ["Firefox", "🦊"], brave: ["Brave", "🦁"], code: ["VS Code", "🧑‍💻"], devenv: ["Visual Studio", "🧑‍💻"], explorer: ["Files", "📁"], spotify: ["Spotify", "🎵"], discord: ["Discord", "💬"], slack: ["Slack", "💬"], whatsapp: ["WhatsApp", "💬"], teams: ["Teams", "💬"], windowsterminal: ["Terminal", "⌨️"], powershell: ["PowerShell", "⌨️"], winword: ["Word", "📝"], excel: ["Excel", "📊"], powerpnt: ["PowerPoint", "📽️"], notepad: ["Notepad", "🗒️"], vlc: ["VLC", "🎬"], steam: ["Steam", "🎮"] };
const info = (f: Fg) => { const [n, i] = APPS[f.exe] ?? [f.exe.replace(/^./, c => c.toUpperCase()), "🪟"]; return { n, i }; };
const hue = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 85% 62%)`; };
let FG: Fg | null = null;   // latest foreground window, read by clock() and by `when` rules
const ok = (x: Act) => { if (!x.when) return true; try { return new RegExp(x.when.app, "i").test(FG?.exe ?? ""); } catch { return false; } };

// idle card: time + the app you are in (icon, name, window title, per-app accent); width adapts to the context
const clock = (): Act => {
  const f = FG && !FG.shell && FG.exe ? FG : null, i = f && info(f);
  return { id: "clock", pri: 0, icon: i?.i ?? "🕓", title: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), side: i?.n.slice(0, 14), sub: f?.title.slice(0, 70) || undefined, color: f ? hue(f.exe) : undefined, w: f ? 230 : 170 };
};

const init = () => {
  const sp = {} as Record<Key, Sp>;
  (Object.keys(K) as Key[]).forEach(k => (sp[k] = { v: 0, t: 0, x: 0 }));
  sp.ar.v = sp.ar.t = 1.5; sp.cf.v = sp.cf.t = 1;
  const a = clock();
  return { sp, cur: a, want: a, mx: 0, my: 420, exp: false, big: false, snap: false, raf: 0, wake: () => {},
    pk: 0, off: false, edge: false, eng: false, was: false, px: null as ReturnType<typeof startPlugins> | null }; // [drip] peek-until, fullscreen, hot-edge, engaged, was-open, plugin host
};

export default function Island() {
  const S = useRef(init()).current;
  const [acts, setActs] = useState<Act[]>([S.cur]);
  const [a, setShown] = useState<Act>(S.cur);
  const [big, setBig] = useState(false);
  const [ver, bump] = useState(0);   // [drip] re-evaluates `when` rules when the foreground app changes
  const setB = (v: boolean) => { S.big = v; setBig(v); S.wake(); };

  useEffect(() => {
    const win = getCurrentWindow(), s = S.sp, T = new Map<string, number>();
    const kick = (k: Key, v: number) => { if (!RM) s[k].x += v; };
    // [drip] open the island by itself for `ms` (alerts); skipped while a fullscreen app is in front
    const peek = (ms: number) => { if (S.off) return; S.pk = performance.now() + Math.min(ms, 10000); S.wake(); setTimeout(S.wake, Math.min(ms, 10000) + 50); };
    const push = (x: Act) => {
      setActs(l => [...l.filter(i => i.id !== x.id), x]);
      clearTimeout(T.get(x.id));   // [drip] a refreshed activity must not be killed by its previous ttl timer
      if (x.ttl) T.set(x.id, window.setTimeout(() => setActs(l => l.filter(i => i.id !== x.id)), x.ttl));
      if (x.peek) peek(x.peek);
    };
    const px = (S.px = startPlugins({ push, peek, clear: (id, pre) => setActs(l => l.filter(i => (pre ? !i.id.startsWith(id) : i.id !== id))) }));
    // [drip] foreground window changed (native thread -> "island:fg")
    const onFg = (f: Fg) => {
      FG = f; S.off = f.full;
      S.edge = MODE === "edge" || (MODE === "auto" && f.top);   // a window sits under the island zone: only the very top edge summons it
      if (!S.edge) S.eng = false;
      px.fg(f); push(clock()); bump(n => n + 1); S.wake();
    };
    S.mx = innerWidth / 2 + 200; s.sx.v = s.sx.t = S.mx; s.sy.v = s.sy.t = S.my;
    let last = 0;

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 1 / 30); last = now;
      const cx = innerWidth / 2, w = S.cur.w ?? 200, pk = !S.off && now < S.pk;
      const ih = (S.exp ? S.big : pk) ? $("in").offsetHeight : 40;
      // [drip] gating: when the island should stay dormant, feed it a "far away" cursor and let the same physics retract it
      if (S.edge) { if (S.my <= 5 && Math.abs(S.mx - cx) < 160) S.eng = true; else if (S.my > 70) S.eng = false; }
      const gate = S.off || (S.edge && !S.exp && !S.eng), mx = gate ? cx + 200 : S.mx, my = gate ? 420 : S.my;
      if (pk && !S.exp && !S.was) { S.snap = false; kick("dy", 140); kick("dh", -90); }   // jelly kick when a peek opens
      s.sx.t = mx; s.sy.t = my;
      let e = 0, q = 0;
      for (let n = 0; n < 2; n++) {
        const h = dt / 2, p = cl((280 - Math.hypot(s.sx.v - cx, s.sy.v - 34)) / 210, 0, 1);
        e = p * p * (3 - 2 * p); q = cl((e - .4) / .6, 0, 1);
        if (!S.exp && e > .8 && Math.hypot(mx - cx - s.dx.v, my - s.dy.v) < 30) { S.exp = true; S.snap = false; kick("dy", 140); kick("dh", -90); win.setIgnoreCursorEvents(false); $("card").style.pointerEvents = "auto"; }
        else if (S.exp && (Math.abs(mx - cx) > s.dw.t / 2 + 70 || my > s.dh.t + 80)) { S.exp = false; setB(false); win.setIgnoreCursorEvents(true); $("card").style.pointerEvents = "none"; }
        if (S.exp || pk) { s.dw.t = S.exp && S.big ? Math.max(w, 300) : w; s.dh.t = Math.max(40, ih); s.dx.t = s.ix.t = s.ar.t = 0; s.dy.t = 16 + s.dh.t / 2; }
        else {
          const f = cl((mx - cx) * .45, -55, 55) * q; s.dx.t = f; s.ix.t = f * .35;
          s.dy.t = q ** 1.4 * 42 + cl(Math.hypot(s.sx.x, s.sy.x) * .008, 0, 12) * q; s.dw.t = s.dh.t = q * 30; s.ar.t = 1.5 + e * 10 + (S.snap ? 0 : q * 6);
          const k = cl((s.dy.v - 10) / 26, 0, 1);               // neck stretch 0..1
          if (!S.snap && q > .85 && k > .9) { S.snap = true; kick("ar", -150); kick("dy", -230); kick("dw", 170); kick("dh", -170); } // surface-tension snap
          else if (S.snap && q < .7) { S.snap = false; kick("dy", -110); kick("ar", 80); }                                            // rejoin
        }
        if (S.cur !== S.want) { s.cf.t = 0; if (s.cf.v < .06) { S.cur = S.want; setShown(S.cur); s.cf.t = 1; } }
        for (const k of Object.keys(K) as Key[]) { const [st, c] = K[k], o = s[k]; o.x += (st * (o.t - o.v) - (RM ? c * 1.5 : c) * o.x) * h; o.v += o.x * h; }
      }
      S.was = S.exp || pk;
      // render straight to the DOM: React never re-renders per frame
      const X = cx + s.dx.v, pw = Math.max(0, s.dw.v), ph = Math.max(0, s.dh.v), k = cl((s.dy.v - 10) / 26, 0, 1);
      set("anc", { cx: cx + s.ix.v, rx: 72 - q * 28, ry: Math.max(0, s.ar.v) });
      set("drop", { x: X - pw / 2, y: s.dy.v - ph / 2, width: pw, height: ph, rx: Math.min(pw, ph) / 2 });
      set("neck", { x1: cx + s.ix.v, y1: 0, x2: X, y2: s.dy.v, "stroke-width": S.exp || pk || S.snap ? 0 : (22 * (1 - k) ** 1.5 + 2) * cl(q * 3, 0, 1) });
      const c = $("card").style;
      c.transform = `translate(${X - pw / 2}px,${s.dy.v - ph / 2}px)`; c.width = pw + "px"; c.height = ph + "px";
      c.borderRadius = Math.min(pw, ph) / 2 + "px"; c.opacity = String(cl((pw - 60) / 80, 0, 1));
      $("in").style.opacity = String(cl((pw - .75 * w) / 40, 0, 1) * s.cf.v);
      const moving = Object.values(s).some(o => Math.abs(o.x) > .05 || Math.abs(o.t - o.v) > .05);
      $("g").setAttribute("filter", moving ? "url(#goo)" : "none");   // blur filter only while morphing
      S.raf = moving || S.cur !== S.want ? requestAnimationFrame(tick) : 0; // loop sleeps at rest: ~0% CPU
    };
    S.wake = () => { if (!S.raf) { last = performance.now(); S.raf = requestAnimationFrame(tick); } };

    const un = [
      listen<[number, number]>("cursor", ({ payload: [x, y] }) => { const far = y > 9000; S.mx = far ? innerWidth / 2 + 200 : x; S.my = far ? 420 : y; S.wake(); }),
      listen<Act>("island:push", e => push(e.payload)),
      listen<string>("island:clear", e => setActs(l => l.filter(i => i.id !== e.payload))),
      listen<Fg>("island:fg", e => onFg(e.payload)),
      listen("island:reload", () => px.load()),   // emit("island:reload") after editing a plugin
    ];
    invoke<Fg | null>("fg_now").then(f => f && onFg(f)).catch(() => {});
    px.load();
    const t = setInterval(() => push(clock()), 30000);
    (navigator as any).getBattery?.().then((b: any) => { // Chromium webviews; native adapter covers macOS
      b.onchargingchange = () => b.charging && push({ id: "bat", pri: 5, icon: "⚡", title: Math.round(b.level * 100) + "%", side: "Charging", p: b.level, color: "#30d158", w: 170, ttl: 6000 });
    });
    return () => { un.forEach(p => p.then(f => f())); px.dispose(); clearInterval(t); cancelAnimationFrame(S.raf); };
  }, []);

  useEffect(() => {
    S.want = acts.filter(ok).reduce((x, y) => (y.pri >= x.pri ? y : x));   // [drip] `when` rules filter first; clock never has one
    if (S.cur.id === S.want.id) { S.cur = S.want; setShown(S.want); }   // same activity updated: no crossfade
    S.wake();
  }, [acts, ver]);

  const w = a.w ?? 200;
  return (
    <>
      <svg style={{ position: "fixed", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}>
        <defs>
          <filter id="goo" filterUnits="userSpaceOnUse" x="-100" y="-60" width="2000" height="500" colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation="7" />
            <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10" />
          </filter>
        </defs>
        <g id="g" fill="#000" stroke="#000" strokeWidth="0" strokeLinecap="round">
          <rect x="-100" y="-60" width="2000" height="60" stroke="none" />
          <ellipse id="anc" cy="0" rx="70" ry="2" stroke="none" />
          <line id="neck" />
          <rect id="drop" stroke="none" />
        </g>
      </svg>
      {/* [drip] pointer-events is now driven from tick() (the old render-time value could be stale on the first click); rim light takes the app accent */}
      <div id="card" onClick={() => setB(!S.big)} style={{ position: "fixed", top: 0, left: 0, overflow: "hidden", opacity: 0, color: "#fff", boxShadow: `inset 0 1px 0 color-mix(in srgb, ${a.color ?? "#fff"} 20%, transparent)`, font: "600 20px -apple-system,'SF Pro Display',system-ui,sans-serif", pointerEvents: "none" }}>
        <div id="in" style={{ position: "absolute", left: "50%", translate: "-50% 0", width: big ? Math.max(w, 300) : w, padding: "0 18px 14px", boxSizing: "border-box" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, height: 40 }}>
            <span style={{ fontSize: 20 }}>{a.icon}</span><b style={{ flex: 1, fontWeight: 600 }}>{a.title}</b>
            <small style={{ color: "#98989d", font: "13px system-ui" }}>{a.side}</small>
          </div>
          {a.sub && <div style={{ font: "500 14px system-ui", marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.sub}</div>}
          {a.p != null && <div style={{ height: 4, borderRadius: 2, background: "#fff3", marginTop: 12 }}><div style={{ height: "100%", width: a.p * 100 + "%", borderRadius: 2, background: a.color ?? "#fff" }} /></div>}
          {a.actions && <div style={{ display: "flex", gap: 8, marginTop: 12 }}>{a.actions.map(x =>
            <button key={x} onClick={e => { e.stopPropagation(); emit("island:action", { id: a.id, action: x }); S.px?.action(a.id, x); }} style={{ flex: 1, border: 0, borderRadius: 14, padding: "6px 0", background: "#fff2", color: "#fff", font: "500 13px system-ui" }}>{x}</button>)}</div>}
        </div>
      </div>
    </>
  );
}
