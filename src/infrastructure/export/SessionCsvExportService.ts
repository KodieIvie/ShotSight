import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import {
  buildSessionCsvDocument,
  createSessionCsvFilename,
  type SessionCsvDocument,
  type SessionCsvExportInput,
} from '../../domain/sessionExport';

const CSV_MIME_TYPE = 'text/csv';
const CSV_UTI = 'public.comma-separated-values-text';
const EXPORT_DIRECTORY_NAME = 'shotsight-exports';

export interface SavedSessionCsvFile {
  readonly uri: string;
  readonly filename: string;
  readonly mimeType: typeof CSV_MIME_TYPE;
  readonly byteCount: number;
  readonly rowCount: number;
}

export interface SessionCsvFileWriter {
  write(
    document: SessionCsvDocument,
    filename: string,
  ): Promise<SavedSessionCsvFile>;
}

export interface SessionCsvShareGateway {
  isAvailable(): Promise<boolean>;
  share(file: SavedSessionCsvFile): Promise<void>;
}

export type SessionCsvShareStatus = 'not-requested' | 'shared' | 'unavailable';

export interface SessionCsvExportResult {
  readonly file: SavedSessionCsvFile;
  readonly shareStatus: SessionCsvShareStatus;
}

/**
 * A share-sheet failure must not hide a successfully saved report. Callers can
 * offer the saved local path again while displaying the original share error.
 */
export class SessionCsvShareError extends Error {
  constructor(
    readonly result: SessionCsvExportResult,
    readonly cause: unknown,
  ) {
    super(`The CSV was saved locally, but its share sheet could not be opened: ${messageFor(cause)}`);
    this.name = 'SessionCsvShareError';
  }
}

/**
 * Writes CSV exports to app-owned document storage. It never overwrites a
 * prior report and does not contact a network service.
 */
export class ExpoSessionCsvFileWriter implements SessionCsvFileWriter {
  async write(
    document: SessionCsvDocument,
    filename: string,
  ): Promise<SavedSessionCsvFile> {
    assertSafeCsvFilename(filename);
    const directory = new Directory(Paths.document, EXPORT_DIRECTORY_NAME);
    if (!directory.exists) {
      directory.create({ intermediates: true, idempotent: true });
    }
    const file = new File(directory, filename);
    if (file.exists) {
      throw new Error(`Refusing to overwrite existing CSV export ${filename}.`);
    }
    let created = false;
    try {
      file.create({ intermediates: false, overwrite: false });
      created = true;
      file.write(document.contents, { encoding: 'utf8' });
    } catch (error) {
      // Only remove a partial file created by this invocation. A concurrently
      // created report is never ours to delete.
      if (created && file.exists) {
        try {
          file.delete();
        } catch {
          // Keep the original I/O failure; callers can inspect the local path.
        }
      }
      throw error;
    }
    return Object.freeze({
      uri: file.uri,
      filename,
      mimeType: CSV_MIME_TYPE,
      byteCount: file.size,
      rowCount: document.rowCount,
    });
  }
}

/** Uses the native share sheet only after a report has been persisted locally. */
export class ExpoSessionCsvShareGateway implements SessionCsvShareGateway {
  async isAvailable(): Promise<boolean> {
    return Sharing.isAvailableAsync();
  }

  async share(file: SavedSessionCsvFile): Promise<void> {
    await Sharing.shareAsync(file.uri, {
      dialogTitle: 'Share shotSight session CSV',
      mimeType: file.mimeType,
      UTI: CSV_UTI,
    });
  }
}

/**
 * Composes the pure CSV document with device-local storage and an optional
 * OS-level share sheet. `save` is deliberately separate from `saveAndShare`
 * so no data ever leaves the device without an explicit user action.
 */
export class LocalSessionCsvExportService {
  private readonly writer: SessionCsvFileWriter;
  private readonly shareGateway: SessionCsvShareGateway;
  private readonly uniqueId: () => string;

  constructor(
    writer: SessionCsvFileWriter = new ExpoSessionCsvFileWriter(),
    shareGateway: SessionCsvShareGateway = new ExpoSessionCsvShareGateway(),
    uniqueId: () => string = () => Crypto.randomUUID(),
  ) {
    this.writer = writer;
    this.shareGateway = shareGateway;
    this.uniqueId = uniqueId;
  }

  async save(input: SessionCsvExportInput): Promise<SessionCsvExportResult> {
    const document = buildSessionCsvDocument(input);
    const filename = createSessionCsvFilename(
      input.session.title,
      input.exportedAt,
      this.uniqueId(),
    );
    const file = await this.writer.write(document, filename);
    return Object.freeze({ file, shareStatus: 'not-requested' });
  }

  async saveAndShare(input: SessionCsvExportInput): Promise<SessionCsvExportResult> {
    const saved = await this.save(input);
    if (!(await this.shareGateway.isAvailable())) {
      return Object.freeze({ ...saved, shareStatus: 'unavailable' });
    }
    try {
      await this.shareGateway.share(saved.file);
      return Object.freeze({ ...saved, shareStatus: 'shared' });
    } catch (error) {
      throw new SessionCsvShareError(saved, error);
    }
  }
}

function assertSafeCsvFilename(filename: string): void {
  if (!/^shotsight-[a-z0-9]+(?:-[a-z0-9]+)*\.csv$/.test(filename)) {
    throw new RangeError('CSV export filenames must be generated by shotSight.');
  }
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
