import { createFileRoute } from "@tanstack/react-router";
import { useSyncMutation, useSyncQuery } from "../sync/react";
import { useState } from "react";
import { Logo } from "#/logo";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const [title, setTitle] = useState("");

  const { data: todos } = useSyncQuery("todos");
  const { mutate } = useSyncMutation("todos");

  function handleAddTodo() {
    const trimmed = title.trim();

    if (!trimmed) {
      return;
    }

    mutate({
      id: crypto.randomUUID(),
      title: trimmed,
      completed: 0,
    });

    setTitle("");
  }

  return (
    <main className="mx-auto max-w-xl p-8">
      <div className="h-12 w-auto">
        <Logo />
      </div>

      <div className="mt-8 flex gap-2">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void handleAddTodo();
            }
          }}
          placeholder="Add a todo"
          className="flex-1 rounded-lg border px-3 py-2"
        />

        <button
          onClick={() => void handleAddTodo()}
          className="rounded-lg bg-black px-4 py-2 text-white"
        >
          Add
        </button>
      </div>

      <div className="mt-8 space-y-2">
        {todos?.map((todo) => (
          <div key={todo.id} className="rounded-lg border p-3">
            {todo.title}
          </div>
        ))}
      </div>
    </main>
  );
}
