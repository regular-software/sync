import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";
import { RegularSyncProvider } from "./sync/react";
import "./styles.css";

const queryClient = new QueryClient();
const root = document.getElementById("root");

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker
    .register("/sw.js", { scope: "/", updateViaCache: "none" })
    .catch((error: unknown) => {
      console.error("Failed to register the service worker", error);
    });
}

if (!root) {
  throw new Error("Root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RegularSyncProvider>
        <App />
      </RegularSyncProvider>
    </QueryClientProvider>
  </StrictMode>,
);
