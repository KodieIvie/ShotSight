import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import {
  DATABASE_MIGRATIONS,
  LATEST_DATABASE_VERSION,
  SHOTSIGHT_DATABASE_NAME,
} from './migrations';

interface UserVersionRow {
  readonly user_version: number;
}

export class DatabaseVersionError extends Error {
  constructor(actual: number, supported: number) {
    super(
      `This ShotSight database is version ${actual}, but this app supports through version ${supported}.`,
    );
    this.name = 'DatabaseVersionError';
  }
}

/** Owns database initialization and ensures migrations run once per process. */
export class ShotSightDatabase {
  private databasePromise: Promise<SQLiteDatabase> | null = null;

  constructor(private readonly databaseName = SHOTSIGHT_DATABASE_NAME) {}

  open(): Promise<SQLiteDatabase> {
    if (!this.databasePromise) {
      this.databasePromise = this.openAndMigrate().catch((error) => {
        this.databasePromise = null;
        throw error;
      });
    }
    return this.databasePromise;
  }

  async close(): Promise<void> {
    if (!this.databasePromise) {
      return;
    }
    const database = await this.databasePromise;
    this.databasePromise = null;
    await database.closeAsync();
  }

  private async openAndMigrate(): Promise<SQLiteDatabase> {
    const database = await openDatabaseAsync(this.databaseName);
    try {
      await database.execAsync('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
      const row = await database.getFirstAsync<UserVersionRow>('PRAGMA user_version');
      const currentVersion = row?.user_version ?? 0;
      if (currentVersion > LATEST_DATABASE_VERSION) {
        throw new DatabaseVersionError(currentVersion, LATEST_DATABASE_VERSION);
      }

      for (const migration of DATABASE_MIGRATIONS) {
        if (migration.version <= currentVersion) {
          continue;
        }
        await database.withTransactionAsync(async () => {
          await database.execAsync(migration.sql);
          await database.execAsync(`PRAGMA user_version = ${migration.version}`);
        });
      }
      await database.execAsync('PRAGMA foreign_keys = ON;');
      return database;
    } catch (error) {
      await database.closeAsync();
      throw error;
    }
  }
}

export const shotSightDatabase = new ShotSightDatabase();
