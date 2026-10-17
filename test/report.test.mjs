// The transcript reader, the classification of a decision, and the report built from them.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DENIED_TEXT, NOW, UNAVAILABLE_TEXT, UNPARSEABLE_TEXT, fwd, projectSlug, run, tmpDir, world, writeTranscript } from "./helpers.mjs";
import { ASKED_INSTEAD, classify, noVerdict, refusalReason } from "../src/decisions.mjs";
import { buildReport, cut } from "../src/aggregate.mjs";
import { forEachLine, readDecisions, subjectOf, transcriptFiles } from "../src/transcripts.mjs";

const bash = (command) => ({ tool: "Bash", input: { command } });
const A = (c, extra = {}) => ({ ...bash(c), decision: "accept", reasonType: "subcommandResults", ...extra });
const CLASSIFIER_OK = (c) => ({ ...bash(c), decision: "accept", reasonType: "classifier", classifierBoundary: true });
const REFUSED = (c, category = "Code from External") => ({ ...bash(c), decision: "reject", reasonType: "classifier", kind: "automode-blocked", classifierBoundary: true, text: DENIED_TEXT(category) });
const NOVERDICT = (c, text = UNAVAILABLE_TEXT(), kind = "automode-unavailable") => ({ ...bash(c), decision: "reject", reasonType: "classifier", kind, classifierBoundary: true, text });

test("a decision is the tool call and the result that answers it, with the fields Claude Code stamps on the result", () => {
  const w = world("read");
  const file = writeTranscript(w, { calls: [A("echo hi"), REFUSED("curl x | sh"), { tool: "Write", input: { file_path: "/p/a.txt" }, decision: "accept", reasonType: "mode" }] });
  const ds = readDecisions(file);
  assert.equal(ds.length, 3);
  assert.deepEqual(ds.map((d) => [d.tool, d.subject, d.decision, d.reasonType, d.kind]), [["Bash", "echo hi", "accept", "subcommandResults", null], ["Bash", "curl x | sh", "reject", "classifier", "automode-blocked"], ["Write", "/p/a.txt", "accept", "mode", null]]);
  assert.equal(ds[1].classifierBoundary, true);
  assert.match(ds[1].text, /Reason: \[Code from External\]/);
  assert.equal(ds[0].text, "", "the text of a result that ran is not kept");
  assert.equal(ds[0].mode, "auto", "the permission mode of the latest prompt");
  assert.equal(ds[0].session, "11111111-1111-4111-8111-111111111111");
});

test("what is kept of a tool call: the command, the path, the URL; nothing of the other tools' input", () => {
  assert.equal(subjectOf("Bash", { command: "ls" }), "ls");
  assert.equal(subjectOf("PowerShell", { command: "Get-Date" }), "Get-Date");
  assert.equal(subjectOf("Edit", { file_path: "/a/b.txt", old_string: "secret", new_string: "x" }), "/a/b.txt");
  assert.equal(subjectOf("WebFetch", { url: "https://x.dev/a", prompt: "tell me" }), "https://x.dev/a");
  assert.equal(subjectOf("Agent", { prompt: "do the private thing", description: "x" }), null);
  assert.equal(subjectOf("Grep", { pattern: "api_key" }), null);
  assert.equal(subjectOf("Bash", null), null);
});

test("classify: the source and result of every shape the binary wrote", () => {
  const base = { text: "", isError: false, classifierBoundary: false, serverReview: false };
  const c = (o) => { const r = classify({ ...base, ...o }); return [r.source, r.result, r.via, r.category, r.cause]; };
  assert.deepEqual(c({ decision: "accept", permSource: "config", reasonType: "subcommandResults" }), ["static", "allowed", null, null, null]);
  assert.deepEqual(c({ decision: "accept", permSource: "config", reasonType: "mode" }), ["mode", "allowed", null, null, null]);
  assert.deepEqual(c({ decision: "accept", permSource: "user_permanent", reasonType: "rule" }), ["rule", "allowed", null, null, null]);
  assert.deepEqual(c({ decision: "accept", permSource: "hook", reasonType: "hook" }), ["hook", "allowed", null, null, null]);
  assert.deepEqual(c({ decision: "reject", permSource: "hook", reasonType: "hook", kind: "permission-rule" }), ["hook", "refused", null, null, null]);
  assert.deepEqual(c({ decision: "reject", permSource: "config", reasonType: "subcommandResults", kind: "permission-rule" }), ["rule", "refused", null, null, null]);
  assert.deepEqual(c({ decision: "reject", permSource: "config", reasonType: "mode", kind: "permission-rule" }), ["mode", "refused", null, null, null]);
  assert.deepEqual(c({ decision: "reject", permSource: "config", reasonType: "safetyCheck", kind: "permission-rule" }), ["safety", "refused", null, null, null]);
  assert.deepEqual(c({ decision: "reject", permSource: "config", kind: "user-rejected" }), ["user", "refused", null, null, null]);
  assert.deepEqual(c({ decision: "accept", permSource: "config", reasonType: "classifier", classifierBoundary: true }), ["classifier", "allowed", "client", null, null]);
  assert.deepEqual(c({ decision: "accept", permSource: "config", reasonType: "classifier", serverReview: true }), ["classifier", "allowed", "server", null, null]);
  assert.deepEqual(c({ decision: "reject", permSource: "config", reasonType: "classifier", kind: "automode-blocked", classifierBoundary: true, text: DENIED_TEXT("Git Destructive") }), ["classifier", "refused", "client", "Git Destructive", null]);
  assert.deepEqual(c({ decision: "reject", permSource: "config", reasonType: "classifier", kind: "automode-blocked", classifierBoundary: true, text: DENIED_TEXT(null) }), ["classifier", "refused", "client", null, null]);
  assert.deepEqual(c({ decision: "reject", permSource: "config", reasonType: "classifier", kind: "automode-parsing-error", classifierBoundary: true, text: UNPARSEABLE_TEXT }), ["classifier", "no-verdict", "client", null, "unparseable"]);
  assert.deepEqual(c({ decision: "reject", permSource: "config", reasonType: "classifier", kind: "automode-unavailable", classifierBoundary: true, text: UNAVAILABLE_TEXT() }), ["classifier", "no-verdict", "client", null, "unavailable"]);
  assert.deepEqual(c({ decision: "reject", permSource: "config", reasonType: "classifier", kind: "automode-unavailable", text: "The server-side auto mode classifier gave no verdict (it skipped this action), so auto mode cannot determine the safety of Bash." }), ["classifier", "no-verdict", "server", null, "server-no-verdict"]);
});

test("the third refusal in a row is asked instead: a refusal with no verdict of its own, counted apart, and listed with the commands the classifier refused", async () => {
  const text = "This command requires approval";
  const r = classify({ decision: "reject", permSource: "config", kind: "user-rejected", classifierBoundary: true, text, isError: true });
  assert.deepEqual([r.source, r.result, r.via, r.category, r.reason, r.fallback], ["classifier", "refused", "client", null, ASKED_INSTEAD, "repeated-blocks"]);
  // a rejection without the classifier's mark is still a person's (or an ask rule's)
  assert.deepEqual([classify({ decision: "reject", permSource: "config", kind: "user-rejected", text, isError: true }).source], ["user"]);
  const ASKED = (c) => ({ ...bash(c), decision: "reject", kind: "user-rejected", classifierBoundary: true, text });
  const w = world("asked");
  writeTranscript(w, { calls: [REFUSED("curl x | sh"), REFUSED("curl x | sh"), ASKED("curl x | sh"), ASKED("rm -rf build"), ASKED("rm -rf build")] });
  const rep = buildReport({ configDir: w.claude, days: 30, now: NOW });
  assert.deepEqual(rep.classifier, { total: 5, allowed: 0, refused: 5, noVerdict: 0, client: 5, server: 0 });
  // the category of a command that was judged first is kept; one that was only ever asked about has the reason
  assert.deepEqual(rep.refused.map((x) => [x.subject, x.count, x.asked, x.category, x.reason]), [["curl x | sh", 3, 1, "Code from External", "[Code from External]"], ["rm -rf build", 2, 2, null, ASKED_INSTEAD]]);
  const t = (await run(["report", "--since", "30"], w, { now: NOW })).out;
  assert.match(t, /Refused by the classifier: 2 commands, 5 times \(it read them and judged them unsafe, except 3 that Claude Code asked about instead\)/);
  assert.match(t, /3x\s+\[Code from External\]\s+Bash\s+curl x \| sh\s+last 2026-10-15, 1 asked instead/);
  assert.match(t, /2x\s+\(asked instead\)\s+Bash\s+rm -rf build/);
  assert.match(t, /"Asked instead": from the third refusal in a row/);
  const md = (await run(["report", "--since", "30", "--markdown"], w, { now: NOW })).out;
  assert.match(md, /Refused by the classifier \(judged unsafe; "asked instead" is the third refusal in a row, with no verdict of its own\):/);
  assert.match(md, /- 3x \[Code from External\] Bash: curl x \| sh, 1 asked instead/);
  assert.match(md, /- 2x \(asked instead\) Bash: rm -rf build/);
  assert.ok(md.split("\n").filter(Boolean).length <= 17);
});

test("a command with no verdict for different reasons shows each reason with its count, and the service share is exact", async () => {
  const w = world("causes");
  writeTranscript(w, { calls: [NOVERDICT("git push origin main"), NOVERDICT("git push origin main", UNPARSEABLE_TEXT, "automode-parsing-error"), NOVERDICT("git push origin main", "Auto mode could not evaluate this action and is blocking it for safety — a safety check separate from auto mode refused the request", "automode-parsing-error"), NOVERDICT("make", UNAVAILABLE_TEXT("claude-opus-5-5", "overloaded"))] });
  const rep = buildReport({ configDir: w.claude, days: 30, now: NOW });
  const e = rep.noVerdict.find((x) => x.subject === "git push origin main");
  assert.deepEqual([e.count, e.serviceCount, e.causes], [3, 2, { unavailable: 1, unparseable: 1, "safety-check": 1 }]);
  const t = (await run(["report", "--since", "30"], w, { now: NOW })).out;
  assert.match(t, /3x\s+unavailable, unreadable answer, safety check\s+Bash\s+git push origin main/);
  assert.match(t, /3 of 4 trace to the service or the connection/);
  const md = (await run(["report", "--since", "30", "--markdown"], w, { now: NOW })).out;
  assert.match(md, /No verdict \(the check did not run; 3 of 4 the service or the connection\):/);
  assert.match(md, /- 1x the classifier model was unavailable \(overloaded\): Bash: make/);
});

test("a refusal that is a stage-two failure is no verdict, although the transcript calls it blocked", () => {
  const text = "Permission for this action was denied by the Claude Code auto mode classifier. Reason: Stage 2 classifier error - blocking based on stage 1 assessment (usually transient — retrying often succeeds). If you have other tasks";
  const r = classify({ decision: "reject", permSource: "config", reasonType: "classifier", kind: "automode-blocked", classifierBoundary: true, text, isError: true });
  assert.deepEqual([r.result, r.cause, r.service], ["no-verdict", "stage-two-error", true]);
});

test("the sentences of a classifier that did not judge, as the binary and the documentation word them", () => {
  const cases = [
    ["claude-opus-5-5 is temporarily unavailable, so auto mode cannot determine the safety of Bash right now. Wait a moment", "unavailable", null],
    ["claude-sonnet-5 is temporarily unavailable (rate-limited), so auto mode cannot determine the safety of Bash right now", "unavailable", "rate-limited"],
    ["claude-sonnet-5 is temporarily unavailable (timed out), so auto mode cannot determine the safety of PowerShell right now", "unavailable", "timed out"],
    ["The server-side auto mode classifier gave no verdict (error), so auto mode cannot determine the safety of Bash. This is a transient failure", "server-no-verdict", "error"],
    ["Auto mode could not evaluate this action and is blocking it for safety — run with --debug for details", "unparseable", null],
    ["Auto mode could not evaluate this action and is blocking it for safety — a safety check separate from auto mode blocked this request because of earlier conversation content — it isn't about the action itself — run with --debug for details", "safety-check", null],
    ["Auto mode classifier transcript exceeded context window — falling back to manual approval (try /compact to reduce conversation size)", "context-window", null],
  ];
  for (const [text, cause, detail] of cases) {
    const r = noVerdict(text);
    assert.ok(r, text);
    assert.equal(r.cause, cause, text);
    assert.equal(r.detail, detail, text);
  }
  assert.equal(noVerdict(DENIED_TEXT("Data Exfiltration")), null, "a judgement is not a missing verdict");
  assert.equal(noVerdict("Exit code 1"), null);
  assert.equal(noVerdict("claude: command not found"), null);
});

test("the reason a refusal names: the rule in brackets, or the plain reason", () => {
  assert.deepEqual(refusalReason(DENIED_TEXT("Code from External")), { category: "Code from External", reason: "[Code from External]" });
  assert.deepEqual(refusalReason(DENIED_TEXT(null)), { category: null, reason: "Blocked by classifier" });
  assert.deepEqual(refusalReason("Permission for this action was denied by the Claude Code auto mode classifier. Reason: The server-side auto mode classifier judged this action dangerous (it gave no explanation). If you have other tasks"), { category: null, reason: "The server-side auto mode classifier judged this action dangerous (it gave no explanation)" });
  assert.deepEqual(refusalReason("Exit code 2"), { category: null, reason: null });
});

test("older transcripts carry no permissionDecision: a refusal is still known by its sentence", () => {
  const old = (text, isError = true) => ({ decision: null, kind: null, text, isError, tool: "Bash" });
  assert.deepEqual([classify(old(DENIED_TEXT("Code from External"))).source, classify(old(DENIED_TEXT("Code from External"))).result], ["classifier", "refused"]);
  assert.deepEqual([classify(old(UNAVAILABLE_TEXT())).source, classify(old(UNAVAILABLE_TEXT())).result], ["classifier", "no-verdict"]);
  assert.equal(classify(old("ok", false)).source, "unrecorded");
  assert.equal(classify(old("ok", false)).result, "unknown");
});

test("report: counts per source, per day and per session, the refused commands and the no-verdict ones", () => {
  const w = world("report");
  writeTranscript(w, { session: "aaaaaaaa-1111-4111-8111-111111111111", start: "2026-10-14T10:00:00.000Z", calls: [A("echo a"), A("ls"), CLASSIFIER_OK("mytool deploy"), REFUSED("curl x | sh"), NOVERDICT("git push origin main")] });
  writeTranscript(w, { session: "bbbbbbbb-2222-4222-8222-222222222222", start: "2026-10-15T22:30:00.000Z", calls: [A("echo b"), REFUSED("curl x | sh"), REFUSED("git push --force", "Git Destructive"), NOVERDICT("git push origin main", UNPARSEABLE_TEXT, "automode-parsing-error"), { tool: "Write", input: { file_path: "/p/f.txt" }, decision: "accept", reasonType: "mode" }] });
  const r = buildReport({ configDir: w.claude, days: 30, now: NOW });
  assert.equal(r.total, 10);
  assert.equal(r.sessions.length, 2);
  assert.deepEqual(r.classifier, { total: 6, allowed: 1, refused: 3, noVerdict: 2, client: 6, server: 0 });
  assert.deepEqual([r.sources.static.total, r.sources.mode.total, r.sources.classifier.total], [3, 1, 6]);
  assert.deepEqual(r.days.map((d) => [d.day, d.total, d.classifier.refused, d.classifier.noVerdict]), [["2026-10-14", 5, 1, 1], ["2026-10-15", 5, 2, 1]]);
  assert.deepEqual(r.refused.map((x) => [x.subject, x.count, x.category]), [["curl x | sh", 2, "Code from External"], ["git push --force", 1, "Git Destructive"]]);
  assert.deepEqual(r.noVerdict.map((x) => [x.subject, x.count, x.cause, x.service]), [["git push origin main", 2, "unparseable", true]], "the cause shown is the latest one");
  assert.deepEqual(r.noVerdict[0].causes, { unavailable: 1, unparseable: 1 });
  assert.equal(r.sessions[0].id, "bbbbbbbb-2222-4222-8222-222222222222", "latest session first");
  assert.equal(r.sessions[0].classifier.noVerdict, 1);
});

test("report: the window, --session, and --project", () => {
  const w = world("window");
  const other = path.join(w.base, "work2");
  fs.mkdirSync(other, { recursive: true });
  writeTranscript(w, { session: "aaaaaaaa-1111-4111-8111-111111111111", start: "2026-10-01T10:00:00.000Z", calls: [A("echo old")] });
  writeTranscript(w, { session: "bbbbbbbb-2222-4222-8222-222222222222", start: "2026-10-15T10:00:00.000Z", calls: [A("echo new")] });
  writeTranscript(w, { session: "cccccccc-3333-4333-8333-333333333333", cwd: other, start: "2026-10-15T11:00:00.000Z", calls: [A("echo elsewhere")] });
  // the files are touched now, so set their times to the transcripts' own, as a real folder would have
  for (const f of fs.readdirSync(path.join(w.claude, "projects"), { recursive: true })) {
    const p = path.join(w.claude, "projects", String(f));
    if (!p.endsWith(".jsonl")) continue;
    const t = JSON.parse(fs.readFileSync(p, "utf8").split("\n")[0]).timestamp;
    fs.utimesSync(p, new Date(t), new Date(t));
  }
  assert.equal(buildReport({ configDir: w.claude, days: 30, now: NOW }).total, 3);
  assert.equal(buildReport({ configDir: w.claude, days: 7, now: NOW }).total, 2, "the first transcript is older than 7 days");
  assert.equal(buildReport({ configDir: w.claude, days: 30, now: NOW, session: "bbbb" }).total, 1);
  assert.equal(buildReport({ configDir: w.claude, days: 30, now: NOW, project: w.work }).total, 2, "one project: this one, not the other");
  assert.equal(buildReport({ configDir: w.claude, days: 30, now: NOW, project: other }).total, 1);
});

test("report --markdown: a date window names the date that was asked for", async () => {
  const w = world("markdown-date");
  writeTranscript(w, { calls: [A("echo a"), REFUSED("curl x | sh")] });
  const r = await run(["report", "--since", "2026-10-12", "--markdown"], w, { now: NOW });
  assert.match(r.out.split("\n")[1], /^2 tool decisions in 1 session, since 2026-10-12 \(UTC\)\. Classifier:/);
  assert.equal(r.code, 0, "the skill's form exits 0 even with a refusal");
  assert.ok(r.out.trimEnd().split("\n").length <= 17);
});

test("report --markdown: a number window keeps the last N days wording", async () => {
  const w = world("markdown-days");
  writeTranscript(w, { calls: [A("echo a"), REFUSED("curl x | sh")] });
  const r = await run(["report", "--since", "7", "--markdown"], w, { now: NOW });
  assert.match(r.out.split("\n")[1], /^2 tool decisions in 1 session, last 7 days \(UTC\)\. Classifier:/);
  assert.equal(r.code, 0, "the skill's form exits 0 even with a refusal");
  assert.ok(r.out.trimEnd().split("\n").length <= 17);
});

test("report: --since takes a date from the start of that day in UTC, and a number of days and the matching date agree", async () => {
  const w = world("since");
  writeTranscript(w, { session: "aaaaaaaa-1111-4111-8111-111111111111", start: "2026-10-09T09:00:00.000Z", calls: [A("echo old")] });
  writeTranscript(w, { session: "bbbbbbbb-2222-4222-8222-222222222222", start: "2026-10-15T09:00:00.000Z", calls: [A("echo new"), REFUSED("curl x | sh")] });
  // the files are touched now, so set their times to the transcripts' own, as a real folder would have
  for (const f of fs.readdirSync(path.join(w.claude, "projects"), { recursive: true })) {
    const p = path.join(w.claude, "projects", String(f));
    if (!p.endsWith(".jsonl")) continue;
    const t = JSON.parse(fs.readFileSync(p, "utf8").split("\n")[0]).timestamp;
    fs.utimesSync(p, new Date(t), new Date(t));
  }
  const at = { now: NOW };
  const r = await run(["report", "--since", "2026-10-12"], w, at);
  assert.equal(r.code, 1, "the refusal is in the window");
  assert.match(r.out, /window    since 2026-10-12 \(to 2026-10-16, days are UTC dates\); 1 transcript; 2 tool decisions/);
  const j = (await run(["report", "--since", "2026-10-12", "--json"], w, at)).json();
  assert.equal(j.total, 2, "the transcript of 2026-10-09 is outside the window");
  assert.deepEqual([j.window.days, j.window.since, j.window.until, j.window.date], [5, "2026-10-12", "2026-10-16", "2026-10-12"]);
  // a number of days and the date that many days ago name the same decisions; only the window line differs
  const number = (await run(["report", "--since", "6", "--json"], w, at)).json();
  const date = (await run(["report", "--since", "2026-10-10", "--json"], w, at)).json();
  assert.deepEqual({ ...number, window: null }, { ...date, window: null });
  assert.deepEqual([number.window.days, number.window.since, number.window.date], [6, "2026-10-10", null]);
  assert.deepEqual([date.window.days, date.window.since, date.window.date], [7, "2026-10-10", "2026-10-10"]);
});

test("report: a resumed session that repeats lines does not count them twice, and a missing folder is an empty report", () => {
  const w = world("dupe");
  const f1 = writeTranscript(w, { session: "aaaaaaaa-1111-4111-8111-111111111111", calls: [A("echo a"), REFUSED("curl x | sh")] });
  fs.copyFileSync(f1, path.join(path.dirname(f1), "dddddddd-4444-4444-8444-444444444444.jsonl"));
  assert.equal(buildReport({ configDir: w.claude, days: 3650, now: NOW }).total, 2);
  const empty = buildReport({ configDir: path.join(w.base, "nothing-here"), days: 30, now: NOW });
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.classifier, { total: 0, allowed: 0, refused: 0, noVerdict: 0, client: 0, server: 0 });
});

test("report: lines that are not JSON, and a transcript without results, do no harm", () => {
  const w = world("junk");
  const f = writeTranscript(w, { calls: [A("echo a")] });
  fs.appendFileSync(f, "not json\n{\"type\":\"user\"\n\n");
  assert.equal(buildReport({ configDir: w.claude, days: 3650, now: NOW }).total, 1);
});

test("report: the JSON keeps at most the latest decisions, and says so", () => {
  const w = world("limit");
  writeTranscript(w, { calls: Array.from({ length: 30 }, (_, i) => A(`echo ${i}`)) });
  const r = buildReport({ configDir: w.claude, days: 3650, now: NOW, limit: 10 });
  assert.equal(r.total, 30);
  assert.equal(r.decisions.length, 10);
  assert.equal(r.truncated, true);
  assert.equal(r.decisions[9].subject, "echo 29");
});

test("cut: the first line of a command, at most the width", () => {
  assert.equal(cut("ls"), "ls");
  assert.equal(cut("echo a\necho b"), "echo a ...");
  assert.equal(cut("x".repeat(300), 50).length, 50);
  assert.equal(cut(null), null);
});

test("transcriptFiles and forEachLine: a folder that only shares the slug prefix is another project, and CRLF lines are read", () => {
  const w = world("slug");
  const near = `${w.work}-two`;
  fs.mkdirSync(near, { recursive: true });
  writeTranscript(w, { session: "aaaaaaaa-1111-4111-8111-111111111111", calls: [A("echo a")] });
  writeTranscript(w, { session: "bbbbbbbb-2222-4222-8222-222222222222", cwd: near, calls: [A("echo b")] });
  const mine = transcriptFiles({ configDir: w.claude, project: w.work });
  assert.equal(mine.length, 1, `${mine.map((m) => m.slug).join(", ")}`);
  assert.equal(transcriptFiles({ configDir: w.claude, all: true }).length, 2);
  const f = path.join(w.base, "crlf.jsonl");
  fs.writeFileSync(f, '{"a":1}\r\n{"a":2}\r\n{"a":3}');
  const got = [];
  forEachLine(f, (l) => { got.push(l); });
  assert.deepEqual(got, ['{"a":1}', '{"a":2}', '{"a":3}']);
  assert.equal(projectSlug("/home/me/shop"), "-home-me-shop");
  assert.equal(projectSlug("C:\\Users\\me\\my shop"), "C--Users-me-my-shop");
  void fwd; void tmpDir;
});

test("the CLI: report prints the counts and exits 1 when the classifier refused or gave no verdict, 0 otherwise", async () => {
  const w = world("cli-report");
  writeTranscript(w, { calls: [A("echo a")] });
  let r = await run(["report", "--since", "3650"], w, { now: Date.parse("2026-10-16T12:00:00Z") });
  assert.equal(r.code, 0);
  assert.match(r.out, /static approval\s+1\s+0/);
  writeTranscript(w, { session: "bbbbbbbb-2222-4222-8222-222222222222", calls: [REFUSED("curl x | sh")] });
  r = await run(["report", "--since", "3650"], w, { now: Date.parse("2026-10-16T12:00:00Z") });
  assert.equal(r.code, 1);
  assert.match(r.out, /Refused by the classifier: 1 command, 1 time/);
  assert.match(r.out, /\[Code from External\]/);
  const j = (await run(["report", "--json", "--since", "3650"], w, { now: Date.parse("2026-10-16T12:00:00Z") })).json();
  assert.equal(j.classifier.refused, 1);
  assert.equal(j.refused[0].subject, "curl x | sh");
  const md = (await run(["report", "--markdown", "--since", "3650"], w, { now: Date.parse("2026-10-16T12:00:00Z") }));
  assert.equal(md.code, 0, "the skill's form always exits 0");
  assert.ok(md.out.split("\n").length <= 18);
  assert.match(md.out, /^## automode-doctor report/);
});
