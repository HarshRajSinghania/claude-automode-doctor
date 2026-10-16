// The table of test/auto-table.mjs put to the real Claude Code binary, in auto mode, at zero tokens (see auto-oracle.mjs).
// On the versions the rows were recorded from (2.1.299 and 2.1.295) every row must give the recorded answer. A newer version
// may change something, and then the rows that matter most (the `core` ones) must still agree and at least 95 in 100 of all
// of them; the rest are listed as diagnostics, so a drift is seen in the CI log without every release turning the job red.
import test from "node:test";
import assert from "node:assert/strict";
import { claudeInfo, skip } from "./claude-sandbox.mjs";
import { askAll } from "./auto-oracle.mjs";
import { rows } from "./auto-table.mjs";

const RECORDED = ["2.1.299", "2.1.295"];
const wanted = (row, version) => {
  if (version === "2.1.295" && row.v295) return row.v295;
  if (process.platform !== "win32" && row.posix) return row.posix;
  return row.expect;
};

test("the decision table put to the binary: every row", { skip: skip(), timeout: 1800000 }, async (t) => {
  const version = claudeInfo().number;
  const known = RECORDED.includes(version);
  const mine = rows.filter((r) => !(r.platform === "win32" && process.platform !== "win32") && !r.offline);
  const results = await askAll(mine, { limit: process.platform === "win32" ? 6 : 4 });
  const differ = [];
  mine.forEach((row, i) => {
    const got = results[i];
    const want = wanted(row, version);
    if (got.outcome !== want) differ.push({ row, got, want });
    else if (known && want === "static" && row.reasonType && got.reasonType !== row.reasonType) differ.push({ row, got, want: `${want}/${row.reasonType}` });
  });
  const show = (d) => `${d.row.id} ${JSON.stringify(d.row.command)}: expected ${d.want}, the binary did ${d.got.outcome}${d.got.reasonType ? `/${d.got.reasonType}` : ""} (${d.got.text.replace(/\s+/g, " ").slice(0, 80)})`;
  t.diagnostic(`Claude Code ${claudeInfo().version}: ${mine.length - differ.length} of ${mine.length} rows gave the recorded answer`);
  for (const d of differ) t.diagnostic(`  differs: ${show(d)}`);
  const none = results.filter((r) => r.outcome === "none").length;
  assert.equal(none, 0, `${none} runs never reached the call`);
  if (known) assert.deepEqual(differ.map(show), []);
  else {
    assert.deepEqual(differ.filter((d) => d.row.core).map(show), [], "the core rows");
    assert.ok(differ.length / mine.length <= 0.05, `${differ.length} of ${mine.length} rows differ on Claude Code ${version}`);
  }
});
