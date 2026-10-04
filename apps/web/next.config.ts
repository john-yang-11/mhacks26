import type { NextConfig } from "next";
import path from "node:path";

if (process.env.VERCEL) {
  const uri = process.env.NEXT_PUBLIC_SPACETIME_URI;
  const database = process.env.NEXT_PUBLIC_SPACETIME_DATABASE;
  if (!uri || !database)
    throw new Error(
      "Vercel requires NEXT_PUBLIC_SPACETIME_URI and NEXT_PUBLIC_SPACETIME_DATABASE.",
    );
  if (/(?:127\.0\.0\.1|localhost)/.test(uri))
    throw new Error("Vercel cannot use a localhost SpacetimeDB URI.");
}

const config: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: { root: path.resolve(process.cwd(), "../..") },
};
export default config;
