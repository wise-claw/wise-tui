import { expect, test } from "bun:test";
import { neighborRepositoryPaths } from "./neighborRepositoryPaths";

test("neighborRepositoryPaths returns adjacent workspace paths", () => {
  const paths = ["/work/a", "/work/b", "/work/c"];
  expect(neighborRepositoryPaths("/work/b", paths)).toEqual(["/work/a", "/work/c"]);
  expect(neighborRepositoryPaths("/work/a", paths)).toEqual(["/work/b"]);
  expect(neighborRepositoryPaths("/work/c", paths)).toEqual(["/work/b"]);
  expect(neighborRepositoryPaths("/missing", paths)).toEqual([]);
  expect(neighborRepositoryPaths("  ", paths)).toEqual([]);
});
