import { describe, expect, it } from "vitest";

import {
  OFFLINE_TARGET_SYSTEM_PAIRING_PREFIX,
  TargetSystemPairingError,
  UnsupportedTargetSystemPairingVersionError,
  encodeOfflineTargetSystemPairingPayload,
  parseOfflineTargetSystemPairingPayload,
  validateOfflineTargetSystemPairingPayload,
} from "../targetSystem";

const pairing = {
  kind: "target-system" as const,
  version: 1 as const,
  systemId: "range-cam-01",
  label: "100 Yard Target",
  camera: {
    host: "192.168.50.20",
    rtspPort: 554,
    onvifPort: 8000,
    mainRtspPath: "/h264Preview_01_main",
    snapshotPath: "/cgi-bin/api.cgi?cmd=Snap&channel=0",
    manufacturer: "Reolink",
    model: "RLC-520A",
  },
  radio: {
    transport: "ble" as const,
    deviceId: "AA:BB:CC:DD:EE:FF",
    serviceUuid: "7f4b1e1d-3d41-41a9-bd90-6b2c7b18c9f1",
  },
};

describe("offline target-system pairing payload", () => {
  it("round-trips a safe versioned pairing payload", () => {
    const encoded = encodeOfflineTargetSystemPairingPayload(pairing);
    const decoded = parseOfflineTargetSystemPairingPayload(encoded);

    expect(encoded.startsWith(OFFLINE_TARGET_SYSTEM_PAIRING_PREFIX)).toBe(true);
    expect(decoded).toEqual(pairing);
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.camera)).toBe(true);
    expect(Object.isFrozen(decoded.radio)).toBe(true);
  });

  it("allows non-secret camera query parameters but rejects embedded credentials", () => {
    expect(() => validateOfflineTargetSystemPairingPayload({
      ...pairing,
      camera: { ...pairing.camera, host: "operator:secret@192.168.50.20" },
    })).toThrow("without a port or credentials");

    expect(() => validateOfflineTargetSystemPairingPayload({
      ...pairing,
      camera: { ...pairing.camera, snapshotPath: "/snapshot?api_key=private" },
    })).toThrow("secret query parameters");
  });

  it("accepts only explicitly local camera hosts", () => {
    const localHosts = [
      "10.3.4.5",
      "172.16.4.5",
      "172.31.255.254",
      "192.168.50.20",
      "127.0.0.1",
      "169.254.20.30",
      "localhost",
      "range-camera",
      "range-camera.local",
      "range-camera.home.arpa",
      "[::1]",
      "[0000:0000:0000:0000:0000:0000:0000:0001]",
      "[fd12:3456:789a::10]",
      "[fe80::10]",
    ];

    for (const host of localHosts) {
      expect(() => validateOfflineTargetSystemPairingPayload({
        ...pairing,
        camera: { ...pairing.camera, host },
      })).not.toThrow();
    }

    const nonLocalHosts = [
      "8.8.8.8",
      "172.15.4.5",
      "172.32.4.5",
      "192.169.50.20",
      "300.168.50.20",
      "camera.example.com",
      "localhost.example.com",
      "[2001:db8::10]",
      "[2001:4860:4860::8888]",
      "[:::1]",
    ];

    for (const host of nonLocalHosts) {
      expect(() => validateOfflineTargetSystemPairingPayload({
        ...pairing,
        camera: { ...pairing.camera, host },
      })).toThrow(TargetSystemPairingError);
    }
  });

  it("rejects signatures, session material, cookies, JWTs, and credential-style query keys", () => {
    const secretQueryPaths = [
      "/snapshot?signature=private",
      "/snapshot?X-Amz-Signature=private",
      "/snapshot?sig=private",
      "/snapshot?sid=private",
      "/snapshot?session_id=private",
      "/snapshot?cookie=private",
      "/snapshot?jwt=private",
      "/snapshot?access_key=private",
      "/snapshot?clientSecret=private",
      "/snapshot?key=private",
      "/snapshot?cmd=Snap;token=private",
      "/snapshot?s%2569g=private",
    ];

    for (const snapshotPath of secretQueryPaths) {
      expect(() => validateOfflineTargetSystemPairingPayload({
        ...pairing,
        camera: { ...pairing.camera, snapshotPath },
      })).toThrow("secret query parameters");
    }

    expect(() => validateOfflineTargetSystemPairingPayload({
      ...pairing,
      camera: {
        ...pairing.camera,
        snapshotPath: "/cgi-bin/api.cgi?cmd=Snap&channel=0",
      },
    })).not.toThrow();
  });

  it("rejects credential fields anywhere in the untrusted payload", () => {
    expect(() => validateOfflineTargetSystemPairingPayload({
      ...pairing,
      password: "do-not-encode-this",
    })).toThrow(TargetSystemPairingError);
    expect(() => validateOfflineTargetSystemPairingPayload({
      ...pairing,
      camera: { ...pairing.camera, credentialRef: "not-for-qr" },
    })).toThrow("credentialRef");
    expect(() => validateOfflineTargetSystemPairingPayload({
      ...pairing,
      radio: { ...pairing.radio, username: "admin" },
    })).toThrow("username");
    expect(() => validateOfflineTargetSystemPairingPayload({
      ...pairing,
      signature: "do-not-encode-this",
    })).toThrow("signature");
    expect(() => validateOfflineTargetSystemPairingPayload({
      ...pairing,
      targetSystem: { accessKey: "do-not-encode-this" },
    })).toThrow("accessKey");

    const encodedWithSecret = `${OFFLINE_TARGET_SYSTEM_PAIRING_PREFIX}${encodeURIComponent(JSON.stringify({
      ...pairing,
      camera: { ...pairing.camera, password: "do-not-encode-this" },
    }))}`;
    expect(() => parseOfflineTargetSystemPairingPayload(encodedWithSecret)).toThrow("password");
  });

  it("rejects unknown fields and malformed local endpoint configuration", () => {
    expect(() => validateOfflineTargetSystemPairingPayload({
      ...pairing,
      futureConfig: true,
    })).toThrow("not supported");
    expect(() => validateOfflineTargetSystemPairingPayload({
      ...pairing,
      camera: { ...pairing.camera, rtspPort: 0 },
    })).toThrow("1 through 65535");
    expect(() => validateOfflineTargetSystemPairingPayload({
      ...pairing,
      camera: { ...pairing.camera, mainRtspPath: "rtsp://camera/stream" },
    })).toThrow("absolute local path");
  });

  it("refuses malformed and unsupported QR payloads", () => {
    expect(() => parseOfflineTargetSystemPairingPayload("https://example.test/pair")).toThrow(
      "not a ShotSight",
    );
    expect(() => parseOfflineTargetSystemPairingPayload("shotsight:pair:v2:%7B%7D")).toThrow(
      UnsupportedTargetSystemPairingVersionError,
    );
    expect(() => parseOfflineTargetSystemPairingPayload(`${OFFLINE_TARGET_SYSTEM_PAIRING_PREFIX}%7Bbad-json`)).toThrow(
      "malformed",
    );
  });
});
