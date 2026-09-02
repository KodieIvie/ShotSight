import type { CameraProfile } from '../../domain';
import type { CameraAdapter } from './CameraAdapter';
import { GenericRtspAdapter } from './GenericRtspAdapter';
import { ReolinkRlc520aAdapter } from './reolink/ReolinkRlc520aAdapter';

export class CameraAdapterRegistry {
  private readonly adapters: readonly CameraAdapter[];

  constructor(
    adapters: readonly CameraAdapter[] = [
      new ReolinkRlc520aAdapter(),
      new GenericRtspAdapter(),
    ],
  ) {
    this.adapters = adapters;
  }

  forProfile(profile: CameraProfile): CameraAdapter {
    const match = this.adapters.find((adapter) => adapter.matches(profile));
    if (!match) {
      throw new Error(`No local camera adapter supports preset ${profile.presetId ?? 'unknown'}.`);
    }
    return match;
  }

  all(): readonly CameraAdapter[] {
    return this.adapters;
  }
}
