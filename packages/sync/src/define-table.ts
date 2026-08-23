export type MutationContext = {
  mutationId: string;
};

export type TableDefinition<Row extends Record<string, unknown>> = {
  primaryKey: keyof Row & string;

  mutations?: {
    mutate?: (row: Row, context: MutationContext) => Promise<void>;
  };
};

export function defineTable<Row extends Record<string, unknown>>(
  definition: TableDefinition<Row>,
) {
  return definition;
}
