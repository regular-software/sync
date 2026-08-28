import { createRegularSyncReact } from "@regular-software/sync-react-query";

import { getSync } from "./client";

export const {
  RegularSyncProvider,
  useSyncQuery,
  useSyncMutation,
  useSyncStatus,
} = createRegularSyncReact(getSync);
