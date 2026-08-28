export class RetryableMutationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RetryableMutationError";
  }
}

export class PendingMutationsBlockSchemaUpgradeError extends Error {
  constructor() {
    super("Pending mutations must be synchronized before upgrading the sync schema");
    this.name = "PendingMutationsBlockSchemaUpgradeError";
  }
}

export class IncompatibleSyncSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncompatibleSyncSchemaError";
  }
}

export class RetryableSyncError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RetryableSyncError";
  }
}
