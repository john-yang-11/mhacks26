import { SenderError } from "spacetimedb/server";
import { CIV_IDS, type CivId } from "../../packages/game-core/src/types";
import type { Ctx } from "./schema";

export const roomCode = (value: string) => {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(normalized))
    throw new SenderError("Use a six-character room code.");
  return normalized;
};

export const civilization = (value: string): CivId => {
  if (!CIV_IDS.includes(value as CivId))
    throw new SenderError("Unknown civilization.");
  return value as CivId;
};

export function getWorld(ctx: Ctx, id: string) {
  const row = ctx.db.world.id.find(roomCode(id));
  if (!row) throw new SenderError("World not found.");
  return row;
}

export function getSeat(ctx: Ctx, worldId: string) {
  const value = [...ctx.db.seat.iter()].find(
    (candidate) =>
      candidate.worldId === worldId && candidate.identity.isEqual(ctx.sender),
  );
  if (!value)
    throw new SenderError("Claim a civilization in this world first.");
  return value;
}

export function assertHost(ctx: Ctx, world: ReturnType<typeof getWorld>) {
  if (!world.host.isEqual(ctx.sender))
    throw new SenderError("Only the host can do that.");
}

export function assertRevision(
  world: ReturnType<typeof getWorld>,
  expected: number,
) {
  if (world.revision !== expected)
    throw new SenderError("The world changed. Refresh and retry.");
}
