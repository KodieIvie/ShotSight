import initSqlJs from 'sql.js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createCameraProfile } from '../../../../domain';
import { DATABASE_MIGRATIONS } from '../../migrations';
import { CameraProfileRepository } from '../CameraProfileRepository';

let Sql: Awaited<ReturnType<typeof initSqlJs>>;
let database: InstanceType<Awaited<ReturnType<typeof initSqlJs>>['Database']>;

beforeAll(async () => {
  Sql = await initSqlJs();
});

afterEach(() => {
  database?.close();
});

function openMigratedDatabase(): void {
  database = new Sql.Database();
  for (const migration of DATABASE_MIGRATIONS) {
    database.run(migration.sql);
  }
}

function sqlParameters(parameters: readonly unknown[]): unknown {
  if (
    parameters.length === 1 &&
    typeof parameters[0] === 'object' &&
    parameters[0] !== null &&
    !Array.isArray(parameters[0])
  ) {
    return parameters[0];
  }
  return parameters;
}

function repository(): CameraProfileRepository {
  const sqlite = {
    async runAsync(sql: string, ...parameters: unknown[]): Promise<{ readonly changes: number }> {
      database.run(sql, sqlParameters(parameters) as never);
      return { changes: Number(database.exec('SELECT changes()')[0]?.values[0]?.[0] ?? 0) };
    },
    async getFirstAsync<T>(sql: string, ...parameters: unknown[]): Promise<T | null> {
      const statement = database.prepare(sql);
      try {
        statement.bind(sqlParameters(parameters) as never);
        return statement.step() ? (statement.getAsObject() as T) : null;
      } finally {
        statement.free();
      }
    },
  };
  return new CameraProfileRepository(async () => sqlite as never);
}

function profile(id: string, protocol?: 'http' | 'https') {
  return createCameraProfile(
    {
      id,
      name: 'Target camera',
      host: '192.168.50.20',
      credentialRef: `secure-store://${id}`,
      streams: { mainRtspUrl: 'rtsp://192.168.50.20:554/main' },
      onvif: { enabled: true, port: 8000, ...(protocol ? { protocol } : {}) },
      preferredStream: 'main',
      preferredStillSource: 'http-snapshot',
      capabilities: { rtsp: true, httpSnapshot: true, onvif: true },
    },
    '2026-09-01T00:00:00.000Z',
  );
}

describe('CameraProfileRepository ONVIF protocol persistence', () => {
  it('persists and hydrates an explicit HTTPS protocol', async () => {
    openMigratedDatabase();
    const profiles = repository();

    await profiles.upsert(profile('camera-https', 'https'));

    expect(database.exec("SELECT onvif_protocol FROM camera_profiles WHERE id = 'camera-https'")[0]?.values)
      .toEqual([['https']]);
    await expect(profiles.findById('camera-https')).resolves.toMatchObject({
      onvif: { enabled: true, port: 8000, protocol: 'https' },
    });
  });

  it('writes and hydrates HTTP for profiles created before protocol support', async () => {
    openMigratedDatabase();
    const profiles = repository();

    await profiles.upsert(profile('camera-legacy'));

    expect(database.exec("SELECT onvif_protocol FROM camera_profiles WHERE id = 'camera-legacy'")[0]?.values)
      .toEqual([['http']]);
    await expect(profiles.findById('camera-legacy')).resolves.toMatchObject({
      onvif: { enabled: true, port: 8000, protocol: 'http' },
    });
  });
});
