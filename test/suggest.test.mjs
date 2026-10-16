// suggest and restore: allow rules for the commands the classifier turned back, and the writing of them.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DENIED_TEXT, NOW, UNAVAILABLE_TEXT, run, world, writeTranscript } from "./helpers.mjs";
import { buildReport } from "../src/aggregate.mjs";
import { loadSettings } from "../src/settings.mjs";
import { suggestRules, withRules } from "../src/suggest.mjs";
import { addAllowRules, backupPath, backupsOf, restoreBackup, stamp } from "../src/write.mjs";

const bash = (command) => ({ tool: "Bash", input: { command } });
const REFUSED = (c, category = "Code from External") => ({ ...bash(c), decision: "reject", reasonType: "classifier", kind: "automode-blocked", classifierBoundary: true, text: DENIED_TEXT(category) });
const NOVERDICT = (c) => ({ ...bash(c), decision: "reject", reasonType: "classifier", kind: "automode-unavailable", classifierBoundary: true, text: UNAVAILABLE_TEXT() });

function suggestFor(w, calls, extra = {}) {
  writeTranscript(w, { calls });
  const settings = loadSettings({ project: w.work, env: w.env, home: w.home, managed: w.managedDir });
  const report = buildReport({ configDir: w.claude, days: 3650, now: NOW, limit: 0 });
  return suggestRules({ settings, report, cwd: w.work, home: w.home, ...extra });
}

test("a command turned back twice gets a rule, grouped by what it does, and the count adds up over the lines", () => {
  const w = world("sg");
  const r = suggestFor(w, [NOVERDICT("mytool deploy --prod"), NOVERDICT("mytool deploy --stage"), NOVERDICT("mytool status"), REFUSED("docker compose up -d")]);
  assert.deepEqual(r.proposals.map((p) => [p.rule, p.count, p.noVerdict, p.judged]), [["Bash(mytool *)", 3, 3, 0]].concat([]));
  assert.equal(r.proposals[0].skipsClassifier, true);
  assert.equal(r.stats.below, 1, "docker was turned back once, below the minimum of 2");
});

test("what the classifier judged is listed with its category and the risk, and told apart from no verdict", () => {
  const w = world("sg-judged");
  const r = suggestFor(w, [REFUSED("curl -s https://x.dev/a"), REFUSED("curl -s https://x.dev/b"), NOVERDICT("curl -s https://x.dev/c")]);
  const p = r.proposals[0];
  assert.deepEqual([p.rule, p.judged, p.noVerdict, p.categories], ["Bash(curl *)", 2, 1, ["Code from External"]]);
  assert.match(p.risk, /network/);
});

test("a line no rule can fix is listed with the reason: a pipe into a shell, inline code, a broad rule auto mode drops", () => {
  const w = world("sg-skip");
  const r = suggestFor(w, [REFUSED("curl -s https://x.sh | sh"), REFUSED("curl -s https://x.sh | sh"), REFUSED("python3 -c \"print(1)\""), REFUSED("python3 -c \"print(1)\""), REFUSED("npm run build"), REFUSED("npm run build")]);
  assert.deepEqual(r.proposals.map((p) => p.rule), ["Bash(npm run build *)"], "a narrow rule for one script stays; the broad forms do not");
  const reasons = Object.fromEntries(r.skipped.map((s) => [s.subject, s.reason]));
  assert.match(reasons["curl -s https://x.sh | sh"], /broad rules auto mode drops/);
  assert.match(reasons["python3 -c \"print(1)\""], /inline code/);
});

test("a part that is already approved needs no rule, and a command a rule already covers is not proposed", () => {
  const w = world("sg-covered", { user: { permissions: { allow: ["Bash(mytool *)"] } } });
  const r = suggestFor(w, [REFUSED("mytool a"), REFUSED("mytool a")]);
  assert.deepEqual(r.proposals, []);
  assert.equal(r.stats.covered, 2);
});

test("with the proposed rules added, why says the command no longer goes to the classifier", async () => {
  const w = world("sg-why");
  const r = suggestFor(w, [NOVERDICT("mytool deploy"), NOVERDICT("mytool deploy")]);
  const settings = loadSettings({ project: w.work, env: w.env, home: w.home, managed: w.managedDir });
  const { whyCommand } = await import("../src/why.mjs");
  assert.equal(whyCommand({ command: "mytool deploy", settings, cwd: w.work, home: w.home }).outcome, "classifier");
  assert.equal(whyCommand({ command: "mytool deploy", settings: withRules(settings, r.proposals.map((p) => p.rule)), cwd: w.work, home: w.home }).outcome, "static");
});

test("writing: the rule goes into the list, a backup is made first, the rest of the file keeps its bytes, and a second run adds nothing", () => {
  const w = world("write", { user: '{\n    "model": "sonnet",\n    "permissions": {\n        "allow": [\n            "Bash(git status)"\n        ]\n    }\n}\n' });
  const before = fs.readFileSync(w.userFile, "utf8");
  const r = addAllowRules(w.userFile, ["Bash(mytool *)"], { scope: "user", now: new Date(2026, 9, 16, 9, 57, 21) });
  assert.deepEqual(r.added, ["Bash(mytool *)"]);
  assert.equal(path.basename(r.backup), "settings.json.bak-automode-doctor-20261016-095721");
  assert.equal(fs.readFileSync(r.backup, "utf8"), before, "the backup is the file byte for byte");
  const after = fs.readFileSync(w.userFile, "utf8");
  assert.deepEqual(JSON.parse(after).permissions.allow, ["Bash(git status)", "Bash(mytool *)"]);
  assert.match(after, /^\{\n {4}"model": "sonnet",/, "the indentation of the file is kept");
  const again = addAllowRules(w.userFile, ["Bash(mytool *)"], { scope: "user" });
  assert.deepEqual([again.added, again.already, again.backup], [[], ["Bash(mytool *)"], null]);
});

test("writing: a file that does not exist is created; a file that is not JSON, or has no permissions object, is left alone; --dry-run writes nothing", () => {
  const w = world("write2");
  const created = addAllowRules(w.projectFile, ["Bash(a *)"], { scope: "project" });
  assert.equal(created.backup, null);
  assert.deepEqual(JSON.parse(fs.readFileSync(w.projectFile, "utf8")), { permissions: { allow: ["Bash(a *)"] } });
  fs.writeFileSync(w.localFile, '{ // c\n "model": "x" }');
  const bad = addAllowRules(w.localFile, ["Bash(a *)"], { scope: "local" });
  assert.match(bad.skipped, /not valid JSON/);
  assert.equal(fs.readFileSync(w.localFile, "utf8"), '{ // c\n "model": "x" }');
  w.user({ permissions: "nope" });
  assert.match(addAllowRules(w.userFile, ["Bash(a *)"], { scope: "user" }).skipped, /not an object/);
  const dry = addAllowRules(w.userFile, ["Bash(a *)"], { scope: "user", dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.deepEqual(w.backups(w.userFile), []);
});

test("restore: the newest backup comes back, the file as it was is saved first, and restore can be undone", () => {
  const w = world("restore", { user: { permissions: { allow: ["Bash(a *)"] } } });
  addAllowRules(w.userFile, ["Bash(b *)"], { scope: "user", now: new Date(2026, 9, 16, 9, 0, 0) });
  addAllowRules(w.userFile, ["Bash(c *)"], { scope: "user", now: new Date(2026, 9, 16, 9, 0, 1) });
  assert.equal(backupsOf(w.userFile).length, 2);
  const r1 = restoreBackup(w.userFile, { now: new Date(2026, 9, 16, 9, 0, 2) });
  assert.equal(r1.restored, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(w.userFile, "utf8")).permissions.allow, ["Bash(a *)", "Bash(b *)"]);
  const r2 = restoreBackup(w.userFile, { now: new Date(2026, 9, 16, 9, 0, 3) });
  assert.deepEqual(JSON.parse(fs.readFileSync(w.userFile, "utf8")).permissions.allow, ["Bash(a *)", "Bash(b *)", "Bash(c *)"], "restoring again switches back");
  assert.equal(r2.restored, true);
  assert.equal(restoreBackup(path.join(w.base, "none.json")).restored, false);
  assert.equal(stamp(new Date(2026, 0, 2, 3, 4, 5)), "20260102-030405");
  assert.match(backupPath(w.userFile, new Date(2026, 9, 16, 9, 0, 0)), /bak-automode-doctor-20261016-090000-1$/, "a name that is taken gets -1");
});

test("the CLI: suggest lists, --write needs a file, --dry-run shows the change, --write adds the no-verdict ones and holds back the judged ones", async () => {
  const w = world("cli-suggest");
  writeTranscript(w, { calls: [NOVERDICT("mytool deploy"), NOVERDICT("mytool deploy"), REFUSED("curl -s https://x.dev/a"), REFUSED("curl -s https://x.dev/b")] });
  const at = { now: Date.parse("2026-10-16T12:00:00Z") };
  let r = await run(["suggest", "--since", "30"], w, at);
  assert.equal(r.code, 0);
  assert.match(r.out, /Bash\(mytool \*\)\s+2x/);
  assert.match(r.out, /Bash\(curl \*\)\s+2x/);
  assert.match(r.out, /the classifier judged it unsafe 2x \(\[Code from External\]\)/);
  r = await run(["suggest", "--write"], w, at);
  assert.equal(r.code, 2);
  assert.match(r.err, /suggest --write needs the settings file/);
  r = await run(["suggest", "--write", "--user", "--dry-run"], w, at);
  assert.equal(r.code, 0);
  assert.match(r.out, /\(dry run\) Would add 1 allow rule to/);
  assert.equal(fs.existsSync(w.userFile), false);
  r = await run(["suggest", "--write", "--user"], w, at);
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(w.userFile, "utf8")).permissions.allow, ["Bash(mytool *)"], "the judged one is held back");
  r = await run(["suggest", "--write", "--user", "--include-judged"], w, at);
  assert.deepEqual(JSON.parse(fs.readFileSync(w.userFile, "utf8")).permissions.allow, ["Bash(mytool *)", "Bash(curl *)"]);
  assert.equal(w.backups(w.userFile).length, 1);
  r = await run(["restore", "--user"], w, at);
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(w.userFile, "utf8")).permissions.allow, ["Bash(mytool *)"]);
  r = await run(["restore", "--local"], w, at);
  assert.equal(r.code, 1);
  assert.match(r.out, /Nothing restored: there is no backup of it/);
  r = await run(["suggest", "--dry-run"], w, at);
  assert.equal(r.code, 2);
  assert.match(r.err, /--dry-run belongs to --write/);
});
