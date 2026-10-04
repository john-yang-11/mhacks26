import { schema, table, t, type ReducerCtx } from "spacetimedb/server";

export const world = table(
  { name: "world", public: true },
  {
    id: t.string().primaryKey(),
    host: t.identity(),
    revision: t.u32(),
    status: t.string(),
    round: t.u32(),
    phase: t.string(),
    mode: t.string(),
    started: t.bool(),
    snapshotJson: t.string(),
    updatedMicros: t.u64(),
  },
);

export const worldState = table(
  { name: "world_state" },
  {
    worldId: t.string().primaryKey(),
    stateJson: t.string(),
  },
);

export const seat = table(
  { name: "seat", public: true },
  {
    id: t.string().primaryKey(),
    worldId: t.string().index("btree"),
    identity: t.identity(),
    civ: t.string(),
    ready: t.bool(),
    joinedMicros: t.u64(),
  },
);

export const quizTimer = table(
  { name: "quiz_timer" },
  {
    id: t.string().primaryKey(),
    worldId: t.string().index("btree"),
    questionId: t.string(),
    startedMicros: t.u64(),
  },
);

export const database = schema({ world, worldState, seat, quizTimer });
export type Ctx = ReducerCtx<typeof database.schemaType>;
