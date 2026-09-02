import type { CameraProfile } from '../../domain';
import { CameraProfileRepository } from '../database/repositories/CameraProfileRepository';
import type { CredentialVault } from '../security';
import type { CameraCredentials } from './CameraAdapter';

export interface ResolvedCameraProfile {
  readonly profile: CameraProfile;
  readonly credentials?: CameraCredentials;
}

/** Coordinates credential-safe profile persistence across SQLite and SecureStore. */
export class CameraProfileStore {
  constructor(
    private readonly profiles: CameraProfileRepository,
    private readonly credentials: CredentialVault,
  ) {}

  async save(profile: CameraProfile, credential?: CameraCredentials): Promise<CameraProfile> {
    let credentialRef = profile.credentialRef;
    if (credential) {
      credentialRef = await this.credentials.save(profile.id, credential, credentialRef);
    }
    if (profile.username && !credentialRef) {
      throw new Error('Camera credentials must be saved before the camera profile.');
    }

    // The username is hydrated from SecureStore when needed and is intentionally
    // omitted from the SQLite row along with the password.
    const persisted: CameraProfile = Object.freeze({
      ...profile,
      username: undefined,
      credentialRef,
    });
    await this.profiles.upsert(persisted);
    return credential ? Object.freeze({ ...persisted, username: credential.username }) : persisted;
  }

  async findById(id: string): Promise<ResolvedCameraProfile | null> {
    const profile = await this.profiles.findById(id);
    if (!profile) {
      return null;
    }
    return this.resolve(profile);
  }

  async list(): Promise<readonly CameraProfile[]> {
    return this.profiles.list();
  }

  async remove(id: string): Promise<boolean> {
    const profile = await this.profiles.findById(id);
    const removed = await this.profiles.remove(id);
    if (removed && profile?.credentialRef) {
      await this.credentials.remove(profile.credentialRef);
    }
    return removed;
  }

  async resolve(profile: CameraProfile): Promise<ResolvedCameraProfile> {
    if (!profile.credentialRef) {
      return { profile };
    }
    const credentials = await this.credentials.get(profile.credentialRef);
    return credentials
      ? { profile: Object.freeze({ ...profile, username: credentials.username }), credentials }
      : { profile };
  }
}
