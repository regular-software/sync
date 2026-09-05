# Release

These packages are 0.x releases; APIs may change between minor versions.
Node.js 20+ is required. `sync-server` and `sync-drizzle` use the native
`better-sqlite3` dependency, so supported Node platforms must have its
prebuilt binary or a working native build toolchain.

## One-time setup

On npm.org, create or confirm the `regular-software` organization, give the
release account publish access to all eight packages, enable 2FA for writes,
and configure package access as public. In the GitHub repository settings,
enable the npm trusted publisher for workflow `.github/workflows/publish.yml`
on the `regular-software/sync` repository. The workflow uses GitHub Actions
OIDC and npm provenance; no long-lived npm token is required.

## Checklist

1. Update all eight package versions together.
2. Run `pnpm install --frozen-lockfile`, typecheck, tests, and build.
3. Run `pnpm release:check` and `pnpm package:smoke`.
4. Commit the preparation changes.
5. Create the annotated tag `sync-v<version>`.
6. Push the commit and tag.
7. Let the tag workflow publish in dependency order with public access.
8. Verify npm package pages and tarballs.

Do not run `npm publish` from a local checkout unless the tag workflow is
intentionally being replaced.
