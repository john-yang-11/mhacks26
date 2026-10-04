interface TokenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const identityTokenKey = (uri: string, database: string) =>
  `rising-waters-v2-identity:${uri}:${database}`;

export function multiplayerIdentityToken(
  storage: TokenStorage,
  uri: string,
  database: string,
) {
  const currentKey = identityTokenKey(uri, database);
  const current = storage.getItem(currentKey);
  if (current) return current;

  for (const prefix of ["rising-waters-identity", "earthshare-identity"]) {
    const legacyKey = `${prefix}:${uri}:${database}`;
    const legacy = storage.getItem(legacyKey);
    if (!legacy) continue;
    storage.setItem(currentKey, legacy);
    storage.removeItem(legacyKey);
    return legacy;
  }
  return undefined;
}
