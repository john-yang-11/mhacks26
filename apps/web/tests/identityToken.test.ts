import assert from "node:assert/strict";
import test from "node:test";
import {
  identityTokenKey,
  migrateIdentityToken,
} from "../src/game/identityToken";

const uri = "wss://maincloud.spacetimedb.com";
const database = "rising-waters-v2";
const currentKey = identityTokenKey(uri, database);
const legacyKey = `earthshare-identity:${uri}:${database}`;

function storage(entries: [string, string][] = []) {
  const values = new Map(entries);
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

test("migrates a pre-rename multiplayer identity", () => {
  const store = storage([[legacyKey, "legacy-token"]]);

  assert.equal(migrateIdentityToken(store, uri, database), "legacy-token");
  assert.equal(store.values.get(currentKey), "legacy-token");
  assert.equal(store.values.has(legacyKey), false);
});

test("keeps an existing Rising Waters identity", () => {
  const store = storage([[currentKey, "current-token"]]);

  assert.equal(migrateIdentityToken(store, uri, database), "current-token");
  assert.equal(store.values.get(currentKey), "current-token");
});

test("does not replace an established v2 identity with a legacy token", () => {
  const store = storage([
    [currentKey, "unclaimed-token"],
    [legacyKey, "seat-owner-token"],
  ]);

  assert.equal(migrateIdentityToken(store, uri, database), "unclaimed-token");
  assert.equal(store.values.get(currentKey), "unclaimed-token");
  assert.equal(store.values.has(legacyKey), true);
});

test("returns no token when neither identity key exists", () => {
  const store = storage();

  assert.equal(migrateIdentityToken(store, uri, database), undefined);
  assert.equal(store.values.size, 0);
});
