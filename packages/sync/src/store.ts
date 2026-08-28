import type {
  SyncRequest,
  SyncResult,
  SyncTable,
} from "@regular-software/sync-protocol";
import type { OptimisticEffect } from "./mutation";

export type QueuedMutation<Input = unknown> = {
  sequence?: number;
  id: string;
  name: string;
  input: Input;
  effects: OptimisticEffect[];
  createdAt: number;
  acknowledgedVersion?: number;
};

export type MutationFailureError = {
  name: string;
  message: string;
  code?: string;
  status?: number;
};

export type MutationFailure<Input = unknown> = {
  id: string;
  name: string;
  input: Input;
  createdAt: number;
  failedAt: number;
  error: MutationFailureError;
};

export type SyncStoreSchema = {
  schemaVersion: number;
  tables: SyncTable[];
};

export interface MutationStore {
  add<Input>(mutation: QueuedMutation<Input>): Promise<void>;

  acknowledge(id: string, version: number): Promise<void>;

  remove(id: string): Promise<void>;

  fail(id: string, failure: MutationFailure): Promise<void>;

  getAll(): Promise<QueuedMutation[]>;

  getFailures(): Promise<MutationFailure[]>;

  acknowledgeFailure(id: string): Promise<void>;
}

export interface SyncStore {
  initializeSchema(schema: SyncStoreSchema): Promise<void>;
  getSyncRequest(): Promise<SyncRequest>;
  apply(result: SyncResult): Promise<{
    changed: boolean;
    confirmedMutationIds: string[];
    reset: boolean;
  }>;

  getAll<Row extends Record<string, unknown>>(table: SyncTable): Promise<Row[]>;

  get<Row extends Record<string, unknown>>(
    table: SyncTable,
    rowId: string,
  ): Promise<Row | undefined>;

  mutations: MutationStore;
}
