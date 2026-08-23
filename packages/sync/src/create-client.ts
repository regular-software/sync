import type { SyncClientOptions } from "./client";
import { SyncClientBuilder } from "./builder";

export function createSyncClient(options: SyncClientOptions) {
  return new SyncClientBuilder(options);
}
