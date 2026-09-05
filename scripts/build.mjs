import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packages = ["protocol", "sync", "indexeddb", "browser", "server", "hono", "drizzle", "react-query"];
const tsc = resolve(root, "node_modules/typescript/bin/tsc");

for (const name of packages) {
  const dir = join(root, "packages", name);
  const source = join(dir, "src");
  const dist = join(dir, "dist");
  rmSync(dist, { recursive: true, force: true });
  const files = readdirSync(source)
    .filter((file) => /\.(ts|tsx)$/.test(file) && !file.endsWith(".test.ts"))
    .map((file) => join(source, file));
  execFileSync(process.execPath, [tsc, ...files, "--declaration", "--emitDeclarationOnly", "--isolatedDeclarations", "false", "--target", "ES2022", "--module", "ESNext", "--moduleResolution", "bundler", "--lib", "ES2022,DOM", "--types", "node", "--strict", "--skipLibCheck", "--verbatimModuleSyntax", "--jsx", "react-jsx", "--rootDir", source, "--outDir", dist], { cwd: dir, stdio: "inherit" });
  const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  await build({ entryPoints: [join(source, "index.ts")], bundle: true, format: "esm", outfile: join(dist, "index.js"), packages: "external", external: [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})], logLevel: "warning" });
  if (!existsSync(join(dist, "index.d.ts"))) throw new Error(`${name}: declaration entrypoint was not built`);
}
