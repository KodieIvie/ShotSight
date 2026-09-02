import { describe, expect, it } from 'vitest';

import { MockRemotePhoneSessionService } from '../MockRemotePhoneSessionService';

describe('MockRemotePhoneSessionService', () => {
  it('pairs a viewer to a waiting target phone by code', () => {
    const service = new MockRemotePhoneSessionService();
    const targetSession = service.startTargetCamera('Bench phone');

    const viewerSession = service.pairViewer(targetSession.pairingCode, 'viewer-1');

    expect(viewerSession.id).toBe(targetSession.id);
    expect(viewerSession.viewerDeviceId).toBe('viewer-1');
    expect(viewerSession.state).toBe('connected');
    expect(service.getTelemetry(targetSession.id)?.status).toBe('connected-to-viewer');
  });

  it('records requestCapture commands with unique sequence numbers and queued captures', () => {
    const service = new MockRemotePhoneSessionService();
    const targetSession = service.startTargetCamera();
    const viewerSession = service.pairViewer(targetSession.pairingCode);

    const first = service.requestCapture(viewerSession.id, 'high');
    const second = service.requestCapture(viewerSession.id, 'data-saver');
    const captures = service.listCaptures(viewerSession.id);

    expect(first.type).toBe('requestCapture');
    expect(first.status).toBe('completed');
    expect(second.sequenceNumber).toBe(2);
    expect(captures).toHaveLength(2);
    expect(captures.map((capture) => capture.sequenceNumber)).toEqual([1, 2]);
    expect(captures.every((capture) => capture.status === 'queued')).toBe(true);
    expect(service.getTelemetry(viewerSession.id)?.queuedCaptureCount).toBe(2);
  });

  it('does not allow capture commands before a viewer is paired', () => {
    const service = new MockRemotePhoneSessionService();
    const targetSession = service.startTargetCamera();

    expect(() => service.requestCapture(targetSession.id)).toThrow(
      'Pair a viewer before sending target-phone commands.',
    );
  });
});
