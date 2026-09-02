import { describe, expect, it } from "vitest";

import type { OfflineTargetSystemPairingPayload } from "../../../domain";
import { NoHardwareTargetSystemGateway } from "../TargetSystemGateway";

const pairing: OfflineTargetSystemPairingPayload = {
  kind: "target-system",
  version: 1,
  systemId: "range-cam-01",
  label: "100 Yard Target",
  camera: { host: "192.168.50.20" },
  radio: { transport: "ble", deviceId: "AA:BB:CC:DD:EE:FF" },
};

describe("NoHardwareTargetSystemGateway", () => {
  it("reports an explicit unconfigured state without fabricating device telemetry", async () => {
    const gateway = new NoHardwareTargetSystemGateway(() => "2026-09-01T12:00:00.000Z");

    await expect(gateway.getAvailability()).resolves.toEqual({
      state: "unavailable",
      checkedAt: "2026-09-01T12:00:00.000Z",
      message: "No target-system hardware gateway is configured on this device.",
    });
    await expect(gateway.getStatus(pairing)).resolves.toEqual({
      systemId: "range-cam-01",
      observedAt: "2026-09-01T12:00:00.000Z",
      gateway: {
        state: "unavailable",
        checkedAt: "2026-09-01T12:00:00.000Z",
        message: "No target-system hardware gateway is configured on this device.",
      },
      camera: {
        state: "not-probed",
        observedAt: "2026-09-01T12:00:00.000Z",
        message: "Camera health has not been probed because no hardware gateway is configured.",
      },
      radio: {
        transport: "ble",
        state: "not-probed",
        observedAt: "2026-09-01T12:00:00.000Z",
        message: "Radio health has not been probed because no hardware gateway is configured.",
      },
    });
  });

  it("does not invent a radio status when pairing has no radio configuration", async () => {
    const gateway = new NoHardwareTargetSystemGateway(() => "2026-09-01T12:00:00.000Z");
    const status = await gateway.getStatus({ ...pairing, radio: undefined });

    expect(status.radio).toBeUndefined();
    expect(status.battery).toBeUndefined();
    expect(Object.isFrozen(status)).toBe(true);
  });
});
