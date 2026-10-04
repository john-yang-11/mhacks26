import assert from "node:assert/strict";
import { DbConnection } from "../src/module_bindings";
import { QUESTIONS } from "../src/game/questions";
import type { GameState } from "../src/game/types";

const uri = process.env.NEXT_PUBLIC_SPACETIME_URI || "ws://127.0.0.1:3001";
const database =
  process.env.NEXT_PUBLIC_SPACETIME_DATABASE || "earthshare-game-local";
const id = Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, "X");
async function client() {
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
async function until(check: () => boolean) {
  const end = Date.now() + 10000;
  while (!check()) {
    if (Date.now() > end) throw Error("Subscription timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
async function main() {
  const host = await client(),
    guest = await client(),
    intruder = await client();
  try {
    await host.reducers.createWorld({
      roomId: id,
      civ: "heartland",
      seed: 42,
      solo: false,
    });
    await guest.reducers.joinWorld({ roomId: id, civ: "enclave" });
    await assert.rejects(
      intruder.reducers.joinWorld({ roomId: id, civ: "heartland" }),
      "claimed seats cannot be stolen",
    );
    await until(
      () =>
        [...host.db.seat.iter()].length === 2 && !!guest.db.room.id.find(id),
    );
    const row = () => host.db.room.id.find(id)!;
    const state = () => JSON.parse(row().stateJson) as GameState;
    const act = (
      conn: DbConnection,
      action: object,
      revision = row().revision,
    ) =>
      conn.reducers.act({
        roomId: id,
        revision,
        actionJson: JSON.stringify(action),
      });
    assert.equal(state().round, 1);
    assert.equal(state().phase, "event");
    assert.deepEqual(state().humans.sort(), ["enclave", "heartland"]);

    // Only the host moves from the event to the quiz.
    await assert.rejects(guest.reducers.advance({ roomId: id }));
    await host.reducers.advance({ roomId: id });
    await until(() => state().phase === "quiz");
    await assert.rejects(
      intruder.reducers.joinWorld({ roomId: id, civ: "enclave" }),
      "joining closes once the event has advanced",
    );

    // Each player answers their own question on the server clock; no replays.
    for (const [conn, civ] of [
      [host, "heartland"],
      [guest, "enclave"],
    ] as const) {
      const questionId = state().civs[civ].quiz!.questionId;
      const question = QUESTIONS.find((q) => q.id === questionId)!;
      const answer = () =>
        conn.reducers.answer({
          roomId: id,
          questionId,
          option: question.correct,
          lifeline: false,
        });
      await assert.rejects(answer(), "must start the clock first");
      await conn.reducers.beginQuestion({ roomId: id, questionId });
      const previous = row().revision;
      await answer();
      await until(() => row().revision > previous);
      await assert.rejects(answer(), "no second answer");
    }
    await until(() => state().phase === "response");
    await act(host, { type: "acknowledge", civ: "heartland" });
    await until(() => state().civs.heartland.responded === true);
    assert.equal(state().phase, "response", "waits for the guest response");
    await act(guest, { type: "acknowledge", civ: "enclave" });
    await until(() => state().phase === "choice");

    // No impersonation, no stale revisions.
    await assert.rejects(
      act(guest, { type: "choose", civ: "heartland", option: 2 }),
    );
    await assert.rejects(
      act(host, { type: "choose", civ: "heartland", option: 2 }, 1),
    );
    await act(host, { type: "choose", civ: "heartland", option: 0 });
    await until(() => state().civs.heartland.choice === 0);
    assert.equal(state().phase, "choice", "waits for the guest");
    await act(guest, { type: "choose", civ: "enclave", option: 2 });
    await until(() => state().phase === "reaction");

    const pushed = state().pendingEffects.find(
      (effect) => effect.from === "heartland" && effect.to === "enclave",
    )!;
    assert(pushed, "host cheap choice should create an incoming effect");
    await assert.rejects(
      act(host, {
        type: "react",
        civ: "heartland",
        effectId: pushed.id,
        kind: "accept",
      }),
      "only the victim may react",
    );
    await act(guest, {
      type: "react",
      civ: "enclave",
      effectId: pushed.id,
      kind: "embargo",
      resource: "brick",
    });
    await until(
      () => !!state().pendingEffects.find((e) => e.id === pushed.id)?.reaction,
    );

    for (const [conn, civ] of [
      [host, "heartland"],
      [guest, "enclave"],
    ] as const)
      while (state().phase === "reaction") {
        const pending = state().pendingEffects.find(
          (effect) => effect.to === civ && !effect.reaction,
        );
        if (!pending) break;
        const previous = row().revision;
        await act(conn, {
          type: "react",
          civ,
          effectId: pending.id,
          kind: "accept",
        });
        await until(() => row().revision > previous);
      }
    await until(() => state().phase === "build");
    await assert.rejects(
      act(host, {
        type: "exchange",
        civ: "heartland",
        give: "sheep",
        get: "ore",
      }),
      "embargo blocks bank exchange",
    );

    // Build, then both end the turn.
    await host.reducers.ready({ roomId: id });
    assert.equal(state().phase, "build");
    await guest.reducers.ready({ roomId: id });
    await until(() => state().round === 2);
    assert.equal(state().phase, "event");
    await until(() => guest.db.room.id.find(id)?.revision === row().revision);
    assert.equal(guest.db.room.id.find(id)?.stateJson, row().stateJson);
    await until(() => [...host.db.seat.iter()].every((seat) => !seat.ready));
    console.log(
      "PASS: two identities share a room; claimed and late seats are rejected; host-only advance and server-timed quizzes work; victim-only reactions and embargoes are enforced; response, choice, reaction, and ready phases synchronize.",
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
