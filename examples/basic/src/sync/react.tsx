import { createRegularSyncReact } from "@regular-sync/react-query";

import { getSync } from "./client";

export const { RegularSyncProvider, useSyncQuery, useSyncMutation } =
  createRegularSyncReact(getSync);
