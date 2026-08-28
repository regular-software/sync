export type SyncLifecycle = "starting" | "running" | "stopped";

export type SyncActivity = "idle" | "pushing" | "pulling";

export type SyncConnectivity =
  | "unknown"
  | "online"
  | "offline"
  | "unreachable";

export type SyncStatus = {
  lifecycle: SyncLifecycle;
  activity: SyncActivity;
  connectivity: SyncConnectivity;
  pendingMutations: number;
  failedMutations: number;
  lastSyncedAt?: number;
  error?: unknown;
};

export const initialSyncStatus: SyncStatus = {
  lifecycle: "stopped",
  activity: "idle",
  connectivity: "unknown",
  pendingMutations: 0,
  failedMutations: 0,
};
