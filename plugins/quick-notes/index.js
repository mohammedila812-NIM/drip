// Quick Scratchpad: Ambient reminders, quick tips, and productivity cues
const NOTES = [
  "Hydrate: Drink a fresh glass of water",
  "Posture check: Relax shoulders & stretch spine",
  "Review active Git branch & uncommitted changes",
  "Single-task: Finish the current objective first"
];
let idx = 0;

function show() {
  drip.push({
    id: "note",
    pri: 3,
    icon: "doc",
    title: "Scratchpad",
    side: (idx + 1) + "/" + NOTES.length,
    sub: NOTES[idx],
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
