import assert from "node:assert/strict";
import test from "node:test";
import { multiplayerConfig } from "../src/multiplayer/config";

test("uses the local v2 database only during development", () => {
  assert.deepEqual(multiplayerConfig({ NODE_ENV: "development" }), {
    uri: "ws://127.0.0.1:3001",
    database: "rising-waters-v2-local",
  });
});

test("requires an explicit production Maincloud configuration", () => {
  assert.throws(
    () => multiplayerConfig({ NODE_ENV: "production" }),
    /not configured/,
  );
  assert.throws(
    () =>
      multiplayerConfig({
        NODE_ENV: "production",
        NEXT_PUBLIC_SPACETIME_URI: "ws://127.0.0.1:3001",
        NEXT_PUBLIC_SPACETIME_DATABASE: "rising-waters-v2-local",
      }),
    /cannot use a localhost/,
  );
});

test("accepts a production Maincloud database", () => {
  assert.deepEqual(
    multiplayerConfig({
      NODE_ENV: "production",
      NEXT_PUBLIC_SPACETIME_URI: "wss://maincloud.spacetimedb.com",
      NEXT_PUBLIC_SPACETIME_DATABASE: "rising-waters-v2",
    }),
    {
      uri: "wss://maincloud.spacetimedb.com",
      database: "rising-waters-v2",
    },
  );
});
