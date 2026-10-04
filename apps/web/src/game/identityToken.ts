interface TokenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const identityTokenKey = (uri: string, database: string) =>
  `rising-waters-identity:${uri}:${database}`;

/** Carry identities created before the Rising Waters rename into the new storage key. */
export function migrateIdentityToken(
  storage: TokenStorage,
  uri: string,
  database: string,
) {
  const currentKey = identityTokenKey(uri, database);
  const legacyKey = `earthshare-identity:${uri}:${database}`;
  const legacy = storage.getItem(legacyKey);
  if (legacy) {
    // Prefer the established identity even if a failed post-rename reconnect
    // already generated a new token under the new key.
    storage.setItem(currentKey, legacy);
    storage.removeItem(legacyKey);
    return legacy;
  }
  return storage.getItem(currentKey) || undefined;
}
