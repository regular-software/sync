import { createServerFn } from "@tanstack/react-start";

import { db } from "./db.server";
import { publish } from "./events.server";
import { sync } from "./sync.server";

type TodoInput = {
  id: string;
  title: string;
  completed: number;
};

type MutateTodoInput = {
  mutationId: string;
  todo: TodoInput;
};

export const mutateTodo = createServerFn({ method: "POST" })
  .validator((input: MutateTodoInput) => input)
  .handler(async ({ data }) => {
    const { mutationId, todo } = data;

    const version = sync.mutate({
      id: mutationId,

      run: () => {
        db.prepare(
          `
          INSERT INTO todos (id, title, completed)
          VALUES (?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            completed = excluded.completed
          `,
        ).run(todo.id, todo.title, todo.completed);
      },
    });

    publish(version);

    return {
      version,
    };
  });
