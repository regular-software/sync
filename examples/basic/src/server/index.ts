import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { resolve } from "node:path";
import { Hono } from "hono";
import { createSyncHono } from "@regular-software/sync-hono";

import type { CreateInvoiceInput } from "../invoices";
import { createInvoiceOnServer } from "./invoices.server";
import { events, sync } from "./sync.server";

type CreateInvoiceRequest = {
  mutationId: string;
  input: CreateInvoiceInput;
};

const app = new Hono();
const clientRoot = resolve(process.cwd(), "dist/client");
const syncTransport = createSyncHono({ engine: sync.engine, events });

app.route("/api", syncTransport.app);

app.post("/api/mutations/create-invoice", async (context) => {
  const request = await context.req.json<CreateInvoiceRequest>();

  if (!request || typeof request.mutationId !== "string" || !request.input) {
    return context.json({ error: "Invalid mutation request" }, 400);
  }

  return context.json(
    createInvoiceOnServer(request.mutationId, request.input),
  );
});

app.use("*", serveStatic({ root: clientRoot }));
app.get(
  "*",
  serveStatic({
    root: clientRoot,
    rewriteRequestPath: () => "/index.html",
  }),
);

const portArgument = process.argv.indexOf("--port");
const port = Number(
  portArgument >= 0 ? process.argv[portArgument + 1] : process.env.PORT ?? 3000,
);

if (!Number.isSafeInteger(port) || port <= 0) {
  throw new Error("Invalid server port");
}

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Regular Sync example listening on http://localhost:${info.port}`);
});

function shutdown() {
  syncTransport.stop();
  server.close(() => process.exit(0));

  if ("closeAllConnections" in server) {
    server.closeAllConnections();
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
