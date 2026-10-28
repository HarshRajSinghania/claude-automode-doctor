// The command line: every usage error, the exit codes, the JSON documents, and a run of the real entry point in a child process.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CLI, ROOT, run, runCli, world, writeTranscript } from "./helpers.mjs";
import { parseArgs } from "../src/cli.mjs";
import { VERSION } from "../src/version.mjs";

test("--version and --help", async () => {
  const w = world("help");
  assert.equal((await run(["--version"], w)).out, `${VERSION}\n`);
  assert.equal((await run(["-v"], w)).out, `${VERSION}\n`);
  const h = await run(["--help"], w);
  assert.equal(h.code, 0);
  for (const cmd of ["report", "why", "show", "lint", "cost", "suggest", "restore"]) assert.match(h.out, new RegExp(`^  ${cmd}\\s`, "m"), cmd);
  assert.match(h.out, /Exit codes: 0 ok; 1 findings or a refusal; 2 a usage error or an unexpected error\./);
});

test("usage errors exit 2 with a message, and with --json a JSON error", async () => {
  const w = world("usage");
  const bad = [
    [[], /a command is needed/], [["nonsense"], /unknown command nonsense/], [["report", "--wat"], /unknown option --wat/],
    [["report", "--since"], /--since needs a value/], [["report", "--since", "0"], /--since needs a number of days/], [["report", "--since", "x"], /--since needs a number of days/],
    [["report", "--since", "2026-13-40"], /--since needs a number of days, such as --since 7, or a date, such as --since 2026-10-01/],
    [["report", "--since", "2026-10-17"], /--since needs a number of days, such as --since 7, or a date, such as --since 2026-10-01/],
    [["report", "--session", "zz"], /--session needs a session id/], [["report", "--project"], /--project needs a folder/], [["report", "--user"], /--user does not belong to report/],
    [["report", "extra"], /report takes no arguments/], [["report", "--json=1"], /does not take a value/],
    [["why"], /why needs the command in quotes/], [["why", "ls", "--tool", "Zsh"], /--tool is Bash or PowerShell/], [["why", "ls", "--min", "2"], /--min does not belong to why/],
    [["show", "x"], /show takes no arguments/], [["show", "--markdown"], /--markdown does not belong to show/], [["lint", "--since", "3"], /--since does not belong to lint/],
    [["cost", "--write"], /--write does not belong to cost/], [["suggest", "--min", "0"], /--min needs a number/], [["suggest", "--dry-run"], /--dry-run belongs to --write/], [["suggest", "--include-judged"], /--include-judged belongs to --write/],
    [["suggest", "--write"], /suggest --write needs the settings file/], [["suggest", "--write", "--user", "--local"], /choose one settings file/],
    [["restore"], /restore needs the settings file/], [["restore", "--user", "--local"], /choose one settings file/], [["restore", "x", "--user"], /restore takes no arguments/],
  ];
  for (const [args, re] of bad) {
    const r = await run(args, w);
    assert.equal(r.code, 2, args.join(" "));
    assert.match(r.err, re, args.join(" "));
    assert.equal(r.out, "");
    const j = await run([...args, "--json"], w);
    assert.equal(j.code, 2);
    assert.equal(j.json().ok, false);
    assert.equal(j.err, "");
  }
  const both = await run(["report", "--json", "--markdown"], w);
  assert.equal(both.code, 2);
  assert.match(both.json().error, /cannot be combined/);
});

test("parseArgs: values, inline values, the command anywhere before the arguments", () => {
  const o = parseArgs(["report", "--project=/x y", "--since", "7", "--session", "ABCD-12", "--json"]);
  assert.deepEqual([o.command, o.project, o.since, o.session, o.json], ["report", "/x y", 7, "abcd-12", true]);
  const d = parseArgs(["report", "--since", "2026-10-01"]);
  assert.equal(d.since, "2026-10-01", "a date stays a date until the window is built");
  const w = parseArgs(["why", "git push origin main", "--tool", "PowerShell"]);
  assert.deepEqual([w.command, w.positional, w.tool], ["why", ["git push origin main"], "PowerShell"]);
});

test("the exit codes: show and cost are always 0; why is 1 when the command would be refused or asked about", async () => {
  const w = world("exit", { user: { permissions: { deny: ["Bash(curl *)"], ask: ["Bash(git push *)"] } } });
  assert.equal((await run(["show"], w)).code, 0);
  assert.equal((await run(["cost"], w)).code, 0);
  assert.equal((await run(["why", "ls"], w)).code, 0);
  assert.equal((await run(["why", "npm test"], w)).code, 0);
  const denied = await run(["why", "curl -s x"], w);
  assert.equal(denied.code, 1);
  assert.match(denied.out, /Refused by a deny rule, before the classifier/);
  assert.equal((await run(["why", "git push origin main"], w)).code, 1);
});

test("why: the answer, the rule and its file, the parts of a line, and the allow rule auto mode drops", async () => {
  const w = world("why", { user: { permissions: { allow: ["Bash(npm run *)", "Bash(git status)"], deny: ["Bash(rm -rf *)"] } } });
  let r = await run(["why", "npm run build"], w);
  assert.match(r.out, /Goes to the classifier\./);
  assert.match(r.out, /Bash\(npm run \*\) matched, and auto mode drops it/);
  assert.match(r.out, /A rule that would skip the classifier for it: Bash\(npm run build \*\)/);
  r = await run(["why", "git status && npm run build"], w);
  assert.match(r.out, /Parts/);
  r = await run(["why", "git status"], w);
  assert.match(r.out, /Approved without the classifier\./);
  assert.match(r.out, /rule: Bash\(git status\)\s+\(~\/\.claude\/settings\.json\)/);
  r = await run(["why", "rm -rf build"], w);
  assert.equal(r.code, 1);
  assert.match(r.out, /rule: Bash\(rm -rf \*\)/);
  const j = (await run(["why", "mkdir out", "--json"], w)).json();
  assert.deepEqual([j.outcome, j.basis], ["static", "mode"]);
  assert.equal(j.tool, "Bash");
});

test("why: several commands, the order, the exit code, and single command compatibility", async () => {
  const w = world("why-many", {
    user: {
      permissions: {
        allow: ["Bash(git status)"],
        ask: ["Bash(git push *)"],
        deny: ["Bash(rm -rf *)"],
      },
    },
  });

  // single command: exact output preserved
  const single = await run(["why", "git status"], w);
  assert.equal(single.code, 0);
  assert.match(single.out, /Approved without the classifier\./);

  const singleJson = (await run(["why", "git status", "--json"], w)).json();
  assert.equal(singleJson.ok, true);
  assert.equal(singleJson.command, "git status");
  assert.equal(singleJson.outcome, "static");
  assert.equal(singleJson.commands, undefined);

  // three commands: order preserved, exit code 1 (prompt), blocks separated by blank line
  const b1 = (await run(["why", "git status"], w)).out;
  const b2 = (await run(["why", "npm test"], w)).out;
  const b3 = (await run(["why", "git push origin main"], w)).out;
  const multi = await run(["why", "git status", "npm test", "git push origin main"], w);
  assert.equal(multi.code, 1);
  assert.equal(multi.out, `${b1}\n${b2}\n${b3}`);
  assert.match(b1, /Approved without the classifier\./);
  assert.match(b2, /Goes to the classifier\./);
  assert.match(b3, /Asks you; the classifier is not asked/);

  // two commands that are allowed / classifier exit 0
  const okMulti = await run(["why", "git status", "npm test"], w);
  assert.equal(okMulti.code, 0);

  // JSON form: { ok: true, commands: [ ... ] }
  const multiJson = (await run(["why", "git status", "npm test", "git push origin main", "--json"], w)).json();
  assert.equal(multiJson.ok, true);
  assert.equal(Array.isArray(multiJson.commands), true);
  assert.equal(multiJson.commands.length, 3);
  assert.equal(multiJson.commands[0].command, "git status");
  assert.equal(multiJson.commands[0].outcome, "static");
  assert.equal(multiJson.commands[1].command, "npm test");
  assert.equal(multiJson.commands[1].outcome, "classifier");
  assert.equal(multiJson.commands[2].command, "git push origin main");
  assert.equal(multiJson.commands[2].outcome, "prompt");
});

test("cost: the measured sizes, who pays, and what the transcripts show", async () => {
  const w = world("cost");
  writeTranscript(w, { calls: [{ tool: "Bash", input: { command: "mytool" }, decision: "accept", reasonType: "classifier", classifierBoundary: true }, { tool: "Bash", input: { command: "mytool b" }, decision: "accept", reasonType: "classifier", serverReview: true }] });
  const r = await run(["cost", "--since", "3650"], w, { now: Date.parse("2026-10-16T12:00:00Z") });
  assert.match(r.out, /measured\s+on Claude Code 2\.1\.299/);
  assert.match(r.out, /stage 1\s+claude-sonnet-5\s+max_tokens\s+64/);
  assert.match(r.out, /2 classifier decisions: 1 by Claude Code's own requests, 1 by the server's review/);
  assert.match(r.out, /auto-mode-classifier-billing/);
  const j = (await run(["cost", "--json", "--since", "3650"], w, { now: Date.parse("2026-10-16T12:00:00Z") })).json();
  assert.equal(j.transcripts.client, 1);
  assert.equal(j.stages[0].maxTokens, 64);
  assert.ok(j.perCommand.tokensHigh > j.perCommand.tokensLow);
});

test("--since takes a date: report, cost and suggest say which window was asked for", async () => {
  const w = world("since-date");
  const file = writeTranscript(w, { start: "2020-06-01T09:00:00.000Z", calls: [{ tool: "Bash", input: { command: "mytool" }, decision: "accept", reasonType: "classifier", classifierBoundary: true }] });
  // the file is touched now, so set its time to the transcript's own, as a real folder would have
  fs.utimesSync(file, new Date("2020-06-01T09:00:00.000Z"), new Date("2020-06-01T09:00:00.000Z"));
  const now = Date.parse("2026-10-16T12:00:00Z");
  const days = Math.ceil((now - Date.parse("2020-06-01T00:00:00.000Z")) / 86400000);
  const r = await run(["report", "--since", "2020-06-01"], w, { now });
  assert.equal(r.code, 0);
  assert.match(r.out, /window    since 2020-06-01 \(to 2026-10-16, days are UTC dates\); 1 transcript; 1 tool decision/);
  const j = (await run(["report", "--json", "--since", "2020-06-01"], w, { now })).json();
  assert.deepEqual([j.window.days, j.window.since, j.window.until, j.window.date], [days, "2020-06-01", "2026-10-16", "2020-06-01"]);
  assert.match((await run(["cost", "--since", "2020-06-01"], w, { now })).out, /In your transcripts \(since 2020-06-01\)/);
  assert.match((await run(["suggest", "--since", "2020-06-01"], w, { now })).out, /window    since 2020-06-01; commands the classifier turned back at least 2 times/);
  // the number form says the number of days, as it always did
  assert.match((await run(["report", "--since", "3650"], w, { now })).out, /window    the last 3650 days \(to 2026-10-16/);
});

test("the entry point runs in a child process, prints, and exits with the code", () => {
  const w = world("child", { user: { autoMode: { soft_deny: ["x"] } } });
  const r = runCli(["lint"], { cwd: w.work, env: w.env });
  assert.equal(r.code, 1);
  assert.match(r.out, /replaces-defaults/);
  const v = runCli(["--version"], { cwd: w.work, env: w.env });
  assert.equal(v.out.trim(), VERSION);
  assert.equal(runCli(["report", "--bogus"], { cwd: w.work, env: w.env }).code, 2);
  // a closed pipe is not an error
  assert.ok(fs.existsSync(path.join(ROOT, "bin", "claude-automode-doctor.mjs")));
  assert.equal(CLI, path.join(ROOT, "bin", "claude-automode-doctor.mjs"));
});

test("runCli refuses an environment that is not a throwaway world", () => {
  assert.throws(() => runCli(["--version"], { env: { HOME: ROOT, USERPROFILE: ROOT, CLAUDE_CONFIG_DIR: path.join(ROOT, ".claude") } }), /throwaway|temporary/);
});
