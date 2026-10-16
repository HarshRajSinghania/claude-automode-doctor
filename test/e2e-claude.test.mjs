// Checks against the real Claude Code binary, run only when E2E_CLAUDE points at one (see claude-sandbox.mjs).
// They are the proof of what the README says Claude Code does:
//   a. every kind of decision the transcript records (scenarios.mjs): who decided, the fields written, what the model was
//      told, the JSON result, how many classifier requests the fake API saw, and what `report` says about each line;
//   b. the autoMode block: "$defaults", the files it is read from, wrong types, and `claude auto-mode config` against `show`;
//   c. the traps lint reports: the premises of the three bad interactions, permissions.disableAutoMode;
//   d. what a classified command costs: the request sizes `cost` quotes;
//   e. the plugin: it validates, /automode-doctor:check hands the model the report, and what it costs is measured;
//   f. suggest: a rule it writes makes the same command skip the classifier.
// The decision table for `why` is in test/auto-oracle.test.mjs.
// Everything runs against a fake API on 127.0.0.1: no model is reached, no token is spent, nothing leaves the machine, and
// every run has its own throwaway HOME, USERPROFILE and CLAUDE_CONFIG_DIR.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, run } from "./helpers.mjs";
import { claudeInfo, claudeSync, fakeApi, put, runClaude, sandbox, severity, skip, stage2, systemText, textBlocks, userText } from "./claude-sandbox.mjs";
import { SCENARIOS, finishScenario, runScenario } from "./scenarios.mjs";
import { buildReport } from "../src/aggregate.mjs";
import { MEASURED } from "../src/measured.mjs";

const IS_WIN = process.platform === "win32";
const fwd = (p) => p.replace(/\\/g, "/");

// The request of a run that carries the prompt (a version may send other requests too, for a title or a quota check)
const mainRequest = (api) => api.conversation()[0];

test("the binary: its version is recorded for the README", { skip: skip() }, (t) => {
  t.diagnostic(`Claude Code ${claudeInfo().version} on ${process.platform}, Node ${process.version}`);
  assert.match(claudeInfo().version, /^\d+\.\d+\.\d+/);
});

// ---- the plugin validates ---------------------------------------------------------------------------------------------------

test("claude plugin validate accepts the plugin, also with --strict", { skip: skip(), timeout: 180000 }, async () => {
  const sb = sandbox("validate");
  for (const args of [["plugin", "validate", ROOT], ["plugin", "validate", ROOT, "--strict"], ["plugin", "validate", path.join(ROOT, ".claude-plugin", "plugin.json"), "--strict"]]) {
    const r = await runClaude(sb, null, args);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /Validation passed/);
  }
});

// ---- (a) the decisions ----------------------------------------------------------------------------------------------------------

for (const sc of SCENARIOS) {
  test(`scenario ${sc.name}: ${sc.about}`, { skip: skip(), timeout: sc.slow ? 240000 : 150000 }, async () => {
    const r = await runScenario(sc);
    try {
      const e = sc.expect;
      assert.equal(r.calls.length, 1, `the call reached the model's tool result once: ${r.run.err.slice(0, 300)}`);
      const c = r.calls[0];
      // the fields Claude Code wrote on the tool_result line
      assert.equal(c.decision && c.decision.decision, e.decision, `permissionDecision.decision: ${JSON.stringify(c.decision)}`);
      assert.equal(c.decision && c.decision.source, e.permSource, "permissionDecision.source");
      assert.equal(c.decision && (c.decision.reasonType ?? null), e.reasonType, "permissionDecision.reasonType");
      assert.equal(c.kind, e.kind, "toolDenialKind");
      assert.equal(c.classifierBoundary, e.boundary, "classifierBoundary");
      assert.equal(c.serverReview, e.server, "serverClassifierContext");
      if (e.text) assert.match(c.text, e.text, "what the model was told");
      // the JSON result lists a refused call
      const refused = e.decision === "reject";
      assert.equal(r.run.result.permission_denials.length, refused ? 1 : 0, "permission_denials");
      // the classifier requests the fake API saw
      assert.equal(r.classifier.length, e.classifier, `classifier requests: ${r.classifier.length}`);
      // and what the tool says about the line it wrote
      const rep = buildReport({ configDir: r.sb.cfg, days: 3650 });
      assert.equal(rep.decisions.length, 1);
      const d = rep.decisions[0];
      assert.equal(d.source, e.source, `report: source ${d.source}`);
      assert.equal(d.result, e.result, `report: result ${d.result}`);
      if (e.via) assert.equal(d.via, e.via, "report: via");
      if (e.category !== undefined) assert.equal(d.category, e.category, "report: category");
      if (e.cause) { assert.equal(d.cause, e.cause, "report: cause"); assert.equal(d.service, e.service, "report: service"); }
      if (e.detail) assert.equal(rep.noVerdict[0].detail, e.detail, "report: the category in parentheses");
    } finally { await finishScenario(r); }
  });
}
