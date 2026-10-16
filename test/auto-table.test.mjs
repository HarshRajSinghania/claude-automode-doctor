// The table of test/auto-table.mjs against `why`, with no binary: what `why` says for each row must equal what the real
// binary did (the rows were recorded from Claude Code 2.1.299 and 2.1.295; test/auto-oracle.test.mjs runs them again).
import test from "node:test";
import assert from "node:assert/strict";
import { predict } from "./auto-oracle.mjs";
import { rows } from "./auto-table.mjs";

test("the table has the rows it says: hundreds, in every group, each with an answer", () => {
  assert.ok(rows.length >= 500, `${rows.length} rows`);
  const groups = new Set(rows.map((r) => r.group));
  for (const g of ["readonly", "edit", "classifier", "critical", "allow-wild", "ask", "deny", "dropped", "cas", "blockreads", "readdeny-cd", "editflags", "editforms"]) assert.ok(groups.has(g), g);
  for (const r of rows) assert.ok(["static", "classifier", "prompt", "refused"].includes(r.expect), `${r.id}: ${r.expect}`);
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, "the ids are unique");
});

test("every row: why says what the binary did", () => {
  const bad = [];
  let n = 0;
  for (const row of rows) {
    if (row.platform === "win32" && process.platform !== "win32") continue;
    // the rows were recorded on Windows; the one place a row differs on Linux and macOS says so in `posix`
    const want = process.platform !== "win32" && row.posix ? row.posix : row.expect;
    n++;
    const got = predict(row);
    if (got.outcome !== want) bad.push(`${row.id} ${JSON.stringify(row.command)}: binary ${want}, why ${got.outcome}/${got.basis}`);
    else if (want === "static" && row.reasonType === "mode" && got.basis !== "mode") bad.push(`${row.id} ${JSON.stringify(row.command)}: the mode approves it, why says ${got.basis}`);
  }
  assert.ok(n >= 500);
  assert.deepEqual(bad, []);
});
