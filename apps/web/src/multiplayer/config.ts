export interface MultiplayerConfig {
  uri: string;
  database: string;
}

const LOCAL_URI = "ws://127.0.0.1:3001";
const LOCAL_DATABASE = "rising-waters-v2-local";

export function multiplayerConfig(
  env: Record<string, string | undefined> = process.env,
): MultiplayerConfig {
  const uri = env.NEXT_PUBLIC_SPACETIME_URI;
  const database = env.NEXT_PUBLIC_SPACETIME_DATABASE;
  const production = env.NODE_ENV === "production";
  if (production && (!uri || !database))
    throw new Error(
      "Multiplayer is not configured. Set NEXT_PUBLIC_SPACETIME_URI and NEXT_PUBLIC_SPACETIME_DATABASE before building.",
    );
  if (production && /(?:127\.0\.0\.1|localhost)/.test(uri ?? ""))
    throw new Error("Production multiplayer cannot use a localhost database.");
  return {
    uri: uri || LOCAL_URI,
    database: database || LOCAL_DATABASE,
  };
}
