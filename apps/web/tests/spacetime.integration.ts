import assert from "node:assert/strict";
import type { Identity } from "spacetimedb";
import { DbConnection } from "../src/module_bindings";
import { QUESTIONS } from "../src/game/questions";
import { RESEARCH } from "../src/game/content";
import { canAfford } from "../src/game/engine";
import type { PublicGameState } from "../src/game/types";

const uri = process.env.NEXT_PUBLIC_SPACETIME_URI || "ws://127.0.0.1:3001";
const database =
  process.env.NEXT_PUBLIC_SPACETIME_DATABASE || "rising-waters-v2-local";
const id = Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, "X");

async function client(token?: string) {
  return new Promise<{
    conn: DbConnection;
    token: string;
    identity: Identity;
  }>((resolve, reject) => {
    DbConnection.builder()
      .withUri(uri)
      .withDatabaseName(database)
      .withToken(token)
      .onConnect((conn, identity, nextToken) =>
        conn
          .subscriptionBuilder()
          .onApplied(() => resolve({ conn, token: nextToken, identity }))
          .onError((ctx) => reject(ctx.event))
          .subscribe([
            `SELECT * FROM world WHERE id = '${id}'`,
            `SELECT * FROM seat WHERE world_id = '${id}'`,
          ]),
      )
      .onConnectError((_ctx, error) => reject(error))
      .build();
  });
}

async function until(check: () => boolean) {
  const end = Date.now() + 10000;
  while (!check()) {
    if (Date.now() > end) throw Error("Subscription timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function main() {
  const hostClient = await client();
  const guestClient = await client();
  const intruderClient = await client();
  const host = hostClient.conn;
  let guest = guestClient.conn;
  const intruder = intruderClient.conn;
  try {
    await host.reducers.worldCreate({
      worldId: id,
      civ: "heartland",
      seed: 42,
      solo: false,
    });
    await guest.reducers.worldJoin({ worldId: id, civ: "archipelago" });
    await assert.rejects(
      intruder.reducers.worldJoin({ worldId: id, civ: "heartland" }),
      "claimed seats cannot be stolen",
    );
    await until(
      () =>
        [...host.db.seat.iter()].length === 2 && !!guest.db.world.id.find(id),
    );

    const row = () => host.db.world.id.find(id)!;
    const state = () => JSON.parse(row().snapshotJson) as PublicGameState;
    assert.equal(row().status, "lobby");
    assert.equal(row().started, false);
    assert.equal(state().round, 1);
    assert.equal(state().phase, "event");
    assert.equal("seed" in state, false, "seed stays server-only");
    assert.equal("rng" in state, false, "rng stays server-only");

    await assert.rejects(
      guest.reducers.worldStart({
        worldId: id,
        expectedRevision: row().revision,
      }),
      "only the host starts the lobby",
    );
    await host.reducers.worldStart({
      worldId: id,
      expectedRevision: row().revision,
    });
    await until(() => row().status === "active" && row().started);
    await assert.rejects(
      intruder.reducers.worldJoin({ worldId: id, civ: "enclave" }),
      "joining closes when the lobby starts",
    );

    await assert.rejects(
      guest.reducers.phaseAdvance({
        worldId: id,
        expectedRevision: row().revision,
      }),
    );
    await host.reducers.phaseAdvance({
      worldId: id,
      expectedRevision: row().revision,
    });
    await until(() => state().phase === "quiz");

    for (const [conn, civ] of [
      [host, "heartland"],
      [guest, "archipelago"],
    ] as const) {
      const questionId = state().civs[civ].quiz!.questionId;
      const question = QUESTIONS.find((item) => item.id === questionId)!;
      const submit = () =>
        conn.reducers.quizSubmit({
          worldId: id,
          expectedRevision: row().revision,
          questionId,
          option: question.correct,
        });
      await assert.rejects(submit(), "the server clock must start first");
      await conn.reducers.quizStart({
        worldId: id,
        expectedRevision: row().revision,
        questionId,
      });
      const previous = row().revision;
      await submit();
      await until(() => row().revision > previous);
      await assert.rejects(submit(), "answers cannot be replayed");
    }
    await until(() => state().phase === "response");

    await assert.rejects(
      intruder.reducers.acknowledge({
        worldId: id,
        expectedRevision: row().revision,
      }),
      "unseated identities cannot act",
    );
    await host.reducers.acknowledge({
      worldId: id,
      expectedRevision: row().revision,
    });
    await until(() => state().civs.heartland.responded === true);
    await guest.reducers.acknowledge({
      worldId: id,
      expectedRevision: row().revision,
    });
    await until(() => state().phase === "choice");

    await assert.rejects(
      host.reducers.choose({ worldId: id, expectedRevision: 1, option: 2 }),
      "stale revisions are rejected",
    );
    await host.reducers.choose({
      worldId: id,
      expectedRevision: row().revision,
      option: 2,
    });
    await until(() => state().civs.heartland.choice === 2);
    await guest.reducers.choose({
      worldId: id,
      expectedRevision: row().revision,
      option: 2,
    });
    await until(() => state().phase === "build");

    const project = Object.entries(RESEARCH).find(
      ([, technology]) =>
        !technology.prerequisites.length &&
        canAfford(state().civs.heartland.stock, technology.cost),
    );
    assert(project, "the host can afford a research project");
    await host.reducers.research({
      worldId: id,
      expectedRevision: row().revision,
      technology: project[0],
    });
    await until(() => state().civs.heartland.research?.id === project[0]);

    guest.disconnect();
    const reconnected = await client(guestClient.token);
    guest = reconnected.conn;
    await until(() =>
      [...guest.db.seat.iter()].some((seat) =>
        seat.identity.isEqual(reconnected.identity),
      ),
    );
    assert(
      [...guest.db.seat.iter()].some((seat) => seat.civ === "archipelago"),
      "the same identity reconnects to its seat",
    );

    await host.reducers.turnReady({
      worldId: id,
      expectedRevision: row().revision,
    });
    assert.equal(state().phase, "build");
    await guest.reducers.turnReady({
      worldId: id,
      expectedRevision: row().revision,
    });
    await until(() => state().round === 2);
    assert.equal(state().phase, "event");
    await until(() => guest.db.world.id.find(id)?.revision === row().revision);
    assert.equal(
      guest.db.world.id.find(id)?.snapshotJson,
      row().snapshotJson,
      "both computers receive the same snapshot",
    );

    console.log(
      "PASS: v2 lobby, typed reducers, private RNG, revision checks, reconnect, and two-client round synchronization work.",
    );
  } finally {
    host.disconnect();
    guest.disconnect();
    intruder.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
