import assert from "node:assert/strict";
import { DbConnection } from "../src/module_bindings";
import type { GameState } from "../src/game/types";

/** Waiting-room flow against a live SpacetimeDB: the host's Start must reach every player. */
const uri = process.env.NEXT_PUBLIC_SPACETIME_URI || "ws://127.0.0.1:3001";
const database =
  process.env.NEXT_PUBLIC_SPACETIME_DATABASE || "rising-waters-local";
const id = Array.from({ length: 6 }, () =>
  "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".charAt(Math.floor(Math.random() * 32)),
).join("");

function client() {
  return new Promise<DbConnection>((resolve, reject) => {
    DbConnection.builder()
      .withUri(uri)
      .withDatabaseName(database)
      .onConnect((conn) =>
        conn
          .subscriptionBuilder()
          .onApplied(() => resolve(conn))
          .onError((ctx) => reject(ctx.event))
          .subscribe([
            `SELECT * FROM room WHERE id = '${id}'`,
            `SELECT * FROM seat WHERE room_id = '${id}'`,
          ]),
      )
      .onConnectError((_ctx, error) => reject(error))
      .build();
  });
}
const state = (conn: DbConnection) =>
  JSON.parse(conn.db.room.id.find(id)!.stateJson) as GameState;
async function until(check: () => boolean, what: string) {
  const end = Date.now() + 10000;
  while (!check()) {
    if (Date.now() > end) throw Error(`Timed out waiting for: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
async function rejects(run: () => Promise<unknown>, message: RegExp) {
  await assert.rejects(run, message);
}

async function main() {
  const host = await client(),
    guest = await client(),
    late = await client();
  try {
    await host.reducers.createWorld({
      roomId: id,
      civ: "heartland",
      seed: 7,
      solo: false,
    });
    await guest.reducers.joinWorld({ roomId: id, civ: "enclave" });
    await until(() => state(guest).humans.length === 2, "guest seated");
    assert.equal(state(host).started, undefined, "lobby is open at first");

    // Only the host can start, and only once the room is a joinable shared world.
    await rejects(
      () => guest.reducers.startWorld({ roomId: id }),
      /Only the host can start/,
    );
    assert.equal(state(host).started, undefined, "a guest cannot start it");

    await host.reducers.startWorld({ roomId: id });
    // The guest's own subscription sees the flag: this is what closes their waiting room.
    await until(() => state(guest).started === true, "guest sees the start");
    assert.equal(
      state(guest).phase,
      "event",
      "starting does not skip the story",
    );
    assert.equal(state(guest).round, 1);

    // Starting twice is harmless; the roster is locked once the game starts.
    await host.reducers.startWorld({ roomId: id });
    await rejects(
      () => late.reducers.joinWorld({ roomId: id, civ: "archipelago" }),
      /already started/,
    );
    assert.equal(state(host).humans.length, 2, "late joiner was not seated");
  } finally {
    host.disconnect();
    guest.disconnect();
    late.disconnect();
  }
  console.log(
    "PASS: guests wait until the host starts; the host's start reaches every player; only the host can start; the roster locks at start.",
  );
}
main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
