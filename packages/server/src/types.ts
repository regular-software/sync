export type Mutation = {
  id: string;
  run: () => void;
  auditHook?: (version: number) => void;
};
