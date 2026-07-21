import { expectTypeOf, test } from "vitest";

import type {
  SearchProfileRepository,
  SystemWorkerQueue,
  UserRepositories,
  UserRepositoryProvider
} from "./repositories.ts";

test("hosted repositories are asynchronous and user-scoped", () => {
  expectTypeOf<UserRepositories["searchProfiles"]["getById"]>().returns.toMatchTypeOf<
    Promise<Awaited<ReturnType<SearchProfileRepository["getById"]>>>
  >();
  expectTypeOf<UserRepositoryProvider["forUser"]>().parameter(0).toMatchTypeOf<string>();
  expectTypeOf<UserRepositoryProvider["transaction"]>().returns.toMatchTypeOf<Promise<unknown>>();
  expectTypeOf<SystemWorkerQueue>().not.toHaveProperty("searchProfiles");
  expectTypeOf<UserRepositories>().not.toHaveProperty("workerQueue");
});
