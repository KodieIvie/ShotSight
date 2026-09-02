import { describe, expect, it } from "vitest";

import {
  createCameraProfile,
  createKnownLineCalibration,
  createKnownRectangleCalibration,
  createManualCalibration,
  createTarget,
  establishTargetBaseline,
  pixelDistanceToInches,
  type NewCameraProfile,
  type Target,
} from "../index";

const identity = {
  id: "calibration-1",
  targetId: "target-1",
  calibratedAt: "2026-08-30T12:00:00.000Z",
};

describe("target calibration", () => {
  it("creates a known-line scale", () => {
    const calibration = createKnownLineCalibration(
      identity,
      { x: 0, y: 0 },
      { x: 300, y: 400 },
      10,
    );

    expect(calibration.pixelsPerInchX).toBe(50);
    expect(calibration.pixelsPerInchY).toBe(50);
    expect(
      pixelDistanceToInches(
        { x: 0, y: 0 },
        { x: 150, y: 200 },
        calibration,
      ),
    ).toBe(5);
  });

  it("averages opposite rectangle edges for independent X/Y scales", () => {
    const calibration = createKnownRectangleCalibration(identity, {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 200, y: 0 },
      bottomRight: { x: 220, y: 100 },
      bottomLeft: { x: 20, y: 100 },
      knownWidthInches: 10,
      knownHeightInches: 5,
    });

    expect(calibration.pixelsPerInchX).toBe(20);
    expect(calibration.pixelsPerInchY).toBeCloseTo(Math.hypot(20, 100) / 5, 12);
  });

  it("rejects zero and negative scale inputs", () => {
    expect(() => createManualCalibration(identity, 0)).toThrow(
      "pixelsPerInchX",
    );
    expect(() =>
      createKnownLineCalibration(identity, { x: 1, y: 1 }, { x: 1, y: 1 }, 2),
    ).toThrow("pixelLength");
  });
});

describe("target baseline reset", () => {
  it("creates a clean named target without inheriting another target's geometry", () => {
    const target = createTarget({
      id: "target-2",
      sessionId: "session-1",
      name: "  Load B target  ",
      type: "paper",
      createdAt: "2026-08-30T12:00:00.000Z",
    });

    expect(target).toEqual({
      id: "target-2",
      sessionId: "session-1",
      name: "Load B target",
      type: "paper",
      createdAt: "2026-08-30T12:00:00.000Z",
      updatedAt: "2026-08-30T12:00:00.000Z",
    });
    expect(target.baseline).toBeUndefined();
    expect(target.calibration).toBeUndefined();
    expect(Object.isFrozen(target)).toBe(true);
  });

  it("requires a usable target name", () => {
    expect(() => createTarget({
      id: "target-2",
      sessionId: "session-1",
      name: "   ",
      type: "paper",
      createdAt: "2026-08-30T12:00:00.000Z",
    })).toThrow("Target name is required");
  });

  it("advances revisions without replacing the session target", () => {
    const target: Target = {
      id: "target-1",
      sessionId: "session-1",
      name: "Bench target",
      type: "paper",
      roi: {
        kind: "rectangle",
        rect: { x: 10, y: 20, width: 100, height: 200 },
      },
      calibration: {
        id: "calibration-1",
        targetId: "target-1",
        calibratedAt: "2026-08-30T12:00:00.000Z",
        kind: "manual",
        pixelsPerInchX: 100,
        pixelsPerInchY: 100,
      },
      pointOfAim: { x: 40, y: 50 },
      desiredZeroPoint: { x: 45, y: 55 },
      createdAt: "2026-08-30T12:00:00.000Z",
      updatedAt: "2026-08-30T12:00:00.000Z",
    };
    const first = establishTargetBaseline(target, {
      captureId: "capture-1",
      establishedAt: "2026-08-30T12:01:00.000Z",
    });
    const reset = establishTargetBaseline(first, {
      captureId: "capture-10",
      establishedAt: "2026-08-30T13:00:00.000Z",
    });

    expect(first.baseline).toMatchObject({ revision: 1, reason: "initial" });
    expect(first.roi).toEqual(target.roi);
    expect(first.calibration).toEqual(target.calibration);
    expect(first.pointOfAim).toEqual(target.pointOfAim);
    expect(first.desiredZeroPoint).toEqual(target.desiredZeroPoint);
    expect(reset.baseline).toMatchObject({
      revision: 2,
      reason: "target-reset",
      captureId: "capture-10",
    });
    expect(reset.sessionId).toBe("session-1");
    expect(reset.roi).toBeUndefined();
    expect(reset.calibration).toBeUndefined();
    expect(reset.pointOfAim).toBeUndefined();
    expect(reset.desiredZeroPoint).toBeUndefined();
    expect(target.baseline).toBeUndefined();
  });

  it("rejects a baseline reason that cannot match the next revision", () => {
    const first = establishTargetBaseline({
      id: "target-1",
      sessionId: "session-1",
      name: "Bench target",
      type: "paper",
      createdAt: "2026-08-30T12:00:00.000Z",
      updatedAt: "2026-08-30T12:00:00.000Z",
    }, {
      captureId: "capture-1",
      establishedAt: "2026-08-30T12:01:00.000Z",
    });

    expect(() => establishTargetBaseline(first, {
      captureId: "capture-2",
      establishedAt: "2026-08-30T12:02:00.000Z",
      reason: "initial",
    })).toThrow("Baseline revision 2 must use reason target-reset");
  });
});

describe("credential-safe camera profiles", () => {
  function validInput(): NewCameraProfile {
    return {
      id: "camera-1",
      name: "Target Camera",
      host: "192.168.10.20",
      username: "admin",
      credentialRef: "secure-store://camera-1",
      streams: {
        mainRtspUrl: "rtsp://192.168.10.20:554/main",
        snapshotUrl: "http://192.168.10.20/snapshot.jpg",
      },
      onvif: { enabled: true, port: 8000 },
      preferredStream: "main",
      preferredStillSource: "http-snapshot",
      capabilities: { rtsp: true, httpSnapshot: true, onvif: true },
    };
  }

  it("stores only the secure-storage reference", () => {
    const profile = createCameraProfile(
      validInput(),
      "2026-08-30T12:00:00.000Z",
    );

    expect(profile.credentialRef).toBe("secure-store://camera-1");
    expect("password" in profile).toBe(false);
    expect(Object.isFrozen(profile)).toBe(true);
  });

  it("accepts and freezes an HTTPS ONVIF protocol", () => {
    const profile = createCameraProfile({
      ...validInput(),
      onvif: { enabled: true, port: 8443, protocol: "https" },
    });

    expect(profile.onvif.protocol).toBe("https");
    expect(Object.isFrozen(profile.onvif)).toBe(true);
  });

  it("rejects an unsupported ONVIF protocol", () => {
    const invalid = {
      ...validInput(),
      onvif: { enabled: true, protocol: "ftp" },
    } as unknown as NewCameraProfile;

    expect(() => createCameraProfile(invalid)).toThrow("ONVIF protocol must be http or https");
  });

  it("rejects embedded and query-string secrets", () => {
    expect(() =>
      createCameraProfile({
        ...validInput(),
        streams: {
          ...validInput().streams,
          mainRtspUrl: "rtsp://admin:secret@192.168.10.20/main",
        },
      }),
    ).toThrow("embedded credentials");

    expect(() =>
      createCameraProfile({
        ...validInput(),
        streams: {
          ...validInput().streams,
          snapshotUrl: "http://192.168.10.20/snap?password=secret",
        },
      }),
    ).toThrow("plaintext secret");
  });

  it("rejects encoded credential-style query keys while allowing Reolink command parameters", () => {
    expect(() =>
      createCameraProfile({
        ...validInput(),
        streams: {
          ...validInput().streams,
          snapshotUrl:
            "http://192.168.10.20/cgi-bin/api.cgi?cmd=Snap&channel=0",
        },
      }),
    ).not.toThrow();

    const secretQueries = [
      "access_key=private",
      "clientKey=private",
      "api-key=private",
      "X-Amz-Signature=private",
      "sig=private",
      "sigv4=private",
      "sid=private",
      "session_id=private",
      "cookie=private",
      "jwt=private",
      "bearer_token=private",
      "%74oken=private",
      "%2561pi%255fkey=private",
      "cmd=Snap%26session%3Dprivate",
    ];

    for (const query of secretQueries) {
      expect(() =>
        createCameraProfile({
          ...validInput(),
          streams: {
            ...validInput().streams,
            snapshotUrl: `http://192.168.10.20/snapshot?${query}`,
          },
        }),
      ).toThrow("plaintext secret");
    }
  });

  it("rejects a runtime password property even if a caller bypasses TypeScript", () => {
    const unsafe = {
      ...validInput(),
      password: "should-never-be-here",
    } as NewCameraProfile;

    expect(() => createCameraProfile(unsafe)).toThrow("plaintext password");
  });
});
