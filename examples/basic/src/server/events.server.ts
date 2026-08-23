import { sync } from "./sync.server";

type Listener = (version: number) => void;

const listeners = new Set<Listener>();

let lastVersion = sync.getVersion();

export function subscribe(listener: Listener) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function publish(version: number) {
  lastVersion = Math.max(lastVersion, version);

  for (const listener of listeners) {
    listener(version);
  }
}

setInterval(() => {
  const version = sync.getVersion();

  if (version > lastVersion) {
    publish(version);
  }
}, 1000);
