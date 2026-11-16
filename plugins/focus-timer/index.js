// Contextual pomodoro: offers itself only while an editor / terminal is in front (`when`), then counts down on the island.
const LEN = 25 * 60;
let end = 0;
const mmss = s => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");

drip.push({ id: "offer", pri: 2, icon: "clock", title: "Focus?", side: "25 min", actions: ["Start"], when: { app: "^(code|devenv|idea64|windowsterminal)$" } });

drip.on("action", ({ id, action }) => {
  if (action === "Start") { end = Date.now() + LEN * 1000; drip.clear("offer"); }
  if (action === "Stop")  { end = 0; drip.clear("run"); drip.push({ id: "offer", pri: 2, icon: "clock", title: "Focus?", side: "25 min", actions: ["Start"], when: { app: "^(code|devenv|idea64|windowsterminal)$" } }); }
});

drip.every(1000, () => {
  if (!end) return;
  const s = Math.max(0, Math.round((end - Date.now()) / 1000));
  if (s === 0) { end = 0; drip.clear("run"); drip.push({ id: "done", pri: 8, icon: "clock", title: "Break time", side: "Focus done", ttl: 8000, peek: 5000 }); return; }
  drip.push({ id: "run", pri: 4, icon: "clock", title: mmss(s), side: "Focus", p: 1 - s / LEN, color: "#ff453a", w: 190, actions: ["Stop"] });
});
