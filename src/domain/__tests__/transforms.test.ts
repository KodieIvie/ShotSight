import { describe, expect, it } from "vitest";

import {
  composeTransforms,
  invertTransform,
  mapPoint,
  mapPointThroughTransform,
  type CoordinateTransform,
  type Matrix3x3,
} from "../index";

describe("coordinate transform mapping", () => {
  it("maps affine translation and scale", () => {
    const matrix: Matrix3x3 = [
      2, 0, 10,
      0, 3, -5,
      0, 0, 1,
    ];

    expect(mapPoint({ x: 4, y: 5 }, matrix)).toEqual({ x: 18, y: 10 });
  });

  it("performs homogeneous perspective division", () => {
    const matrix: Matrix3x3 = [
      1, 0, 0,
      0, 1, 0,
      0.01, 0, 1,
    ];

    expect(mapPoint({ x: 100, y: 50 }, matrix)).toEqual({ x: 50, y: 25 });
  });

  it("composes coordinate spaces in application order", () => {
    const sourceToRegistered: CoordinateTransform = {
      sourceSpace: "source",
      destinationSpace: "registered",
      matrix: [
        1, 0, 10,
        0, 1, 20,
        0, 0, 1,
      ],
      confidence: 0.9,
    };
    const registeredToTarget: CoordinateTransform = {
      sourceSpace: "registered",
      destinationSpace: "target",
      matrix: [
        2, 0, 0,
        0, 2, 0,
        0, 0, 1,
      ],
      confidence: 0.8,
    };

    const composed = composeTransforms(sourceToRegistered, registeredToTarget);

    expect(mapPointThroughTransform({ x: 1, y: 2 }, composed)).toEqual({
      x: 22,
      y: 44,
    });
    expect(composed.sourceSpace).toBe("source");
    expect(composed.destinationSpace).toBe("target");
    expect(composed.confidence).toBe(0.8);
  });

  it("round-trips an affine transform through its inverse", () => {
    const transform: CoordinateTransform = {
      sourceSpace: "camera",
      destinationSpace: "target",
      matrix: [
        1.2, 0.1, 20,
        -0.2, 0.9, -4,
        0, 0, 1,
      ],
    };
    const mapped = mapPointThroughTransform({ x: 25, y: 40 }, transform);
    const restored = mapPointThroughTransform(mapped, invertTransform(transform));

    expect(restored.x).toBeCloseTo(25, 12);
    expect(restored.y).toBeCloseTo(40, 12);
  });

  it("rejects a point mapped to infinity", () => {
    expect(() =>
      mapPoint(
        { x: 1, y: 0 },
        [
          1, 0, 0,
          0, 1, 0,
          1, 0, -1,
        ],
      ),
    ).toThrow("maps to infinity");
  });
});

