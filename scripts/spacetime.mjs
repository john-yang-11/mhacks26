import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";

const operation = process.argv[2];
if (!["start", "publish", "generate"].includes(operation)) {
  console.error("Usage: node scripts/spacetime.mjs <start|publish|generate>");
  process.exit(2);
}

const portable =
  process.platform === "win32"
    ? ".tools/spacetime/spacetimedb-cli.exe"
    : ".tools/spacetime/spacetime";
const usesPortable = !process.env.SPACETIME_CLI && existsSync(portable);
const cli =
  process.env.SPACETIME_CLI || (usesPortable ? portable : "spacetime");
const root = ["--root-dir=.tools/config"];
const database = process.env.SPACETIME_DATABASE || "rising-waters-local";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.error?.code === "ENOENT") {
    console.error(
      "SpacetimeDB 2.10.2 was not found. Install it from https://spacetimedb.com/install",
    );
    process.exit(127);
  }
  if (result.error) throw result.error;
  if (result.status) process.exit(result.status);
}

const localCurrent =
  process.platform === "win32"
    ? ".tools/config/bin/current/spacetimedb-cli.exe"
    : ".tools/config/bin/current/spacetimedb-cli";
if (!usesPortable && !existsSync(localCurrent)) {
  run(cli, [...root, "version", "install", "2.10.2"]);
  run(cli, [...root, "version", "use", "2.10.2"]);
}

const version = spawnSync(cli, [...root, "--version"], {
  encoding: "utf8",
  shell: false,
});
if (version.error?.code === "ENOENT") {
  console.error(
    "SpacetimeDB 2.10.2 was not found. Install it from https://spacetimedb.com/install",
  );
  process.exit(127);
}
const versionText = `${version.stdout ?? ""}${version.stderr ?? ""}`.trim();
const installedVersion =
  versionText.match(
    /(?:tool version|spacetimedb-cli)\s+v?(\d+\.\d+\.\d+)/i,
  )?.[1] ?? versionText.match(/\bv?(\d+\.\d+\.\d+)\b/)?.[1];
if (installedVersion !== "2.10.2") {
  console.error(
    `Rising Waters requires SpacetimeDB 2.10.2; found: ${versionText}`,
  );
  process.exit(1);
}

if (operation === "start") {
  run(cli, [
    ...root,
    "start",
    "--listen-addr",
    "127.0.0.1:3001",
    "--data-dir",
    ".tools/data",
    "--non-interactive",
  ]);
} else if (operation === "publish") {
  run(cli, [
    ...root,
    "publish",
    database,
    "--module-path",
    "spacetime",
    "--server",
    "http://127.0.0.1:3001",
    "--yes=skip-login",
    "--delete-data=never",
    "--no-config",
  ]);
} else {
  run(cli, [
    ...root,
    "generate",
    "--lang",
    "typescript",
    "--out-dir",
    "apps/web/src/module_bindings",
    "--module-path",
    "spacetime",
  ]);
  run(process.platform === "win32" ? "npx.cmd" : "npx", [
    "--prefix",
    "apps/web",
    "prettier",
    "--write",
    "apps/web/src/module_bindings",
  ]);
}
