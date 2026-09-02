import { describe, expect, it } from "vitest";

import {
  appendConfirmedShot,
  deduplicateShotCandidates,
  nextShotNumber,
  setColdBoreShot,
  setShotFlyer,
  shotsIncludedInGroup,
  type ConfirmShotInput,
  type Shot,
  type ShotGroup,
} from "../index";

function input(id: string, x = 0, y = 0): ConfirmShotInput {
  return {
    id,
    sessionId: "session-1",
    targetId: "target-1",
    position: { x, y },
    confirmedAt: "2026-08-30T12:00:00.000Z",
    baselineRevision: 1,
    source: "automatic",
    confidence: 0.9,
  };
}

describe("automatic immutable shot numbering", () => {
  it("starts at one, marks the first cold bore, and never mutates prior arrays", () => {
    const empty = Object.freeze([]) as readonly Shot[];
    const first = appendConfirmedShot(empty, input("shot-a"));
    const second = appendConfirmedShot(first.shots, input("shot-b"));

    expect(first.shot.number).toBe(1);
    expect(first.shot.isColdBore).toBe(true);
    expect(second.shot.number).toBe(2);
    expect(second.shot.isColdBore).toBe(false);
    expect(first.shots).toHaveLength(1);
    expect(Object.isFrozen(first.shot)).toBe(true);
    expect(Object.isFrozen(first.shot.position)).toBe(true);
    expect(Object.isFrozen(second.shots)).toBe(true);
  });

  it("uses max+1 after deletion instead of reusing a number", () => {
    const first = appendConfirmedShot([], input("shot-a"));
    const second = appendConfirmedShot(first.shots, input("shot-b"));

    expect(nextShotNumber([second.shot])).toBe(3);
  });

  it("rejects duplicate or invalid persisted numbers", () => {
    expect(() => nextShotNumber([{ number: 1 }, { number: 1 }])).toThrow(
      "Duplicate shot number",
    );
    expect(() => nextShotNumber([{ number: 0 }])).toThrow(
      "positive integers",
    );
  });
});

describe("shot flags and groups", () => {
  it("toggles flyer and cold-bore markers without renumbering", () => {
    const first = appendConfirmedShot([], input("shot-a"));
    const second = appendConfirmedShot(first.shots, input("shot-b"));
    const flyers = setShotFlyer(second.shots, "shot-b", true);
    const coldBore = setColdBoreShot(flyers, "shot-b");

    expect(flyers.map((shot) => shot.number)).toEqual([1, 2]);
    expect(flyers[1].isFlyer).toBe(true);
    expect(coldBore.map((shot) => shot.isColdBore)).toEqual([false, true]);
    expect(second.shots[1].isFlyer).toBe(false);
  });

  it("supports global and per-group flyer exclusion", () => {
    const first = appendConfirmedShot([], input("shot-a"));
    const second = appendConfirmedShot(first.shots, input("shot-b"));
    const third = appendConfirmedShot(second.shots, input("shot-c"));
    const shots = setShotFlyer(third.shots, "shot-b", true);
    const group: ShotGroup = {
      id: "group-a",
      sessionId: "session-1",
      targetId: "target-1",
      label: "Load A",
      members: [
        { shotId: "shot-a", excludeFromStatistics: false },
        { shotId: "shot-b", excludeFromStatistics: false },
        { shotId: "shot-c", excludeFromStatistics: true },
      ],
      createdAt: "2026-08-30T12:00:00.000Z",
      updatedAt: "2026-08-30T12:00:00.000Z",
    };

    expect(shotsIncludedInGroup(group, shots).map((shot) => shot.id)).toEqual([
      "shot-a",
    ]);
    expect(
      shotsIncludedInGroup(group, shots, true).map((shot) => shot.id),
    ).toEqual(["shot-a", "shot-b", "shot-c"]);
  });
});

describe("shot candidate deduplication", () => {
  it("rejects known holes and keeps the highest-confidence nearby candidate", () => {
    const candidates = Object.freeze([
      { id: "known-again", position: { x: 3, y: 4 }, confidence: 0.99 },
      { id: "cluster-low", position: { x: 100, y: 100 }, confidence: 0.4 },
      { id: "cluster-high", position: { x: 102, y: 101 }, confidence: 0.9 },
      { id: "separate", position: { x: 300, y: 300 }, confidence: 0.8 },
    ]);
    const result = deduplicateShotCandidates(
      candidates,
      [{ id: "shot-1", position: { x: 0, y: 0 } }],
      5,
    );

    expect(result.accepted.map((candidate) => candidate.id)).toEqual([
      "cluster-high",
      "separate",
    ]);
    expect(result.duplicates).toEqual([
      expect.objectContaining({
        candidate: candidates[0],
        matchedKnownShotId: "shot-1",
        distancePixels: 5,
      }),
      expect.objectContaining({
        candidate: candidates[1],
        matchedCandidateId: "cluster-high",
      }),
    ]);
    expect(candidates.map((candidate) => candidate.id)).toEqual([
      "known-again",
      "cluster-low",
      "cluster-high",
      "separate",
    ]);
    expect(Object.isFrozen(result.accepted)).toBe(true);
  });

  it("treats exact matches as duplicates when the radius is zero", () => {
    const result = deduplicateShotCandidates(
      [{ id: "candidate", position: { x: 10, y: 20 } }],
      [{ id: "known", position: { x: 10, y: 20 } }],
      0,
    );

    expect(result.accepted).toHaveLength(0);
    expect(result.duplicates[0].matchedKnownShotId).toBe("known");
  });
});

