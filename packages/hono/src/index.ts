import { Hono, type Context } from "hono";

import type { SyncRequest, SyncResult } from "@regular-software/sync-protocol";

export type SyncHonoEngine<TContext = undefined> = {
  syncSince(
    request: SyncRequest,
    context: TContext,
  ): SyncResult | Promise<SyncResult>;
  getVersion?(): number;
};

export type SyncContextResolver<TContext> = (
  context: Context,
) => TContext | Promise<TContext>;

export type SyncEventListener = (version: number) => void;

export class SyncEventHub {
  private readonly listeners = new Set<SyncEventListener>();
  private lastVersion = 0;

  subscribe(listener: SyncEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(version: number): void {
    if (version <= this.lastVersion) {
      return;
    }

    this.lastVersion = version;

    for (const listener of this.listeners) {
      listener(version);
    }
  }
}

export function createSyncHono<TContext = undefined>(options: {
  engine: SyncHonoEngine<TContext>;
  getContext?: SyncContextResolver<TContext>;
  events?: SyncEventHub;
  pollIntervalMs?: number;
}): { app: Hono; events: SyncEventHub; stop(): void } {
  const events = options.events ?? new SyncEventHub();
  const app = new Hono();

  app.get("/sync", async (context) => {
    const version = Number(context.req.query("version"));
    const replicaId = context.req.query("replicaId");
    const schemaVersion = Number(context.req.query("schemaVersion"));
    const schemaFingerprint = context.req.query("schemaFingerprint");

    if (
      !Number.isSafeInteger(version) ||
      version < 0 ||
      !Number.isSafeInteger(schemaVersion) ||
      schemaVersion <= 0 ||
      schemaFingerprint === undefined
    ) {
      return context.json({ error: "Invalid synchronization request" }, 400);
    }

    try {
      const resolvedContext = options.getContext
        ? await options.getContext(context)
        : undefined;

      return context.json(
        await options.engine.syncSince(
          {
            version,
            ...(replicaId ? { replicaId } : {}),
            schemaVersion,
            schemaFingerprint,
          },
          resolvedContext as TContext,
        ),
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === "SyncSchemaMismatchError"
      ) {
        const expected = (error as Error & { expected?: unknown }).expected;
        return context.json({ error: error.message, expected }, 409);
      }

      throw error;
    }
  });

  app.get("/sync-events", (context) => {
    const encoder = new TextEncoder();
    let closed = false;
    let unsubscribe = () => {};
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;

    const close = () => {
      if (closed) {
        return;
      }

      closed = true;
      unsubscribe();

      if (heartbeat) {
        clearInterval(heartbeat);
      }

      controller?.close();
    };

    const stream = new ReadableStream<Uint8Array>({
      start(nextController) {
        controller = nextController;
        unsubscribe = events.subscribe((version) => {
          if (!closed) {
            controller?.enqueue(encoder.encode(`data: ${version}\n\n`));
          }
        });
        heartbeat = setInterval(() => {
          if (!closed) {
            controller?.enqueue(encoder.encode(": heartbeat\n\n"));
          }
        }, 30_000);
        context.req.raw.signal.addEventListener("abort", close, { once: true });
      },
      cancel: close,
    });

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream",
      },
    });
  });

  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const poll =
    options.engine.getVersion && pollIntervalMs > 0
      ? setInterval(() => {
          events.publish(options.engine.getVersion?.() ?? 0);
        }, pollIntervalMs)
      : undefined;

  poll?.unref?.();

  return {
    app,
    events,
    stop() {
      if (poll) {
        clearInterval(poll);
      }
    },
  };
}
