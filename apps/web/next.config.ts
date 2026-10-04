import type { NextConfig } from "next";
import path from "node:path";
const config: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: { root: path.resolve(process.cwd(), "../..") },
};
export default config;
