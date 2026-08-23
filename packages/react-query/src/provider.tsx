import { createContext, useContext, type ReactNode } from "react";

type GetSync<Sync> = () => Promise<Sync>;

const RegularSyncContext = createContext<GetSync<unknown> | undefined>(
  undefined,
);

export function RegularSyncProvider<Sync>({
  getSync,
  children,
}: {
  getSync: GetSync<Sync>;
  children: ReactNode;
}) {
  return (
    <RegularSyncContext.Provider value={getSync}>
      {children}
    </RegularSyncContext.Provider>
  );
}

export function useGetSync<Sync>() {
  const getSync = useContext(RegularSyncContext);

  if (!getSync) {
    throw new Error("RegularSyncProvider is missing");
  }

  return getSync as GetSync<Sync>;
}
