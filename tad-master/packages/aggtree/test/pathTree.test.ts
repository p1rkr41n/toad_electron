import * as sqlite3 from "sqlite3";
import * as reltab from "reltab";
import * as aggtree from "../src/aggtree";
import { PathTree } from "../src/PathTree";
import * as reltabSqlite from "reltab-sqlite";
import { textSpanContainsPosition, textSpanContainsTextSpan } from "typescript";
import { delimiter } from "path";
import * as log from "loglevel";
import * as util from "./testUtils";

test("basic pathTree", () => {
  const pt0 = new PathTree();

  const pt1 = pt0.open(["foo", "bar", "baz"]);

  log.debug("pt1: ", pt1._rep);

  const pt2 = pt1.open(["foo", "bar", "blech"]).open(["a", "b", "c"]);

  log.debug("pt2: ", pt2._rep);

  for (let path of pt2.iter()) {
    log.debug(path);
  }

  const pt2Paths = Array.from(pt2.iter());
  log.debug("pt2Paths: ", pt2Paths);
  expect(pt2Paths).toMatchInlineSnapshot(`
    [
      [
        "foo",
      ],
      [
        "foo",
        "bar",
      ],
      [
        "foo",
        "bar",
        "baz",
      ],
      [
        "foo",
        "bar",
        "blech",
      ],
      [
        "a",
      ],
      [
        "a",
        "b",
      ],
      [
        "a",
        "b",
        "c",
      ],
    ]
  `);
});
