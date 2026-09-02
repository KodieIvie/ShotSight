import type { CameraCredentials } from '../camera';

export interface CredentialVault {
  /** Save or replace credentials and return the opaque reference persisted with a camera profile. */
  save(cameraProfileId: string, credentials: CameraCredentials, credentialRef?: string): Promise<string>;
  get(credentialRef: string): Promise<CameraCredentials | null>;
  remove(credentialRef: string): Promise<void>;
  isAvailable(): Promise<boolean>;
}

export class CredentialVaultUnavailableError extends Error {
  constructor() {
    super('Secure credential storage is not available on this device.');
    this.name = 'CredentialVaultUnavailableError';
  }
}
