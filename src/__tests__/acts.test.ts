import { describe, it, expect } from "vitest";
import { ActStore, isActShallowEqual } from "../lib/acts";
import type { Act } from "../App";

describe("Act storage and stable selection (B6 / 2.4)", () => {
  it("keeps position on update (replace in place) and breaks ties by first-seen index", () => {
    const store = new ActStore();
    const fallback: Act = { id: "clock", pri: 0, title: "12:00" };

    const actA: Act = { id: "act-a", pri: 2, title: "Task A" };
    const actB: Act = { id: "act-b", pri: 2, title: "Task B" };
    const actC: Act = { id: "act-c", pri: 2, title: "Task C" };

    store.upsert(actA);
    store.upsert(actB);
    store.upsert(actC);

    // Initial order check
    const initialOrder = store.getActs().map((a) => a.id);
    expect(initialOrder).toEqual(["act-a", "act-b", "act-c"]);

    // Tie-break: all pri=2, act-a was first-seen, so act-a should be selected
    const initialSelected = store.select(() => true, null, fallback);
    expect(initialSelected.id).toBe("act-a");

    // 10 simulated 1 Hz updates to act-b (updating title, sub, etc.)
    for (let i = 1; i <= 10; i++) {
      store.upsert({ ...actB, title: `Task B update ${i}` });

      // Array position MUST remain identical
      const currentOrder = store.getActs().map((a) => a.id);
      expect(currentOrder).toEqual(["act-a", "act-b", "act-c"]);

      // Selected act MUST remain act-a (not act-b simply because act-b was updated recently)
      const currentSelected = store.select(() => true, null, fallback);
      expect(currentSelected.id).toBe("act-a");
    }
  });

  it("selects higher priority when available", () => {
    const store = new ActStore();
    const fallback: Act = { id: "clock", pri: 0, title: "12:00" };

    store.upsert({ id: "low", pri: 1, title: "Low" });
    store.upsert({ id: "high", pri: 5, title: "High" });

    expect(store.select(() => true, null, fallback).id).toBe("high");
  });

  it("honors pinnedId regardless of priority", () => {
    const store = new ActStore();
    const fallback: Act = { id: "clock", pri: 0, title: "12:00" };

    store.upsert({ id: "low", pri: 1, title: "Low" });
    store.upsert({ id: "high", pri: 5, title: "High" });

    expect(store.select(() => true, "low", fallback).id).toBe("low");
  });

  it("getActs() returns a copy that does not mutate store state", () => {
    const store = new ActStore();
    store.upsert({ id: "a1", pri: 1, title: "One" });
    const copy = store.getActs();
    copy.push({ id: "a2", pri: 2, title: "Two" });
    expect(store.getActs().length).toBe(1);
    expect(store.getActs()[0].id).toBe("a1");
  });

  it("upsert returns changed=false when new act is shallow-equal, changed=true when modified", () => {
    const store = new ActStore();
    const act1: Act = {
      id: "timer",
      pri: 3,
      title: "Focus",
      side: "25:00",
      actions: ["Pause", "Stop"],
      when: { app: "code" },
    };

    // First insertion is changed=true
    const res1 = store.upsert(act1);
    expect(res1.changed).toBe(true);
    expect(res1.acts.length).toBe(1);

    // Identical act returns changed=false
    const res2 = store.upsert({
      id: "timer",
      pri: 3,
      title: "Focus",
      side: "25:00",
      actions: ["Pause", "Stop"],
      when: { app: "code" },
    });
    expect(res2.changed).toBe(false);

    // Modified property returns changed=true
    const res3 = store.upsert({
      ...act1,
      side: "24:59",
    });
    expect(res3.changed).toBe(true);
  });

  it("isActShallowEqual compares all fields accurately", () => {
    const base: Act = {
      id: "test",
      pri: 1,
      title: "T",
      side: "S",
      icon: "I",
      sub: "Sub",
      p: 0.5,
      color: "#ffffff",
      w: 200,
      ttl: 5000,
      peek: 2000,
      actions: ["A", "B"],
      when: { app: "app.exe" },
    };

    expect(isActShallowEqual(base, { ...base })).toBe(true);
    expect(isActShallowEqual(base, { ...base, title: "Diff" })).toBe(false);
    expect(isActShallowEqual(base, { ...base, actions: ["A", "C"] })).toBe(false);
    expect(isActShallowEqual(base, { ...base, actions: undefined })).toBe(false);
    expect(isActShallowEqual(base, { ...base, when: { app: "other.exe" } })).toBe(false);
  });
});
