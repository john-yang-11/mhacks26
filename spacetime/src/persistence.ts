import { SenderError } from "spacetimedb/server";
import type {
  GameState,
  PublicGameState,
} from "../../packages/game-core/src/types";
import type { getWorld } from "./auth";
import type { Ctx } from "./schema";

type WorldRow = ReturnType<typeof getWorld>;

export function loadState(ctx: Ctx, worldId: string): GameState {
  const row = ctx.db.worldState.worldId.find(worldId);
  if (!row) throw new SenderError("World state is unavailable.");
  return JSON.parse(row.stateJson) as GameState;
}

export function publicSnapshot(state: GameState): PublicGameState {
  const { seed, rng: _rng, ...visible } = state;
  const visualSeed = Math.imul(seed ^ 0x6d2b79f5, 0x85ebca6b) >>> 0;
  return { ...visible, visualSeed };
}

export function saveWorld(
  ctx: Ctx,
  row: WorldRow,
  state: GameState,
  fields: Partial<Pick<WorldRow, "status" | "started">> = {},
) {
  ctx.db.worldState.worldId.update({
    worldId: row.id,
    stateJson: JSON.stringify(state),
  });
  ctx.db.world.id.update({
    ...row,
    ...fields,
    revision: row.revision + 1,
    status: state.phase === "ended" ? "ended" : (fields.status ?? row.status),
    round: state.round,
    phase: state.phase,
    snapshotJson: JSON.stringify(publicSnapshot(state)),
    updatedMicros: ctx.timestamp.microsSinceUnixEpoch,
  });
}
