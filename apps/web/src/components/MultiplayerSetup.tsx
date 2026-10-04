"use client";
import type { CivId } from "@/game/types";

export default function MultiplayerSetup({
  choice,
  mode,
  seed,
  roomCode,
  setRoomCode,
  status,
  error,
  connect,
}: {
  choice: CivId;
  mode: "solo" | "hotseat";
  seed: string;
  roomCode: string;
  setRoomCode: (code: string) => void;
  status: string;
  error: string;
  connect: (
    code: string,
    civ: CivId,
    seed?: number,
    solo?: boolean,
  ) => Promise<void>;
}) {
  const create = () => {
    const id = Array.from(
      crypto.getRandomValues(new Uint8Array(6)),
      (value) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[value % 32],
    ).join("");
    setRoomCode(id);
    const randomSeed = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
    void connect(id, choice, Number(seed) || randomSeed, mode === "solo");
  };

  return (
    <div className="ls-option-group online-setup">
      <b>PLAY A SHARED WORLD</b>
      <p>
        Live rooms use SpacetimeDB Maincloud in production. Each player should
        join from a separate device or browser profile.
      </p>
      <label>
        Room code{" "}
        <input
          aria-label="Room code"
          maxLength={6}
          value={roomCode}
          onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
          placeholder="ABC123"
        />
      </label>
      <div className="setup-footer">
        <button onClick={create}>
          Create {mode === "solo" ? "saved solo" : "multiplayer"} world
        </button>
        <button onClick={() => void connect(roomCode, choice)}>
          Join / reconnect
        </button>
      </div>
      <span role="status">{status}</span>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
