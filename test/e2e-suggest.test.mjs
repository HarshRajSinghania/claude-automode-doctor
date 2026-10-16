// Checks against the real Claude Code binary (run only when E2E_CLAUDE points at one) about what the tool reads and writes:
//   report, over the transcript of a real session of several calls with a decision of every source in it, and why, which has
//   to agree with what the binary did with each of those calls;
//   suggest: two sessions in which the check gave no verdict, the allow rule it writes, and that the same command then skips
//   the classifier; restore puts the settings file back.
// The fake API on 127.0.0.1 answers (it refuses `mytool deploy`, allows the rest); no token is spent, and every run has its
// own throwaway HOME, USERPROFILE and CLAUDE_CONFIG_DIR.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { runCli } from "./helpers.mjs";
import { callsOf, fakeApi, put, runClaude, sandbox, severity, skip, stage2, userText } from "./claude-sandbox.mjs";

const bash = (command) => ({ tool: "Bash", input: { command, description: "probe" } });
// the tool's own process, in the sandbox's world
const cli = (sb, args) => runCli(args, { cwd: sb.work, env: { CLAUDE_CONFIG_DIR: sb.cfg, HOME: sb.home, USERPROFILE: sb.home, CLAUDE_AUTOMODE_DOCTOR_MANAGED_DIR: sb.managed } });
const ARGS = ["-p", "run it", "--output-format", "json", "--permission-mode", "auto"];

test("report over a real session of six calls: one decision of each kind, counted by source, and why agrees with each of them", { skip: skip(), timeout: 300000 }, async (t) => {
  const sb = sandbox("report-real");
  put(sb.user, { permissions: { allow: ["Bash(mytool status)"] } });
  const api = await fakeApi({
    calls: [bash("echo PROBE-1"), { tool: "Write", input: { file_path: "note.txt", content: "hi" } }, bash("mytool build --release"), bash("mytool deploy --prod"), bash("mytool deploy --prod"), bash("mytool status")],
    // the classifier refuses what deploys, and allows the rest
    stage1: (req) => (JSON.stringify(req.messages).includes("mytool deploy") ? severity(95) : severity(5)),
    stage2: (req) => (JSON.stringify(req.messages).includes("mytool deploy") ? stage2(90, "Code from External") : stage2(5)),
  });
  try {
    const r = await runClaude(sb, api, [...ARGS, "--max-turns", "9"], { timeout: 240000 });
    assert.equal(r.code, 0, r.err);
    assert.equal(callsOf(sb).length, 6, "six calls reached the model's tool results");
    // plain `report` exits 1 when the classifier refused something; --markdown always exits 0
    const plain = cli(sb, ["report", "--project", sb.work, "--json"]);
    assert.equal(plain.code, 1, plain.err);
    const j = JSON.parse(plain.out);
    assert.equal(j.total, 6);
    assert.deepEqual(Object.fromEntries(Object.entries(j.sources).map(([k, v]) => [k, v.total])), { static: 1, mode: 1, rule: 1, classifier: 3 });
    assert.deepEqual(j.classifier, { total: 3, allowed: 1, refused: 2, noVerdict: 0, client: 3, server: 0 });
    assert.equal(j.refused.length, 1, "the same command twice is one entry");
    assert.equal(j.refused[0].count, 2);
    assert.equal(j.refused[0].category, "Code from External");
    assert.equal(j.refused[0].subject, "mytool deploy --prod");
    assert.equal(j.sessions.length, 1);
    const md = cli(sb, ["report", "--project", sb.work, "--markdown"]);
    assert.equal(md.code, 0, "--markdown always exits 0");
    assert.match(md.out, /6 tool decisions in 1 session/);
    assert.match(md.out, /Classifier: 3 \(1 allowed, 2 refused, 0 no verdict; 3 by Claude Code's own requests, 0 by the server's review\)/);
    assert.match(md.out, /- 2x \[Code from External\] Bash: mytool deploy --prod/);
    // why says, for each command, what the binary did with it
    const outcome = (c) => JSON.parse(cli(sb, ["why", c, "--project", sb.work, "--json"]).out).outcome;
    assert.equal(outcome("echo PROBE-1"), "static");
    assert.equal(outcome("mytool build --release"), "classifier");
    assert.equal(outcome("mytool deploy --prod"), "classifier");
    assert.equal(outcome("mytool status"), "static");
    t.diagnostic(`six calls, ${api.classifier().length} classifier requests, report: ${JSON.stringify(j.classifier)}`);
  } finally { await api.close(); }
});

test("suggest: two sessions in which the check gave no verdict, the allow rule it writes, and the same command then skips the classifier; restore puts the file back", { skip: skip(), timeout: 400000 }, async () => {
  const sb = sandbox("suggest");
  const command = "mytool deploy --prod";
  const before = { env: { KEEP: "1" } };
  put(sb.user, before);
  const original = fs.readFileSync(sb.user, "utf8");
  // stage one blocks, stage two fails: the check did not judge the command (a no verdict, not a refusal)
  const failing = () => fakeApi({ calls: [bash(command)], stage1: severity(95), stage2: { sse: "not a message body" } });
  for (let i = 0; i < 2; i++) {
    const api = await failing();
    try {
      const r = await runClaude(sb, api, [...ARGS, "--max-turns", "2"]);
      assert.equal(r.code, 0, r.err);
      assert.equal(api.classifier().length, 2, "both stages were asked");
    } finally { await api.close(); }
  }
  const proposal = JSON.parse(cli(sb, ["suggest", "--project", sb.work, "--json"]).out);
  assert.equal(proposal.proposals.length, 1);
  const p = proposal.proposals[0];
  assert.equal(p.rule, "Bash(mytool *)");
  assert.equal(p.count, 2);
  assert.equal(p.noVerdict, 2);
  assert.equal(p.judged, 0);
  assert.equal(p.skipsClassifier, true);
  // a dry run writes nothing
  const dry = cli(sb, ["suggest", "--project", sb.work, "--write", "--user", "--dry-run"]);
  assert.equal(dry.code, 0, dry.err);
  assert.match(dry.out, /Would add 1 allow rule/);
  assert.equal(fs.readFileSync(sb.user, "utf8"), original);
  // the write: the file is saved next to itself first, and only permissions.allow changes
  const wrote = cli(sb, ["suggest", "--project", sb.work, "--write", "--user"]);
  assert.equal(wrote.code, 0, wrote.err);
  assert.match(wrote.out, /Added 1 allow rule/);
  const after = JSON.parse(fs.readFileSync(sb.user, "utf8"));
  assert.deepEqual(after, { env: { KEEP: "1" }, permissions: { allow: ["Bash(mytool *)"] } });
  const backups = fs.readdirSync(sb.cfg).filter((n) => n.startsWith("settings.json.bak-automode-doctor-"));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(`${sb.cfg}/${backups[0]}`, "utf8"), original);
  // the same command again: the binary does not ask the classifier, and runs the command
  const api = await failing();
  try {
    const r = await runClaude(sb, api, [...ARGS, "--max-turns", "2"]);
    assert.equal(r.code, 0, r.err);
    assert.equal(api.classifier().length, 0, "the rule skips the classifier");
    assert.equal(r.result.permission_denials.length, 0, "and nothing was refused");
    // the transcripts of the three sessions are read in the order of their file names: pick the calls by what was decided
    const calls = callsOf(sb);
    assert.equal(calls.length, 3);
    assert.equal(calls.filter((c) => c.decision.decision === "reject").length, 2, "the two sessions before the rule");
    const accepted = calls.filter((c) => c.decision.decision === "accept");
    assert.equal(accepted.length, 1, "and the one after it");
    assert.equal(accepted[0].decision.source, "config", "a prefix rule is judged part by part, like the rule-allow-prefix scenario");
    assert.equal(accepted[0].decision.reasonType, "subcommandResults");
  } finally { await api.close(); }
  // restore puts the file back, and can itself be undone
  const restored = cli(sb, ["restore", "--user"]);
  assert.equal(restored.code, 0, restored.err);
  assert.equal(fs.readFileSync(sb.user, "utf8"), original);
});

test("from the third refusal in a row the call is asked instead, and so is every one after it until the classifier allows something", { skip: skip(), timeout: 400000 }, async (t) => {
  const lastAction = (req) => { const text = userText(req); return text.slice(text.lastIndexOf('{"Bash"')); };
  const refuses = (req) => /blk-/.test(lastAction(req));
  const kinds = async (commands) => {
    const sb = sandbox("rows");
    const api = await fakeApi({ calls: commands.map(bash), stage1: (req) => (refuses(req) ? severity(95) : severity(5)), stage2: (req) => (refuses(req) ? stage2(95, "Git Destructive") : stage2(5)) });
    try {
      const r = await runClaude(sb, api, [...ARGS, "--max-turns", "12"], { timeout: 300000 });
      assert.equal(r.code, 0, r.err);
      return { kinds: callsOf(sb).map((c) => c.kind), requests: api.classifier().length };
    } finally { await api.close(); }
  };
  const five = await kinds(["blk-1", "blk-2", "blk-3", "blk-4", "blk-5"]);
  t.diagnostic(`five refusals in a row: ${five.kinds.join(", ")}; ${five.requests} classifier requests`);
  assert.deepEqual(five.kinds, ["automode-blocked", "automode-blocked", "user-rejected", "user-rejected", "user-rejected"]);
  assert.equal(five.requests, 10, "the classifier was asked about all five, two requests each");
  const mixed = await kinds(["blk-1", "blk-2", "ok-3", "blk-4", "blk-5", "ok-6"]);
  t.diagnostic(`two refusals, an allowed call, two refusals, an allowed call: ${mixed.kinds.join(", ")}`);
  assert.deepEqual(mixed.kinds, ["automode-blocked", "automode-blocked", null, "automode-blocked", "automode-blocked", null], "an allowed call starts the count again");
});
