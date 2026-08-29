import type { SyncClientBuilder } from "../src/index";
import { defineTable } from "../src/index";

type Todo = {
  id: string;
  title: string;
};

type Project = {
  id: string;
  name: string;
};

declare const builder: SyncClientBuilder;

const clientPromise = builder
  .register("todos", defineTable<Todo>({ primaryKey: "id" }))
  .register("projects", defineTable<Project>({ primaryKey: "id" }))
  .mutation("createTodo", {
    optimistic: (todo: Todo, transaction, { mutationId }) => {
      mutationId satisfies string;
      transaction.put("todos", todo);

      // @ts-expect-error Projects require a Project row.
      transaction.put("projects", todo);

      // @ts-expect-error The table is not registered.
      transaction.delete("missing", todo.id);
    },
    execute: async () => ({ version: 1 }),
  })
  .build();

void clientPromise.then((client) => {
  const status = client.getStatus();

  status.activity satisfies "idle" | "pushing" | "pulling";
  status.pendingMutations satisfies number;
  status.failedMutations satisfies number;
  client.subscribeStatus(() => {});
  void client.getMutationFailures();
  client.subscribeMutationFailures(() => {});

  void client.mutations.createTodo({ id: "todo-1", title: "Todo" });

  // @ts-expect-error The mutation name is not registered.
  void client.mutations.missing({});

  // @ts-expect-error createTodo requires a Todo.
  void client.mutations.createTodo({ id: "todo-1" });
});
