import type { SQLiteDatabase } from 'expo-sqlite';

import { validateCameraProfile, type CameraProfile } from '../../../domain';
import { fromIntegerBoolean, toIntegerBoolean } from '../serialization';

interface CameraProfileRow {
  readonly id: string;
  readonly name: string;
  readonly host: string;
  readonly manufacturer: string | null;
  readonly model: string | null;
  readonly credential_ref: string | null;
  readonly main_rtsp_url: string;
  readonly sub_rtsp_url: string | null;
  readonly snapshot_url: string | null;
  readonly onvif_enabled: number;
  readonly onvif_port: number | null;
  readonly onvif_protocol: string | null;
  readonly preferred_stream: 'main' | 'sub';
  readonly preferred_still_source: 'http-snapshot' | 'main-stream-frame';
  readonly capability_rtsp: number;
  readonly capability_http_snapshot: number;
  readonly capability_onvif: number;
  readonly target_distance_yards: number | null;
  readonly camera_to_target_distance_yards: number | null;
  readonly physical_target_width_inches: number | null;
  readonly physical_target_height_inches: number | null;
  readonly preset_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

const CAMERA_COLUMNS = `
  id, name, host, manufacturer, model, credential_ref,
  main_rtsp_url, sub_rtsp_url, snapshot_url,
  onvif_enabled, onvif_port, onvif_protocol, preferred_stream, preferred_still_source,
  capability_rtsp, capability_http_snapshot, capability_onvif,
  target_distance_yards, camera_to_target_distance_yards,
  physical_target_width_inches, physical_target_height_inches,
  preset_id, created_at, updated_at
`;

/** Camera configuration only. Passwords and usernames remain in the credential vault. */
export class CameraProfileRepository {
  constructor(private readonly getDatabase: () => Promise<SQLiteDatabase>) {}

  async upsert(profile: CameraProfile): Promise<void> {
    validateCameraProfile(profile);
    const database = await this.getDatabase();
    await database.runAsync(
      `INSERT INTO camera_profiles (
        id, name, host, manufacturer, model, credential_ref,
        main_rtsp_url, sub_rtsp_url, snapshot_url,
        onvif_enabled, onvif_port, onvif_protocol, preferred_stream, preferred_still_source,
        capability_rtsp, capability_http_snapshot, capability_onvif,
        target_distance_yards, camera_to_target_distance_yards,
        physical_target_width_inches, physical_target_height_inches,
        preset_id, created_at, updated_at
      ) VALUES (
        $id, $name, $host, $manufacturer, $model, $credentialRef,
        $mainRtspUrl, $subRtspUrl, $snapshotUrl,
        $onvifEnabled, $onvifPort, $onvifProtocol, $preferredStream, $preferredStillSource,
        $capabilityRtsp, $capabilityHttpSnapshot, $capabilityOnvif,
        $targetDistanceYards, $cameraToTargetDistanceYards,
        $physicalTargetWidthInches, $physicalTargetHeightInches,
        $presetId, $createdAt, $updatedAt
      ) ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        host = excluded.host,
        manufacturer = excluded.manufacturer,
        model = excluded.model,
        credential_ref = excluded.credential_ref,
        main_rtsp_url = excluded.main_rtsp_url,
        sub_rtsp_url = excluded.sub_rtsp_url,
        snapshot_url = excluded.snapshot_url,
        onvif_enabled = excluded.onvif_enabled,
        onvif_port = excluded.onvif_port,
        onvif_protocol = excluded.onvif_protocol,
        preferred_stream = excluded.preferred_stream,
        preferred_still_source = excluded.preferred_still_source,
        capability_rtsp = excluded.capability_rtsp,
        capability_http_snapshot = excluded.capability_http_snapshot,
        capability_onvif = excluded.capability_onvif,
        target_distance_yards = excluded.target_distance_yards,
        camera_to_target_distance_yards = excluded.camera_to_target_distance_yards,
        physical_target_width_inches = excluded.physical_target_width_inches,
        physical_target_height_inches = excluded.physical_target_height_inches,
        preset_id = excluded.preset_id,
        updated_at = excluded.updated_at`,
      {
        $id: profile.id,
        $name: profile.name,
        $host: profile.host,
        $manufacturer: profile.manufacturer ?? null,
        $model: profile.model ?? null,
        $credentialRef: profile.credentialRef ?? null,
        $mainRtspUrl: profile.streams.mainRtspUrl,
        $subRtspUrl: profile.streams.subRtspUrl ?? null,
        $snapshotUrl: profile.streams.snapshotUrl ?? null,
        $onvifEnabled: toIntegerBoolean(profile.onvif.enabled),
        $onvifPort: profile.onvif.port ?? null,
        $onvifProtocol: profile.onvif.protocol ?? 'http',
        $preferredStream: profile.preferredStream,
        $preferredStillSource: profile.preferredStillSource,
        $capabilityRtsp: toIntegerBoolean(profile.capabilities.rtsp),
        $capabilityHttpSnapshot: toIntegerBoolean(profile.capabilities.httpSnapshot),
        $capabilityOnvif: toIntegerBoolean(profile.capabilities.onvif),
        $targetDistanceYards: profile.targetDistanceYards ?? null,
        $cameraToTargetDistanceYards: profile.cameraToTargetDistanceYards ?? null,
        $physicalTargetWidthInches: profile.physicalTargetDimensionsInches?.width ?? null,
        $physicalTargetHeightInches: profile.physicalTargetDimensionsInches?.height ?? null,
        $presetId: profile.presetId ?? null,
        $createdAt: profile.createdAt,
        $updatedAt: profile.updatedAt,
      },
    );
  }

  async findById(id: string): Promise<CameraProfile | null> {
    const database = await this.getDatabase();
    const row = await database.getFirstAsync<CameraProfileRow>(
      `SELECT ${CAMERA_COLUMNS} FROM camera_profiles WHERE id = ?`,
      id,
    );
    return row ? mapCameraProfile(row) : null;
  }

  async list(): Promise<readonly CameraProfile[]> {
    const database = await this.getDatabase();
    const rows = await database.getAllAsync<CameraProfileRow>(
      `SELECT ${CAMERA_COLUMNS} FROM camera_profiles ORDER BY updated_at DESC, name COLLATE NOCASE`,
    );
    return rows.map(mapCameraProfile);
  }

  async remove(id: string): Promise<boolean> {
    const database = await this.getDatabase();
    const result = await database.runAsync('DELETE FROM camera_profiles WHERE id = ?', id);
    return result.changes > 0;
  }
}

function mapCameraProfile(row: CameraProfileRow): CameraProfile {
  const hasPhysicalSize =
    row.physical_target_width_inches !== null &&
    row.physical_target_height_inches !== null;
  const profile: CameraProfile = {
    id: row.id,
    name: row.name,
    host: row.host,
    manufacturer: row.manufacturer ?? undefined,
    model: row.model ?? undefined,
    credentialRef: row.credential_ref ?? undefined,
    streams: {
      mainRtspUrl: row.main_rtsp_url,
      subRtspUrl: row.sub_rtsp_url ?? undefined,
      snapshotUrl: row.snapshot_url ?? undefined,
    },
    onvif: {
      enabled: fromIntegerBoolean(row.onvif_enabled),
      port: row.onvif_port ?? undefined,
      protocol: mapOnvifProtocol(row.onvif_protocol),
    },
    preferredStream: row.preferred_stream,
    preferredStillSource: row.preferred_still_source,
    targetDistanceYards: row.target_distance_yards ?? undefined,
    cameraToTargetDistanceYards: row.camera_to_target_distance_yards ?? undefined,
    physicalTargetDimensionsInches: hasPhysicalSize
      ? {
          width: row.physical_target_width_inches as number,
          height: row.physical_target_height_inches as number,
        }
      : undefined,
    presetId: row.preset_id ?? undefined,
    capabilities: {
      rtsp: fromIntegerBoolean(row.capability_rtsp),
      httpSnapshot: fromIntegerBoolean(row.capability_http_snapshot),
      onvif: fromIntegerBoolean(row.capability_onvif),
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  validateCameraProfile(profile);
  return Object.freeze(profile);
}

function mapOnvifProtocol(value: string | null): 'http' | 'https' {
  if (value === null || value === 'http') {
    return 'http';
  }
  if (value === 'https') {
    return 'https';
  }
  throw new Error(`Stored ONVIF protocol is invalid: ${value}`);
}
