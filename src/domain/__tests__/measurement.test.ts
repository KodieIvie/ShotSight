import { describe, expect, it } from "vitest";

import {
  calculateCenterToCenter,
  calculateExtremeSpread,
  calculatePoaPoiOffset,
  linearInchesToMil,
  linearInchesToMoa,
  measureShotGroup,
  milToLinearInches,
  moaToLinearInches,
  type Shot,
} from "../index";

function makeShot(
  id: string,
  x: number,
  y: number,
  isFlyer = false,
): Shot {
  return Object.freeze({
    id,
    sessionId: "session-1",
    targetId: "target-1",
    number: Number(id.replace(/\D/g, "")) || 1,
    position: Object.freeze({ x, y }),
    confirmedAt: "2026-08-30T12:00:00.000Z",
    baselineRevision: 1,
    source: "manual",
    isColdBore: id === "shot-1",
    isFlyer,
  });
}

describe("angular measurement", () => {
  it("uses exact trigonometry for MOA and round-trips one MOA", () => {
    const oneMoaAt100Yards = moaToLinearInches(1, 100);

    expect(oneMoaAt100Yards).toBeCloseTo(1.04719756, 7);
    expect(linearInchesToMoa(oneMoaAt100Yards, 100)).toBeCloseTo(1, 12);
  });

  it("uses true milliradians and round-trips one mil", () => {
    const oneMilAt100Yards = milToLinearInches(1, 100);

    expect(oneMilAt100Yards).toBeCloseTo(3.6000012, 6);
    expect(linearInchesToMil(oneMilAt100Yards, 100)).toBeCloseTo(1, 12);
  });

  it("preserves signs for directional offsets", () => {
    expect(linearInchesToMoa(-2, 200)).toBeLessThan(0);
    expect(linearInchesToMil(-2, 200)).toBeLessThan(0);
  });
});

describe("group measurement", () => {
  it("finds extreme spread without changing the point list", () => {
    const points = Object.freeze([
      Object.freeze({ x: 0, y: 0 }),
      Object.freeze({ x: 3, y: 4 }),
      Object.freeze({ x: 1, y: 1 }),
    ]);

    expect(calculateExtremeSpread(points)).toEqual({
      distance: 5,
      pointIndexes: [0, 1],
    });
  });

  it("subtracts bullet diameter for caliper center-to-center measurements", () => {
    expect(calculateCenterToCenter(1.308, 0.308)).toBeCloseTo(1, 12);
    expect(calculateCenterToCenter(0.2, 0.308)).toBe(0);
  });

  it("measures physical distance with anisotropic calibration and excludes flyers", () => {
    const shots = [
      makeShot("shot-1", 0, 0),
      makeShot("shot-2", 300, 800),
      makeShot("shot-3", 5_000, 5_000, true),
    ];

    const result = measureShotGroup(
      shots,
      { pixelsPerInchX: 100, pixelsPerInchY: 200 },
      100,
      { bulletDiameterInches: 0.308 },
    );

    expect(result.shotCount).toBe(2);
    expect(result.includedShotIds).toEqual(["shot-1", "shot-2"]);
    expect(result.centerToCenterInches).toBe(5);
    expect(result.outerEdgeToEdgeInches).toBeCloseTo(5.308, 12);
    expect(result.extremeSpreadPixels).toBeCloseTo(Math.hypot(300, 800), 12);
    expect(result.farthestShotIds).toEqual(["shot-1", "shot-2"]);
    expect(result.moa).toBeCloseTo(linearInchesToMoa(5, 100), 12);
    expect(result.mil).toBeCloseTo(linearInchesToMil(5, 100), 12);
  });

  it("returns a zero spread for a one-shot group", () => {
    const result = measureShotGroup(
      [makeShot("shot-1", 100, 100)],
      { pixelsPerInchX: 100, pixelsPerInchY: 100 },
      100,
    );

    expect(result.centerToCenterInches).toBe(0);
    expect(result.extremeSpreadPixels).toBe(0);
    expect(result.groupCenter).toEqual({ x: 100, y: 100 });
    expect(result.farthestShotIds).toBeNull();
  });
});

describe("POA/POI offsets", () => {
  it("reports right/high POI and equal-opposite correction", () => {
    const result = calculatePoaPoiOffset(
      [
        makeShot("shot-1", 1_100, 900),
        makeShot("shot-2", 1_200, 800),
      ],
      { x: 1_000, y: 1_000 },
      { pixelsPerInchX: 100, pixelsPerInchY: 100 },
      100,
    );

    expect(result.pointOfImpact).toEqual({ x: 1_150, y: 850 });
    expect(result.horizontalDirection).toBe("right");
    expect(result.verticalDirection).toBe("high");
    expect(result.poiRelativeToPoa.horizontalInches).toBe(1.5);
    expect(result.poiRelativeToPoa.verticalInches).toBe(1.5);
    expect(result.correctionToPoa.horizontalInches).toBe(-1.5);
    expect(result.correctionToPoa.verticalInches).toBe(-1.5);
    expect(result.poiRelativeToPoa.horizontalMoa).toBeCloseTo(
      linearInchesToMoa(1.5, 100),
      12,
    );
  });

  it("requires at least one non-flyer", () => {
    expect(() =>
      calculatePoaPoiOffset(
        [makeShot("shot-1", 0, 0, true)],
        { x: 0, y: 0 },
        { pixelsPerInchX: 100, pixelsPerInchY: 100 },
        100,
      ),
    ).toThrow("At least one included shot");
  });
});

