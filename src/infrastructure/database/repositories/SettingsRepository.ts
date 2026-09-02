import type { SQLiteDatabase } from 'expo-sqlite';

export class SettingsRepository {
  constructor(private readonly getDatabase: () => Promise<SQLiteDatabase>) {}

  async set<T>(key: string, value: T, updatedAt = new Date().toISOString()): Promise<void> {
    const database = await this.getDatabase();
    await database.runAsync(
      `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at`,
      key,
      JSON.stringify(value),
      updatedAt,
    );
  }

  async get<T>(key: string): Promise<T | null> {
    const database = await this.getDatabase();
    const row = await database.getFirstAsync<{ readonly value_json: string }>(
      'SELECT value_json FROM app_settings WHERE key = ?',
      key,
    );
    return row ? (JSON.parse(row.value_json) as T) : null;
  }

  async remove(key: string): Promise<boolean> {
    const database = await this.getDatabase();
    const result = await database.runAsync('DELETE FROM app_settings WHERE key = ?', key);
    return result.changes > 0;
  }
}
