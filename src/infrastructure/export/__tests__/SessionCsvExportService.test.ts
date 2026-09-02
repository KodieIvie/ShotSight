import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({ randomUUID: () => 'native-uuid' }));
vi.mock('expo-file-system', () => ({
  Directory: class Directory {},
  File: class File {},
  Paths: { document: 'file:///documents' },
}));
vi.mock('expo-sharing', () => ({
  isAvailableAsync: vi.fn(),
  shareAsync: vi.fn(),
}));

import type { SessionCsvExportInput } from '../../../domain/sessionExport';
import {
  LocalSessionCsvExportService,
  SessionCsvShareError,
  type SavedSessionCsvFile,
  type SessionCsvFileWriter,
  type SessionCsvShareGateway,
} from '../SessionCsvExportService';

function makeInput(): SessionCsvExportInput {
  return {
    exportedAt: '2026-09-01T12:34:56.000Z',
    session: {
      id: 'session-1',
      title: 'Load A',
      startedAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
      targetDistanceYards: 100,
      cameraProfileId: 'camera-1',
      targetType: 'paper',
      status: 'active',
    },
    targets: [{
      id: 'target-1',
      sessionId: 'session-1',
      name: 'Primary',
      type: 'paper',
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
    }],
    shots: [{
      id: 'shot-1',
      sessionId: 'session-1',
      targetId: 'target-1',
      number: 1,
      position: { x: 100, y: 101 },
      confirmedAt: '2026-09-01T10:05:00.000Z',
      baselineRevision: 1,
      source: 'manual',
      isColdBore: true,
      isFlyer: false,
    }],
    groups: [],
  };
}

function createWriter(): {
  readonly writer: SessionCsvFileWriter;
  readonly writes: Array<{ readonly filename: string; readonly contents: string }>;
} {
  const writes: Array<{ readonly filename: string; readonly contents: string }> = [];
  return {
    writes,
    writer: {
      async write(document, filename): Promise<SavedSessionCsvFile> {
        writes.push({ filename, contents: document.contents });
        return {
          uri: `file:///documents/shotsight-exports/${filename}`,
          filename,
          mimeType: 'text/csv',
          byteCount: document.contents.length,
          rowCount: document.rowCount,
        };
      },
    },
  };
}

describe('LocalSessionCsvExportService', () => {
  it('saves locally without opening a share sheet', async () => {
    const { writer, writes } = createWriter();
    const gateway: SessionCsvShareGateway = {
      isAvailable: vi.fn(async () => true),
      share: vi.fn(async () => undefined),
    };
    const service = new LocalSessionCsvExportService(writer, gateway, () => 'abc-123');

    const result = await service.save(makeInput());

    expect(result.shareStatus).toBe('not-requested');
    expect(result.file.filename).toBe('shotsight-load-a-20260901123456000-abc-123.csv');
    expect(writes).toHaveLength(1);
    expect(writes[0].contents).toContain('session_title');
    expect(gateway.isAvailable).not.toHaveBeenCalled();
    expect(gateway.share).not.toHaveBeenCalled();
  });

  it('keeps a local copy when system sharing is unavailable', async () => {
    const { writer } = createWriter();
    const gateway: SessionCsvShareGateway = {
      isAvailable: vi.fn(async () => false),
      share: vi.fn(async () => undefined),
    };
    const service = new LocalSessionCsvExportService(writer, gateway, () => 'abc');

    const result = await service.saveAndShare(makeInput());

    expect(result.shareStatus).toBe('unavailable');
    expect(result.file.uri).toContain('file:///documents/shotsight-exports/');
    expect(gateway.share).not.toHaveBeenCalled();
  });

  it('reports a share failure while retaining the saved export result', async () => {
    const { writer } = createWriter();
    const gateway: SessionCsvShareGateway = {
      isAvailable: vi.fn(async () => true),
      share: vi.fn(async () => { throw new Error('share canceled'); }),
    };
    const service = new LocalSessionCsvExportService(writer, gateway, () => 'abc');

    try {
      await service.saveAndShare(makeInput());
      throw new Error('Expected the share attempt to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(SessionCsvShareError);
      const shareError = error as SessionCsvShareError;
      expect(shareError.result.shareStatus).toBe('not-requested');
      expect(shareError.result.file.filename).toBe('shotsight-load-a-20260901123456000-abc.csv');
    }
  });
});
