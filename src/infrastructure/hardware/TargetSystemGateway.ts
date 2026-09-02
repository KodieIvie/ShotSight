import {
  validateOfflineTargetSystemPairingPayload,
  type IsoTimestamp,
  type OfflineTargetSystemPairingPayload,
  type TargetSystemGatewayAvailability,
  type TargetSystemStatusSnapshot,
} from "../../domain";

/**
 * Boundary for a future BLE, radio, or camera-health implementation.
 * Implementations receive only the credential-free QR pairing metadata.
 */
export interface TargetSystemGateway {
  readonly id: string;
  readonly mode: "hardware" | "no-hardware";

  getAvailability(): Promise<TargetSystemGatewayAvailability>;
  getStatus(pairing: OfflineTargetSystemPairingPayload): Promise<TargetSystemStatusSnapshot>;
}

/**
 * Safe default while no target-system electronics are attached. It preserves
 * the eventual gateway contract without pretending that a camera or radio was
 * successfully contacted.
 */
export class NoHardwareTargetSystemGateway implements TargetSystemGateway {
  public readonly id = "no-hardware";
  public readonly mode = "no-hardware" as const;

  public constructor(
    private readonly now: () => IsoTimestamp = () => new Date().toISOString(),
  ) {}

  public async getAvailability(): Promise<TargetSystemGatewayAvailability> {
    return Object.freeze({
      state: "unavailable",
      checkedAt: this.now(),
      message: "No target-system hardware gateway is configured on this device.",
    });
  }

  public async getStatus(
    pairingInput: OfflineTargetSystemPairingPayload,
  ): Promise<TargetSystemStatusSnapshot> {
    const pairing = validateOfflineTargetSystemPairingPayload(pairingInput);
    const observedAt = this.now();
    const gateway = Object.freeze({
      state: "unavailable" as const,
      checkedAt: observedAt,
      message: "No target-system hardware gateway is configured on this device.",
    });
    const camera = Object.freeze({
      state: "not-probed" as const,
      observedAt,
      message: "Camera health has not been probed because no hardware gateway is configured.",
    });
    const radio = pairing.radio
      ? Object.freeze({
        transport: pairing.radio.transport,
        state: "not-probed" as const,
        observedAt,
        message: "Radio health has not been probed because no hardware gateway is configured.",
      })
      : undefined;

    return Object.freeze({
      systemId: pairing.systemId,
      observedAt,
      gateway,
      camera,
      ...(radio ? { radio } : {}),
    });
  }
}
