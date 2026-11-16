import { describe, it, expect } from "vitest";
import { ActStore } from "../lib/acts";
import type { Act } from "../App";

describe("Act storage and stable selection (B6)", () => {
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
});
