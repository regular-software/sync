export type TableDefinition<Row extends Record<string, unknown>> = {
  primaryKey: keyof Row & string;
};

export function defineTable<Row extends Record<string, unknown>>(
  definition: TableDefinition<Row>,
) {
  return definition;
}
