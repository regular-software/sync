import type { SyncTable } from "./table";

export type MutationAck = {
  version: number;
};

export type MutationContext = {
  mutationId: string;
};

export type OptimisticEffect =
  | {
      operation: "put";
      tableName: string;
      row: Record<string, unknown>;
    }
  | {
      operation: "delete";
      tableName: string;
      rowId: string;
    };

type TableName<Tables> = {
  [Name in keyof Tables]: Tables[Name] extends SyncTable<any> ? Name : never;
}[keyof Tables] &
  string;

type RowOf<Table> = Table extends SyncTable<infer Row> ? Row : never;

export type OptimisticTransaction<Tables> = {
  put<Name extends TableName<Tables>>(
    tableName: Name,
    row: RowOf<Tables[Name]>,
  ): void;

  delete<Name extends TableName<Tables>>(
    tableName: Name,
    rowId: string,
  ): void;
};

export type MutationDefinition<Tables, Input> = {
  optimistic?: (
    input: Input,
    transaction: OptimisticTransaction<Tables>,
  ) => void;

  execute(input: Input, context: MutationContext): Promise<MutationAck>;
};

export function collectOptimisticEffects<Tables, Input>(
  definition: MutationDefinition<Tables, Input>,
  input: Input,
): OptimisticEffect[] {
  const effects: OptimisticEffect[] = [];

  if (!definition.optimistic) {
    return effects;
  }

  const result: unknown = definition.optimistic(input, {
    put(tableName, row) {
      effects.push({ operation: "put", tableName, row });
    },
    delete(tableName, rowId) {
      effects.push({ operation: "delete", tableName, rowId });
    },
  });

  if (
    typeof result === "object" &&
    result !== null &&
    "then" in result &&
    typeof result.then === "function"
  ) {
    throw new Error("Optimistic mutation callbacks must be synchronous");
  }

  return effects;
}
