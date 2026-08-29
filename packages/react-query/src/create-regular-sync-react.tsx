import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type {
  MutationFailure,
  SyncStatus,
  SyncTable,
} from "@regular-software/sync";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { createQueryRefresh } from "./query-refresh";

type RowOf<Table> = Table extends SyncTable<infer Row> ? Row : never;

type AnyTable = {
  definition: {
    name: string;
  };

  getAll(): Promise<unknown[]>;

  subscribe(listener: () => void): () => void;

  start(): Promise<void>;
};

type StatusSync = {
  getStatus(): SyncStatus;
  subscribeStatus(listener: () => void): () => void;
  start(): Promise<void>;
  getMutationFailures(): Promise<MutationFailure[]>;
  acknowledgeMutationFailure(id: string): Promise<void>;
  subscribeMutationFailures(listener: () => void): () => void;
};

const loadingStatus: SyncStatus = {
  lifecycle: "starting",
  activity: "idle",
  connectivity: "unknown",
  pendingMutations: 0,
  failedMutations: 0,
};

export function createRegularSyncReact<Sync extends object>(
  getSync: () => Promise<Sync>,
) {
  type TableName = {
    [Key in keyof Sync]: Sync[Key] extends AnyTable ? Key : never;
  }[keyof Sync] &
    string;

  type MutationName = Sync extends {
    mutations: infer Mutations;
  }
    ? keyof Mutations & string
    : never;

  type MutationInput<Name extends MutationName> = Sync extends {
    mutations: infer Mutations;
  }
    ? Mutations[Name] extends (input: infer Input) => Promise<void>
      ? Input
      : never
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
      networkMode: "always",
      queryFn: async () => {
        const sync = await getSync();
        const queryTable = sync[tableName] as AnyTable;

        return (await queryTable.getAll()) as Row[];
      },
    });

    useEffect(() => {
      if (!table) {
        return;
      }

      const queryRefresh = createQueryRefresh(queryClient, queryKey);

      const unsubscribe = table.subscribe(() => {
        queryRefresh.refresh();
      });

      void table.start();

      return () => {
        unsubscribe();
        queryRefresh.dispose();
      };
    }, [queryClient, table, tableName]);

    return query;
  }

  function useSyncMutation<Name extends MutationName>(mutationName: Name) {
    useRegularSyncContext();

    return useMutation({
      mutationFn: async (input: MutationInput<Name>) => {
        const sync = await getSync();
        const mutation = (sync as Sync & {
          mutations: Record<
            Name,
            (input: MutationInput<Name>) => Promise<void>
          >;
        }).mutations[mutationName];

        await mutation(input);
      },

      networkMode: "always",
    });
  }

  function useSyncStatus(): SyncStatus {
    useRegularSyncContext();

    const [sync, setSync] = useState<StatusSync>();

    useEffect(() => {
      let active = true;

      void getSync().then((builtSync) => {
        if (!active) {
          return;
        }

        const statusSync = builtSync as Sync & StatusSync;
        setSync(statusSync);
        void statusSync.start().catch(() => {});
      });

      return () => {
        active = false;
      };
    }, []);

    return useSyncExternalStore(
      sync
        ? (listener) => sync.subscribeStatus(listener)
        : () => () => {},
      sync ? () => sync.getStatus() : () => loadingStatus,
      () => loadingStatus,
    );
  }

  function useSyncMutationFailures() {
    useRegularSyncContext();
    const queryClient = useQueryClient();
    const queryKey = ["regular-sync-mutation-failures"] as const;
    const query = useQuery<MutationFailure[]>({
      queryKey,
      networkMode: "always",
      queryFn: async () => {
        const sync = (await getSync()) as Sync & StatusSync;
        return sync.getMutationFailures();
      },
    });

    useEffect(() => {
      let unsubscribe = () => {};
      let active = true;

      void getSync().then((builtSync) => {
        if (!active) return;
        const sync = builtSync as Sync & StatusSync;
        unsubscribe = sync.subscribeMutationFailures(() => {
          void queryClient.invalidateQueries({ queryKey });
        });
      });

      return () => {
        active = false;
        unsubscribe();
      };
    }, [queryClient]);

    return {
      ...query,
      acknowledge: async (id: string) => {
        const sync = (await getSync()) as Sync & StatusSync;
        await sync.acknowledgeMutationFailure(id);
      },
    };
  }

  return {
    RegularSyncProvider,
    useSyncQuery,
    useSyncMutation,
    useSyncStatus,
    useSyncMutationFailures,
  };
}
