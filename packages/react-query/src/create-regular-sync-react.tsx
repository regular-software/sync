import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { SyncTable } from "@regular-sync/client";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";

type RowOf<Table> = Table extends SyncTable<infer Row> ? Row : never;

type AnyTable = {
  definition: {
    name: string;
  };

  getAll(): Promise<unknown[]>;

  subscribe(listener: () => void): () => void;

  start(): Promise<void>;
};

export function createRegularSyncReact<Sync extends object>(
  getSync: () => Promise<Sync>,
) {
  type TableName = {
    [Key in keyof Sync]: Sync[Key] extends AnyTable ? Key : never;
  }[keyof Sync] &
    string;

  type RowOfTable<Name extends TableName> =
    Sync[Name] extends import("@regular-sync/client").SyncTable<
      infer Row extends Record<string, unknown>
    >
      ? Row
      : never;

  const Context = createContext(false);

  function RegularSyncProvider({ children }: { children: ReactNode }) {
    return <Context.Provider value={true}>{children}</Context.Provider>;
  }

  function useRegularSyncContext() {
    const enabled = useContext(Context);

    if (!enabled) {
      throw new Error("RegularSyncProvider is missing");
    }
  }

  function useSyncQuery<Name extends TableName>(tableName: Name) {
    type Row = RowOf<Sync[Name]>;

    useRegularSyncContext();

    const [table, setTable] = useState<AnyTable>();

    const queryClient = useQueryClient();

    const queryKey = ["regular-sync", tableName] as const;

    useEffect(() => {
      void getSync().then((sync) => {
        setTable(sync[tableName] as AnyTable);
      });
    }, [tableName]);

    const query = useQuery<Row[]>({
      queryKey,
      enabled: !!table,
      networkMode: "always",
      queryFn: async () => {
        return (await table!.getAll()) as Row[];
      },
    });

    useEffect(() => {
      if (!table) {
        return;
      }

      const unsubscribe = table.subscribe(() => {
        void queryClient.invalidateQueries({
          queryKey,
        });
      });

      void table.start();

      return unsubscribe;
    }, [queryClient, table, tableName]);

    return query;
  }

  function useSyncMutation<Name extends TableName>(tableName: Name) {
    useRegularSyncContext();

    const queryClient = useQueryClient();

    return useMutation({
      mutationFn: async (row: RowOfTable<Name>) => {
        const sync = await getSync();

        const table = sync[tableName] as {
          mutate(row: RowOfTable<Name>): Promise<void>;
        };

        await table.mutate(row);
      },

      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: ["regular-sync", tableName],
        });
      },

      networkMode: "always",
    });
  }

  return {
    RegularSyncProvider,
    useSyncQuery,
    useSyncMutation,
  };
}
