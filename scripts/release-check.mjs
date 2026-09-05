import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const names = ["sync", "protocol", "browser", "indexeddb", "drizzle", "server", "hono", "react-query"];
const npmEnv = { ...process.env, npm_config_cache: "/tmp/regular-sync-npm-cache" };
const manifests = names.map((name) => JSON.parse(readFileSync(join(root, "packages", name, "package.json"), "utf8")));
const version = manifests[0].version;
if (version !== "0.3.0" || manifests.some((pkg) => pkg.version !== version || pkg.private || pkg.publishConfig?.access !== "public")) throw new Error("published packages must be public and synchronized at 0.3.0");
for (const [index, pkg] of manifests.entries()) {
  for (const field of ["name", "version", "description", "license", "type", "main", "module", "types", "exports", "files", "repository", "bugs", "homepage"]) if (!pkg[field]) throw new Error(`${pkg.name}: missing ${field}`);
  if (!pkg.files?.includes("dist") || pkg.types !== "./dist/index.d.ts" || pkg.exports?.["."]?.import !== "./dist/index.js") throw new Error(`${pkg.name}: invalid built entrypoints`);
  for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) for (const [name, spec] of Object.entries(pkg[section] ?? {})) if (spec.includes("workspace:") || spec.startsWith("file:") || spec.startsWith("link:") || spec === "catalog:") throw new Error(`${pkg.name}: non-publishable ${section} ${name}=${spec}`);
  const result = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: join(root, "packages", names[index]), encoding: "utf8", env: npmEnv }))[0];
  const files = result.files.map(({ path }) => path);
  if (!files.includes("dist/index.js") || !files.includes("dist/index.d.ts") || files.some((file) => file.includes(".test.") || file.startsWith("src/"))) throw new Error(`${pkg.name}: invalid tarball contents`);
  console.log(`${pkg.name}: ${files.length} files`);
}
