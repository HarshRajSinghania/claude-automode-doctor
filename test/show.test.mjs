// show: the merged autoMode and permissions settings with the file each part came from.
import test from "node:test";
import assert from "node:assert/strict";
import { run, world } from "./helpers.mjs";
import { buildShow } from "../src/show.mjs";
import { loadSettings } from "../src/settings.mjs";
import { MEASURED } from "../src/measured.mjs";

const showOf = (w) => buildShow(loadSettings({ project: w.work, env: w.env, home: w.home, managed: w.managedDir }));

test("with no settings every list is the built-in one", () => {
  const m = showOf(world("none"));
  for (const k of ["allow", "soft_deny", "hard_deny", "environment"]) {
    assert.equal(m.autoMode.lists[k].builtinReplaced, false);
    assert.deepEqual(m.autoMode.lists[k].effective, [{ defaults: true, count: MEASURED.builtin[k], version: MEASURED.version }]);
  }
  assert.equal(m.autoMode.classifyAllShell, null);
});

test("the user's list replaces the built-in rules without $defaults, and puts them at its place with it", () => {
  const w = world("lists", { user: { autoMode: { allow: ["A"], soft_deny: ["$defaults", "S"], hard_deny: ["H", "$defaults"] } } });
  const l = showOf(w).autoMode.lists;
  assert.equal(l.allow.builtinReplaced, true);
  assert.deepEqual(l.allow.effective.map((e) => e.text || "defaults"), ["A"]);
  assert.deepEqual(l.soft_deny.effective.map((e) => e.text || "defaults"), ["defaults", "S"]);
  assert.deepEqual(l.hard_deny.effective.map((e) => e.text || "defaults"), ["H", "defaults"]);
  assert.equal(l.environment.builtinReplaced, false);
  assert.equal(l.allow.contributions[0].replaces, true);
  assert.equal(l.soft_deny.contributions[0].hasDefaults, true);
});

test("a block in a project or local file is listed as ignored and changes nothing", () => {
  const w = world("ignored", { project: { autoMode: { allow: ["P"] } }, local: { autoMode: { classifyAllShell: true } } });
  const m = showOf(w);
  assert.equal(m.autoMode.lists.allow.effective[0].defaults, true);
  assert.equal(m.autoMode.classifyAllShell, null);
  assert.deepEqual(m.autoMode.ignoredCopies.map((c) => [c.scope, c.keys]), [["local", ["classifyAllShell"]], ["project", ["allow"]]]);
  assert.equal(m.files.find((f) => f.scope === "project").autoMode.read, false);
});

test("a managed block makes the lists shown by file: how they combine with the user's was not put to the binary", () => {
  const w = world("managed", { user: { autoMode: { allow: ["U", "$defaults"] } }, managed: { autoMode: { allow: ["M", "$defaults"] } } });
  const m = showOf(w);
  assert.equal(m.autoMode.lists.allow.effective, null);
  assert.deepEqual(m.autoMode.lists.allow.contributions.map((c) => c.scope), ["managed", "user"]);
  assert.match(m.autoMode.notes[0], /not put to a managed file/);
});

test("permissions: rules joined across files with the file of each, a rule in two files once with both; broad allow rules marked", () => {
  const w = world("perm", { user: { permissions: { allow: ["Bash(git status)", "Bash(npm run *)"], deny: ["Read(./.env)"], defaultMode: "acceptEdits", blockReadsOutsideWorkingDirectories: false } }, project: { permissions: { allow: ["Bash(git status)"], defaultMode: "plan", disableAutoMode: "disable" } } });
  const p = showOf(w).permissions;
  assert.deepEqual(p.rules.allow.map((r) => [r.raw, r.scope, r.also.map((a) => a.scope), r.droppedInAutoMode]), [["Bash(git status)", "project", ["user"], false], ["Bash(npm run *)", "user", [], true]]);
  assert.deepEqual(p.rules.deny.map((r) => r.raw), ["Read(./.env)"]);
  assert.equal(p.defaultMode.value, "plan");
  assert.equal(p.defaultMode.scope, "project");
  assert.deepEqual(p.defaultMode.shadowed.map((s) => [s.value, s.scope]), [["acceptEdits", "user"]]);
  assert.equal(p.disableAutoMode.value, "disable");
  assert.equal(p.blockReads.value, false);
});

test("an ignored file contributes nothing and the file list says why", () => {
  const w = world("ignoredfile", { user: `{\n  // c\n  "permissions": { "allow": ["Bash(ls *)"] }\n}\n`, project: { permissions: { allow: ["Bash(git status)"] } } });
  const m = showOf(w);
  const f = m.files.find((x) => x.scope === "user");
  assert.equal(f.state, "ignored");
  assert.match(f.detail, /Claude Code ignores the whole file/);
  assert.deepEqual(m.permissions.rules.allow.map((r) => r.raw), ["Bash(git status)"]);
});

test("the CLI: show prints the settings and what it does not read, and --json is the same model", async () => {
  const w = world("cli-show", { user: { autoMode: { soft_deny: ["x"] }, permissions: { allow: ["Bash(python *)"] } } });
  const r = await run(["show"], w);
  assert.equal(r.code, 0);
  assert.match(r.out, /soft_deny\s+yours only: the built-in 72 are replaced/);
  assert.match(r.out, /Bash\(python \*\)\s+~\/\.claude\/settings\.json:\d+\s+dropped when auto mode starts/);
  assert.match(r.out, /Not read by this tool:/);
  assert.match(r.out, /the --settings flag/);
  const j = (await run(["show", "--json"], w)).json();
  assert.equal(j.autoMode.lists.soft_deny.builtinReplaced, true);
  assert.equal(j.permissions.rules.allow[0].droppedInAutoMode, true);
});
