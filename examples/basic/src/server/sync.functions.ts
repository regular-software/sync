import { createServerFn } from "@tanstack/react-start";
import type { SyncResult } from "@regular-software/sync-protocol";

import { sync } from "./sync.server";

export const pullSync = createServerFn({ method: "GET" })
  .validator((version: number) => version)
  .handler(async ({ data: version }): Promise<SyncResult> => {
    return sync.syncSince(version);
  });
