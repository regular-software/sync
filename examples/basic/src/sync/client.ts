import { createBrowserSync } from "@regular-software/sync-browser";
import { defineTable } from "@regular-software/sync";

import { mutateTodo } from "../server/todos.functions";
import { pullSync } from "../server/sync.functions";

type Todo = {
  id: string;
  title: string;
  completed: number;
};

const todos = defineTable<Todo>({
  primaryKey: "id",

  mutations: {
    mutate: async (todo, { mutationId }) => {
      await mutateTodo({
        data: {
          mutationId,
          todo,
        },
      });
    },
  },
});

export const getSync = createBrowserSync({
  database: "regular-sync-basic",

  pull: async (version) => {
    return pullSync({
      data: version,
    });
  },
})
  .register("todos", todos)
  .build();
