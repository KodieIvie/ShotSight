export function toIntegerBoolean(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

export function fromIntegerBoolean(value: number): boolean {
  return value === 1;
}

export function serializeJson(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

export function deserializeJson<T>(value: string | null): T | undefined {
  if (value === null) {
    return undefined;
  }
  return JSON.parse(value) as T;
}

export function removeUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
