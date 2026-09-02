import type { SQLiteDatabase } from 'expo-sqlite';

import type { ShotSightDatabase } from '../ShotSightDatabase';
import { AnalysisRepository } from './AnalysisRepository';
import { CameraProfileRepository } from './CameraProfileRepository';
import { CalibrationRepository } from './CalibrationRepository';
import { CaptureRepository } from './CaptureRepository';
import { SessionRepository } from './SessionRepository';
import { SettingsRepository } from './SettingsRepository';
import { ShotGroupRepository } from './ShotGroupRepository';
import { ShotRepository } from './ShotRepository';
import { TargetRepository } from './TargetRepository';

export * from './AnalysisRepository';
export * from './CalibrationRepository';
export * from './CameraProfileRepository';
export * from './CaptureRepository';
export * from './SessionRepository';
export * from './SettingsRepository';
export * from './ShotGroupRepository';
export * from './ShotRepository';
export * from './TargetRepository';

export interface ShotSightRepositories {
  readonly analysis: AnalysisRepository;
  readonly cameras: CameraProfileRepository;
  readonly sessions: SessionRepository;
  readonly captures: CaptureRepository;
  readonly targets: TargetRepository;
  readonly shots: ShotRepository;
  readonly groups: ShotGroupRepository;
  readonly calibrations: CalibrationRepository;
  readonly settings: SettingsRepository;
}

export function createShotSightRepositories(
  databaseOwner: Pick<ShotSightDatabase, 'open'>,
): ShotSightRepositories {
  const getDatabase = (): Promise<SQLiteDatabase> => databaseOwner.open();
  return Object.freeze({
    analysis: new AnalysisRepository(getDatabase),
    cameras: new CameraProfileRepository(getDatabase),
    sessions: new SessionRepository(getDatabase),
    captures: new CaptureRepository(getDatabase),
    targets: new TargetRepository(getDatabase),
    shots: new ShotRepository(getDatabase),
    groups: new ShotGroupRepository(getDatabase),
    calibrations: new CalibrationRepository(getDatabase),
    settings: new SettingsRepository(getDatabase),
  });
}
