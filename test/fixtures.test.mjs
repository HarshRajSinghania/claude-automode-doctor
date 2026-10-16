// The fixtures of test/fixtures/: three transcript lines of each scenario, recorded from the real binary by
// test/record-fixtures.mjs. They are read here with the same code `report` uses, so the shapes the binary wrote are the shapes
// the tool is held to, on every machine, with no binary.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NOW, ROOT, run, world } from "./helpers.mjs";
import { SCENARIOS } from "./scenarios.mjs";
import { buildReport } from "../src/aggregate.mjs";
import { classify } from "../src/decisions.mjs";
import { readDecisions } from "../src/transcripts.mjs";

const FIX = path.join(ROOT, "test", "fixtures");

for (const sc of SCENARIOS) {
  test(`fixture ${sc.name}: read and classified as the scenario says`, () => {
    const file = path.join(FIX, `${sc.name}.jsonl`);
    const ds = readDecisions(file);
    assert.equal(ds.length, 1);
    const d = ds[0];
    const e = sc.expect;
    // the fields as recorded
    assert.equal(d.decision, e.decision);
    assert.equal(d.permSource, e.permSource);
    assert.equal(d.reasonType, e.reasonType);
    assert.equal(d.kind, e.kind);
    assert.equal(d.classifierBoundary, e.boundary);
    assert.equal(d.serverReview, e.server);
    assert.equal(d.mode, sc.mode || "auto");
    if (e.text) assert.match(d.text, e.text);
    // and what the report says of them
    const c = classify(d);
    assert.equal(c.source, e.source, "source");
    assert.equal(c.result, e.result, "result");
    if (e.via) assert.equal(c.via, e.via, "via");
    if (e.category !== undefined) assert.equal(c.category, e.category, "category");
    if (e.cause) assert.deepEqual([c.cause, c.service], [e.cause, e.service]);
  });
}

test("the fixtures together make a report: every source and every result of a classifier decision, with the commands that were refused", async () => {
  const w = world("fixtures");
  const dir = path.join(w.claude, "projects", "-home-me-shop");
  fs.mkdirSync(dir, { recursive: true });
  for (const sc of SCENARIOS) fs.copyFileSync(path.join(FIX, `${sc.name}.jsonl`), path.join(dir, `${sc.name}.jsonl`));
  const r = buildReport({ configDir: w.claude, days: 3650, now: NOW });
  assert.equal(r.total, SCENARIOS.length);
  assert.equal(r.sessions.length, SCENARIOS.length);
  const by = (key) => SCENARIOS.filter((s) => s.expect.source === key).length;
  for (const key of ["static", "mode", "rule", "hook", "safety", "user", "classifier"]) assert.equal(r.sources[key] ? r.sources[key].total : 0, by(key), key);
  const c = SCENARIOS.filter((s) => s.expect.source === "classifier");
  assert.deepEqual(r.classifier, { total: c.length, allowed: c.filter((s) => s.expect.result === "allowed").length, refused: c.filter((s) => s.expect.result === "refused").length, noVerdict: c.filter((s) => s.expect.result === "no-verdict").length, client: c.filter((s) => !s.expect.server && s.expect.via !== "server").length, server: c.filter((s) => s.expect.via === "server").length });
  // the scenarios that refuse all put the same command to the classifier: one command, refused as often as there are such scenarios
  assert.equal(r.refused.length, 1);
  assert.equal(r.refused[0].count, SCENARIOS.filter((s) => s.expect.source === "classifier" && s.expect.result === "refused").length);
  assert.ok(r.noVerdict.every((x) => x.service));
  const j = (await run(["report", "--since", "3650", "--json"], w, { now: NOW })).json();
  assert.equal(j.total, SCENARIOS.length);
});

test("the manifest names the Claude Code version the fixtures were recorded with, and every file in the folder is a scenario's", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(FIX, "manifest.json"), "utf8"));
  assert.equal(manifest.version, "2.1.299");
  assert.deepEqual(Object.keys(manifest.scenarios).sort(), SCENARIOS.map((s) => s.name).sort());
  assert.deepEqual(fs.readdirSync(FIX).filter((n) => n !== "manifest.json").sort(), SCENARIOS.map((s) => `${s.name}.jsonl`).sort());
});
