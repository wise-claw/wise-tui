import { expect, test } from "bun:test";
import { prefetchRepositorySession, subscribeRepositorySessionPrefetch } from "./repositorySessionPrefetch";

test("预加载只通知当前订阅者，忽略空路径并在卸载后停止", () => {
  const paths: string[] = [];
  const unsubscribe = subscribeRepositorySessionPrefetch((path) => paths.push(path));
  prefetchRepositorySession("  ");
  prefetchRepositorySession(" /repos/wise ");
  unsubscribe();
  prefetchRepositorySession("/repos/other");
  expect(paths).toEqual(["/repos/wise"]);
});
