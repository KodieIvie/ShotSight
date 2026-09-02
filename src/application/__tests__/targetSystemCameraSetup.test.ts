import { describe, expect, it } from 'vitest';

import type { OfflineTargetSystemPairingPayload } from '../../domain';
import { createTargetSystemCameraSetupSeed } from '../targetSystemCameraSetup';

const reolinkPairing: OfflineTargetSystemPairingPayload = {
  kind: 'target-system',
  version: 1,
  systemId: 'range-cam-01',
  label: '100 Yard Target',
  camera: {
    host: '192.168.50.20',
    rtspPort: 8554,
    onvifPort: 8899,
    mainRtspPath: '/live/main',
    subRtspPath: '/live/sub',
    snapshotPath: '/snapshot.jpg?channel=0',
    manufacturer: ' reolink ',
    model: 'RLC 520A',
  },
};

describe('createTargetSystemCameraSetupSeed', () => {
  it('maps a confirmed RLC-520A payload into a credential-free local camera seed', () => {
    const seed = createTargetSystemCameraSetupSeed(reolinkPairing);

    expect(seed).toEqual({
      kind: 'reolink-rlc-520a',
      name: '100 Yard Target',
      host: '192.168.50.20',
      mainRtspUrl: 'rtsp://192.168.50.20:8554/live/main',
      subRtspUrl: 'rtsp://192.168.50.20:8554/live/sub',
      snapshotUrl: 'http://192.168.50.20/snapshot.jpg?channel=0',
      onvifEnabled: true,
      onvifPort: 8899,
    });
    expect(Object.isFrozen(seed)).toBe(true);
    expect(Object.keys(seed)).not.toContain('username');
    expect(Object.keys(seed)).not.toContain('password');
    expect(Object.keys(seed)).not.toContain('credentialRef');
  });

  it('uses the documented RLC-520A local paths only after an exact model match', () => {
    const seed = createTargetSystemCameraSetupSeed({
      ...reolinkPairing,
      camera: {
        host: 'target-camera.local',
        manufacturer: 'Reolink',
        model: 'RLC-520A',
      },
    });

    expect(seed).toMatchObject({
      kind: 'reolink-rlc-520a',
      mainRtspUrl: 'rtsp://target-camera.local:554/Preview_01_main',
      subRtspUrl: 'rtsp://target-camera.local:554/Preview_01_sub',
      snapshotUrl: 'http://target-camera.local/cgi-bin/api.cgi?cmd=Snap&channel=0',
      onvifEnabled: true,
      onvifPort: 8000,
    });
  });

  it('keeps an uncertain model generic and leaves absent endpoint paths blank', () => {
    const seed = createTargetSystemCameraSetupSeed({
      ...reolinkPairing,
      camera: {
        host: '[fd00::20]',
        manufacturer: 'Reolink',
        model: 'RLC-520A Pro',
      },
    });

    expect(seed).toEqual({
      kind: 'generic-rtsp',
      name: '100 Yard Target',
      host: '[fd00::20]',
      onvifEnabled: false,
    });
    expect(seed).not.toHaveProperty('mainRtspUrl');
    expect(seed).not.toHaveProperty('subRtspUrl');
    expect(seed).not.toHaveProperty('snapshotUrl');
    expect(seed).not.toHaveProperty('onvifPort');
  });

  it('revalidates input before forming endpoints', () => {
    const unsafe = {
      ...reolinkPairing,
      camera: {
        ...reolinkPairing.camera,
        mainRtspPath: '/live/main?token=not-allowed',
      },
    } as unknown as OfflineTargetSystemPairingPayload;

    expect(() => createTargetSystemCameraSetupSeed(unsafe)).toThrow('secret query parameters');
  });
});
