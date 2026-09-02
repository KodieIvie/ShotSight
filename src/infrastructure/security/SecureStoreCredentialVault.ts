import * as SecureStore from 'expo-secure-store';

import type { CameraCredentials } from '../camera';
import { CredentialVaultUnavailableError, type CredentialVault } from './CredentialVault';

const KEY_PREFIX = 'shotsight.camera.';
const KEYCHAIN_SERVICE = 'shotsight.camera.credentials';
const VALUE_VERSION = 1;

interface StoredCredentialValue {
  readonly version: typeof VALUE_VERSION;
  readonly username: string;
  readonly password: string;
}

/** Platform Keychain/Keystore-backed camera credential storage. */
export class SecureStoreCredentialVault implements CredentialVault {
  private readonly options: SecureStore.SecureStoreOptions = {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    keychainService: KEYCHAIN_SERVICE,
  };

  async save(
    cameraProfileId: string,
    credentials: CameraCredentials,
    credentialRef?: string,
  ): Promise<string> {
    await this.assertAvailable();
    if (!credentials.username.trim()) {
      throw new Error('A camera username is required.');
    }

    const reference = credentialRef ?? this.referenceFor(cameraProfileId);
    this.assertValidReference(reference);
    const value: StoredCredentialValue = {
      version: VALUE_VERSION,
      username: credentials.username,
      password: credentials.password,
    };
    await SecureStore.setItemAsync(reference, JSON.stringify(value), this.options);
    return reference;
  }

  async get(credentialRef: string): Promise<CameraCredentials | null> {
    await this.assertAvailable();
    this.assertValidReference(credentialRef);
    const serialized = await SecureStore.getItemAsync(credentialRef, this.options);
    if (serialized === null) {
      return null;
    }

    try {
      const stored = JSON.parse(serialized) as Partial<StoredCredentialValue>;
      if (
        stored.version !== VALUE_VERSION ||
        typeof stored.username !== 'string' ||
        typeof stored.password !== 'string'
      ) {
        throw new Error('Unsupported credential value.');
      }
      return { username: stored.username, password: stored.password };
    } catch {
      // Do not include the serialized secret in the error.
      throw new Error('The saved camera credential could not be read. Re-enter the credential.');
    }
  }

  async remove(credentialRef: string): Promise<void> {
    await this.assertAvailable();
    this.assertValidReference(credentialRef);
    await SecureStore.deleteItemAsync(credentialRef, this.options);
  }

  isAvailable(): Promise<boolean> {
    return SecureStore.isAvailableAsync();
  }

  referenceFor(cameraProfileId: string): string {
    const safeId = cameraProfileId.trim().replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!safeId) {
      throw new Error('A camera profile ID is required to store credentials.');
    }
    return `${KEY_PREFIX}${safeId}`;
  }

  private async assertAvailable(): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new CredentialVaultUnavailableError();
    }
  }

  private assertValidReference(reference: string): void {
    if (!reference.startsWith(KEY_PREFIX) || !/^[a-zA-Z0-9._-]+$/.test(reference)) {
      throw new Error('The credential reference is not valid.');
    }
  }
}
