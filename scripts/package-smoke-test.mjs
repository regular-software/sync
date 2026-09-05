import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packages = ["protocol", "sync", "indexeddb", "browser", "server", "hono", "drizzle", "react-query"];
const temp = mkdtempSync(join(tmpdir(), "regular-sync-smoke-"));
const npmEnv = { ...process.env, npm_config_cache: join(temp, ".npm-cache") };
try {
  execFileSync("npm", ["init", "-y", "--silent"], { cwd: temp, stdio: "inherit", env: npmEnv });
  execFileSync("npm", ["install", "--no-save", "--no-package-lock", "react@19.2.8"], { cwd: temp, stdio: "inherit", env: npmEnv });
  const tarballs = [];
  for (const name of packages) {
    const manifest = JSON.parse(readFileSync(join(root, "packages", name, "package.json"), "utf8"));
    execFileSync("pnpm", ["pack", "--pack-destination", temp], { cwd: join(root, "packages", name), stdio: "inherit", env: npmEnv });
    const filename = `${manifest.name.replace(/^@/, "").replace("/", "-")}-${manifest.version}.tgz`;
    tarballs.push(join(temp, filename));
  }
  execFileSync("npm", ["install", "--no-save", "--no-package-lock", ...tarballs], { cwd: temp, stdio: "inherit", env: npmEnv });
  for (const name of packages) {
    const manifest = JSON.parse(readFileSync(join(root, "packages", name, "package.json"), "utf8"));
    execFileSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(manifest.name)})`], { cwd: temp, stdio: "inherit" });
    console.log(`${manifest.name}: packed import ok`);
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
