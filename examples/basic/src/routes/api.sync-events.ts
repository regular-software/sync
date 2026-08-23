import { createFileRoute } from "@tanstack/react-router";

import { subscribe } from "../server/events.server";

export const Route = createFileRoute("/api/sync-events")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const encoder = new TextEncoder();

        const stream = new ReadableStream({
          start(controller) {
            const unsubscribe = subscribe((version) => {
              controller.enqueue(encoder.encode(`data: ${version}\n\n`));
            });

            const heartbeat = setInterval(() => {
              controller.enqueue(encoder.encode(`: heartbeat\n\n`));
            }, 30_000);

            request.signal.addEventListener("abort", () => {
              clearInterval(heartbeat);
              unsubscribe();
              controller.close();
            });
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});
