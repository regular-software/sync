import type { SyncRequest, SyncResult } from "@regular-software/sync-protocol";
import {
  IncompatibleSyncSchemaError,
  RetryableMutationError,
} from "./errors";
import type {
  MutationAck,
  MutationContext,
  OptimisticEffect,
} from "./mutation";
import type {
  MutationFailure,
  MutationFailureError,
  QueuedMutation,
  SyncStore,
} from "./store";
import {
  initialSyncStatus,
  type SyncConnectivity,
  type SyncStatus,
} from "./status";

export type Pull = (request: SyncRequest) => Promise<SyncResult>;
export type Subscribe = (onChange: () => void) => () => void;

export type Connectivity = {
  getCurrent(): SyncConnectivity;
  subscribe(listener: (connectivity: SyncConnectivity) => void): () => void;
};

export type RetryOptions = {
  initialDelayMs?: number;
  multiplier?: number;
  maximumDelayMs?: number;
  jitter?: number;
  random?: () => number;
};

export type SyncClientOptions = {
  pull: Pull;
  store: SyncStore;
  schemaVersion: number;
  subscribe?: Subscribe;
  connectivity?: Connectivity;
  retry?: RetryOptions;
};

type MutationHandler = (
  input: unknown,
  context: MutationContext,
) => Promise<MutationAck>;

const defaultRetry = {
  initialDelayMs: 1_000,
  multiplier: 2,
  maximumDelayMs: 30_000,
  jitter: 0.2,
};

export class SyncClient {
  private listeners = new Set<() => void>();
  private statusListeners = new Set<() => void>();
  private mutationFailureListeners = new Set<() => void>();
  private mutationHandlers = new Map<string, MutationHandler>();
  private pullTail: Promise<void> = Promise.resolve();
  private activePulls = 0;
  private activePushes = 0;
  private syncPromise?: Promise<void>;
  private syncRequested = false;
  private started = false;
  private retryAttempt = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private unsubscribeFromServer?: () => void;
  private unsubscribeFromConnectivity?: () => void;
  private status: SyncStatus = initialSyncStatus;

  constructor(private options: SyncClientOptions) {
    if (!Number.isSafeInteger(options.schemaVersion) || options.schemaVersion <= 0) {
      throw new Error("schemaVersion must be a positive safe integer");
    }
  }

  async initialize() {
    const [request, queued] = await Promise.all([
      this.options.store.getSyncRequest(),
      this.options.store.mutations.getAll(),
    ]);

    if (request.schemaVersion !== this.options.schemaVersion) {
      throw new IncompatibleSyncSchemaError(
        "Sync store and client schemaVersion do not match",
      );
    }

    for (const mutation of queued) {
      if (!this.mutationHandlers.has(mutation.name)) {
        throw new IncompatibleSyncSchemaError(
          `Pending mutation "${mutation.name}" has no registered handler`,
        );
      }
    }

    await this.refreshMutationCounts();
  }

  registerMutationHandler<Input>(
    name: string,
    handler: (
      input: Input,
      context: MutationContext,
    ) => Promise<MutationAck>,
  ) {
    this.mutationHandlers.set(name, handler as MutationHandler);
  }

  pull(): Promise<SyncResult> {
    const pull = this.pullTail.then(() => this.pullOnce());
    this.pullTail = pull.then(
      () => undefined,
      () => undefined,
    );
    return pull;
  }

  private async pullOnce(): Promise<SyncResult> {
    this.beginActivity("pulling");

    try {
      const request = await this.options.store.getSyncRequest();
      const result = await this.options.pull(request);
      this.validatePullResult(request, result);
      const applied = await this.options.store.apply(result);

      await this.refreshMutationCounts();
      this.updateStatus({
        connectivity: "online",
        error: undefined,
        lastSyncedAt: Date.now(),
      });

      if (applied.changed) this.notify();
      if (applied.reset) {
        this.syncRequested = true;

        if (this.started && !this.syncPromise) {
          queueMicrotask(() => this.requestSync());
        }
      }
      return result;
    } catch (error) {
      this.updateStatus({
        connectivity:
          error instanceof IncompatibleSyncSchemaError
            ? this.getConnectivity() === "offline"
              ? "offline"
              : "online"
            : this.getFailureConnectivity(),
        error,
      });
      throw error;
    } finally {
      this.endActivity("pulling");
    }
  }

  private validatePullResult(request: SyncRequest, result: SyncResult) {
    if (!Number.isSafeInteger(result.version) || result.version < 0) {
      throw new IncompatibleSyncSchemaError(
        "Pull returned an invalid synchronization version",
      );
    }

    if (
      result.schemaVersion !== request.schemaVersion ||
      result.schemaFingerprint !== request.schemaFingerprint
    ) {
      throw new IncompatibleSyncSchemaError(
        "Pull returned an incompatible synchronization schema",
      );
    }

    const reset = result.kind === "snapshot" && result.resetReason !== undefined;

    if (result.version < request.version && !reset) {
      throw new IncompatibleSyncSchemaError(
        `Pull returned version ${result.version} for version ${request.version}`,
      );
    }

    if (request.version === 0 && result.kind !== "snapshot") {
      throw new IncompatibleSyncSchemaError(
        "A version zero pull must return a snapshot",
      );
    }

    if (
      request.replicaId !== undefined &&
      request.replicaId !== result.replicaId &&
      !(result.kind === "snapshot" && result.resetReason === "replica-changed")
    ) {
      throw new IncompatibleSyncSchemaError(
        "A changed server replica must return a reset snapshot",
      );
    }
  }

  async start() {
    if (this.started) {
      this.requestSync();
      return;
    }

    this.started = true;
    this.updateStatus({
      lifecycle: "running",
      connectivity: this.getConnectivity(),
    });

    if (this.options.subscribe && !this.unsubscribeFromServer) {
      this.unsubscribeFromServer = this.options.subscribe(() => {
        this.requestSync();
      });
    }

    if (this.options.connectivity && !this.unsubscribeFromConnectivity) {
      this.unsubscribeFromConnectivity = this.options.connectivity.subscribe(
        (connectivity) => {
          this.updateStatus({
            connectivity:
              connectivity === "offline"
                ? "offline"
                : this.status.connectivity === "offline"
                  ? "unknown"
                  : this.status.connectivity,
          });

          if (connectivity !== "offline") this.requestSync();
        },
      );
    }

    this.requestSync();
  }

  private requestSync() {
    if (!this.started) return;
    this.clearRetryTimer();
    this.syncRequested = true;
    if (!this.syncPromise) this.syncPromise = this.runSyncLoop();
  }

  private async runSyncLoop(): Promise<void> {
    try {
      do {
        this.syncRequested = false;
        const retryableMutationError = await this.flushMutations();
        if (retryableMutationError) throw retryableMutationError;
        await this.pull();
      } while (this.syncRequested);

      this.retryAttempt = 0;
    } catch (error) {
      this.updateStatus({ error });
      if (
        !(error instanceof IncompatibleSyncSchemaError) &&
        !this.syncRequested
      ) {
        this.scheduleRetry();
      }
    } finally {
      this.syncPromise = undefined;
      if (this.syncRequested && this.started && !this.retryTimer) {
        this.requestSync();
      }
    }
  }

  stop() {
    this.unsubscribeFromServer?.();
    this.unsubscribeFromServer = undefined;
    this.unsubscribeFromConnectivity?.();
    this.unsubscribeFromConnectivity = undefined;
    this.clearRetryTimer();
    this.started = false;
    this.syncRequested = false;
    this.updateStatus({ lifecycle: "stopped", activity: "idle" });
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  subscribeStatus(listener: () => void) {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  async getMutationFailures(): Promise<MutationFailure[]> {
    return this.options.store.mutations.getFailures();
  }

  async acknowledgeMutationFailure(id: string): Promise<void> {
    await this.options.store.mutations.acknowledgeFailure(id);
    await this.refreshMutationCounts();
    this.notifyMutationFailures();
  }

  subscribeMutationFailures(listener: () => void) {
    this.mutationFailureListeners.add(listener);
    return () => this.mutationFailureListeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }

  private notifyMutationFailures() {
    for (const listener of this.mutationFailureListeners) listener();
  }

  async mutate<Input>(
    name: string,
    input: Input,
    effects: OptimisticEffect[],
  ): Promise<void> {
    if (!this.mutationHandlers.has(name)) {
      throw new Error(`No mutation configured with name "${name}"`);
    }

    await this.options.store.mutations.add({
      id: crypto.randomUUID(),
      name,
      input,
      effects,
      createdAt: Date.now(),
    });
    await this.refreshMutationCounts();
    this.notify();

    if (this.started) this.requestSync();
    else void this.start();
  }

  private validateAck(name: string, ack: MutationAck): number {
    if (!Number.isSafeInteger(ack.version) || ack.version < 0) {
      throw new Error(
        `Mutation "${name}" returned an invalid synchronization version`,
      );
    }
    return ack.version;
  }

  private async flushMutations(): Promise<unknown> {
    const queued = await this.options.store.mutations.getAll();
    this.updateStatus({ pendingMutations: queued.length });
    if (!queued.some((mutation) => mutation.acknowledgedVersion === undefined)) {
      return;
    }

    this.beginActivity("pushing");
    try {
      return await this.flushQueuedMutations(queued);
    } finally {
      this.endActivity("pushing");
    }
  }

  private async flushQueuedMutations(
    queued: QueuedMutation[],
  ): Promise<unknown> {
    for (const mutation of queued) {
      if (mutation.acknowledgedVersion !== undefined) continue;

      const handler = this.mutationHandlers.get(mutation.name);
      if (!handler) {
        throw new IncompatibleSyncSchemaError(
          `Pending mutation "${mutation.name}" has no registered handler`,
        );
      }

      try {
        const ack = await handler(mutation.input, { mutationId: mutation.id });
        const version = this.validateAck(mutation.name, ack);
        await this.options.store.mutations.acknowledge(mutation.id, version);
        this.updateStatus({ connectivity: "online" });
      } catch (error) {
        if (error instanceof RetryableMutationError) {
          this.updateStatus({
            connectivity: this.getFailureConnectivity(),
            error,
          });
          return error;
        }

        await this.rejectMutation(mutation, error);
      }
    }
  }

  private async rejectMutation(
    mutation: QueuedMutation,
    error: unknown,
  ): Promise<void> {
    const failure: MutationFailure = {
      id: mutation.id,
      name: mutation.name,
      input: mutation.input,
      createdAt: mutation.createdAt,
      failedAt: Date.now(),
      error: normalizeMutationError(error),
    };

    await this.options.store.mutations.fail(mutation.id, failure);
    await this.refreshMutationCounts();
    this.updateStatus({ error });
    this.notify();
    this.notifyMutationFailures();
  }

  private scheduleRetry() {
    if (!this.started || this.retryTimer || this.getConnectivity() === "offline") {
      return;
    }

    const retry = { ...defaultRetry, ...this.options.retry };
    const baseDelay = Math.min(
      retry.maximumDelayMs,
      retry.initialDelayMs * retry.multiplier ** this.retryAttempt,
    );
    const random = this.options.retry?.random?.() ?? Math.random();
    const jitterFactor = 1 + (random * 2 - 1) * retry.jitter;
    const delay = Math.max(0, Math.round(baseDelay * jitterFactor));
    this.retryAttempt += 1;

    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.requestSync();
    }, delay);
  }

  private clearRetryTimer() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  private getConnectivity(): SyncConnectivity {
    return this.options.connectivity?.getCurrent() ?? this.status.connectivity;
  }

  private getFailureConnectivity(): SyncConnectivity {
    return this.getConnectivity() === "offline" ? "offline" : "unreachable";
  }

  private async refreshMutationCounts() {
    const [mutations, failures] = await Promise.all([
      this.options.store.mutations.getAll(),
      this.options.store.mutations.getFailures(),
    ]);
    this.updateStatus({
      pendingMutations: mutations.length,
      failedMutations: failures.length,
    });
  }

  private beginActivity(activity: "pushing" | "pulling") {
    if (activity === "pushing") this.activePushes += 1;
    else this.activePulls += 1;
    this.refreshActivity();
  }

  private endActivity(activity: "pushing" | "pulling") {
    if (activity === "pushing") this.activePushes -= 1;
    else this.activePulls -= 1;
    this.refreshActivity();
  }

  private refreshActivity() {
    const activity =
      this.activePushes > 0
        ? "pushing"
        : this.activePulls > 0
          ? "pulling"
          : "idle";
    this.updateStatus({ activity });
  }

  private updateStatus(update: Partial<SyncStatus>) {
    const next = { ...this.status, ...update };
    if (
      next.lifecycle === this.status.lifecycle &&
      next.activity === this.status.activity &&
      next.connectivity === this.status.connectivity &&
      next.pendingMutations === this.status.pendingMutations &&
      next.failedMutations === this.status.failedMutations &&
      next.lastSyncedAt === this.status.lastSyncedAt &&
      next.error === this.status.error
    ) {
      return;
    }

    this.status = next;
    for (const listener of this.statusListeners) listener();
  }
}

function normalizeMutationError(error: unknown): MutationFailureError {
  const value = error as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    status?: unknown;
  };

  return {
    name: typeof value?.name === "string" ? value.name : "Error",
    message:
      typeof value?.message === "string" ? value.message : "Mutation failed",
    ...(typeof value?.code === "string" ? { code: value.code } : {}),
    ...(typeof value?.status === "number" ? { status: value.status } : {}),
  };
}
