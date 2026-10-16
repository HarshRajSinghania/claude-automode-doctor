// The lint: each trap, with the file and line, what Claude Code does about it, and the evidence it rests on.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { run, world } from "./helpers.mjs";
import { lintSettings } from "../src/lint.mjs";
import { loadSettings } from "../src/settings.mjs";
import { markdownLint } from "../src/render.mjs";
import { MEASURED } from "../src/measured.mjs";
import { pathsOf, pathScopedRuleFiles } from "../src/rulefiles.mjs";

const lintOf = (w) => lintSettings(loadSettings({ project: w.work, env: w.env, home: w.home, managed: w.managedDir }));
const ids = (l) => l.findings.map((f) => `${f.severity}:${f.id}`).sort();
const find = (l, id) => l.findings.find((f) => f.id === id);

test("nothing to say about settings that have no trap", () => {
  const w = world("clean", { user: { model: "sonnet", autoMode: { allow: ["$defaults", "Deploy to staging"], soft_deny: ["$defaults"], environment: ["$defaults", "Org: acme"] }, permissions: { allow: ["Bash(git status)", "Bash(npm test)"], deny: ["Bash(rm -rf *)"] } } });
  assert.deepEqual(lintOf(w).findings, []);
});

test("a list without $defaults replaces the built-in rules: an error for soft_deny and hard_deny, a warning for allow and environment, with the numbers measured", () => {
  const w = world("defaults", { user: `{\n  "autoMode": {\n    "allow": ["A"],\n    "soft_deny": ["B"],\n    "hard_deny": ["C"],\n    "environment": ["D"]\n  }\n}\n` });
  const l = lintOf(w);
  assert.deepEqual(l.findings.map((f) => [f.severity, f.keyPath, f.line]), [["error", "autoMode.soft_deny", 4], ["error", "autoMode.hard_deny", 5], ["warning", "autoMode.allow", 3], ["warning", "autoMode.environment", 6]]);
  const soft = find(l, "replaces-defaults");
  assert.match(soft.message, new RegExp(`replaces the ${MEASURED.builtin.soft_deny} built-in soft block rules`));
  assert.match(soft.message, new RegExp(`about ${MEASURED.removedChars.soft_deny.toLocaleString("en-US")} characters`));
  assert.match(soft.message, new RegExp(`Claude Code ${MEASURED.version.replace(/\./g, "\\.")}`));
  assert.match(soft.fix, /"\$defaults"/);
  assert.equal(soft.evidence, "binary");
  assert.equal(soft.effect, "list");
});

test("with $defaults in the list nothing is replaced; an empty list changes nothing; $defaults twice is a note", () => {
  const w = world("ok-defaults", { user: { autoMode: { allow: ["A", "$defaults"], soft_deny: [], hard_deny: ["$defaults", "H", "$defaults"] } } });
  const l = lintOf(w);
  assert.deepEqual(ids(l), ["note:defaults-twice", "note:empty-list"]);
  assert.match(find(l, "empty-list").message, /changes nothing/);
});

test("a list as long as the built-in one, without $defaults, is taken for a copy you own on purpose: a note", () => {
  const w = world("copy", { user: { autoMode: { allow: Array.from({ length: MEASURED.builtin.allow }, (_, i) => `rule ${i}`) } } });
  const l = lintOf(w);
  assert.deepEqual(ids(l), ["note:replaces-defaults"]);
});

test("a value of the wrong type is an error that costs the whole file, with the line of the value", () => {
  const w = world("types", { user: `{\n  "model": "m",\n  "autoMode": {\n    "allow": "everything",\n    "classifyAllShell": "yes"\n  },\n  "permissions": { "disableAutoMode": true }\n}\n` });
  const l = lintOf(w);
  const wrong = l.findings.filter((f) => f.id === "wrong-type");
  assert.deepEqual(wrong.map((f) => [f.keyPath, f.line, f.severity, f.effect]), [["autoMode.allow", 4, "error", "file"], ["autoMode.classifyAllShell", 5, "error", "file"], ["permissions.disableAutoMode", 7, "error", "file"]]);
  assert.match(wrong[0].message, /ignores the whole file/);
  assert.equal(l.findings.some((f) => f.id === "replaces-defaults"), false, "a file Claude Code ignores is not linted as if it applied");
});

test("an autoMode block in a project or local file does nothing: Claude Code reads it from the user's and managed settings", () => {
  const w = world("scope", { project: { autoMode: { allow: ["x", "$defaults"] } }, local: { autoMode: { classifyAllShell: true } } });
  const l = lintOf(w);
  assert.deepEqual(l.findings.map((f) => [f.id, f.scope, f.line]), [["automode-not-read", "local", 2], ["automode-not-read", "project", 2]]);
  assert.match(find(l, "automode-not-read").message, /claude auto-mode config ignores it/);
});

test("a key the block does not know is a warning with the near name; the file still applies", () => {
  const w = world("unknown", { user: { autoMode: { softDeny: ["x"], deny: ["y"] }, permissions: { deny: ["Bash(rm *)"] } } });
  const l = lintOf(w);
  const u = l.findings.filter((f) => f.id === "unknown-key");
  assert.deepEqual(u.map((f) => f.keyPath), ["autoMode.softDeny", "autoMode.deny"]);
  assert.match(u[0].fix, /soft_deny/);
  assert.equal(u[0].severity, "warning");
});

test("classifyAllShell: a warning that counts the allow rules it suspends", () => {
  const w = world("cas", { user: { autoMode: { classifyAllShell: true }, permissions: { allow: ["Bash(git status)", "PowerShell(Get-Date *)", "Read(./x)"] } } });
  const f = find(lintOf(w), "classify-all-shell");
  assert.equal(f.severity, "warning");
  assert.match(f.message, /2 rules in your settings/);
  assert.match(f.message, /Read-only commands such as echo and ls still skip it/);
  const off = world("cas-off", { user: { autoMode: { classifyAllShell: false } } });
  assert.equal(find(lintOf(off), "classify-all-shell"), undefined);
});

test("permissions.disableAutoMode set to disable is a note, in any file", () => {
  for (const where of ["user", "project", "local"]) {
    const w = world(`dis-${where}`, { [where]: { permissions: { disableAutoMode: "disable" } } });
    const f = find(lintOf(w), "auto-mode-disabled");
    assert.ok(f, where);
    assert.equal(f.severity, "note");
    assert.equal(f.scope, where);
  }
});

test("the three known bad interactions, each with its issue number and what was seen on the binary", () => {
  const w = world("interactions", { user: { permissions: { blockReadsOutsideWorkingDirectories: true, deny: ["Read(**/*.pem)"] } } });
  fs.mkdirSync(path.join(w.work, ".claude", "rules"), { recursive: true });
  fs.writeFileSync(path.join(w.work, ".claude", "rules", "text.md"), '---\npaths:\n  - "**/*.txt"\n---\nbe careful\n');
  const l = lintOf(w);
  const a = find(l, "block-reads-bash-first");
  assert.deepEqual([a.severity, a.issue, a.evidence], ["warning", 95238, "binary"]);
  assert.match(a.message, /whatever your allow rules say/);
  assert.match(a.message, /the classifier never sees it/);
  const b = find(l, "read-deny-cd");
  assert.deepEqual([b.severity, b.issue], ["note", 91650]);
  assert.match(b.message, /went to the classifier/);
  const c = find(l, "path-rules-bash");
  assert.deepEqual([c.severity, c.issue], ["note", 88565]);
  assert.match(c.message, /not when a Bash command changes the file/);
  assert.equal(ids(lintOf(world("none", { user: { permissions: { blockReadsOutsideWorkingDirectories: false } } }))).length, 0);
});

test("a rule file's paths: front matter, as a list, inline, or one glob", () => {
  assert.deepEqual(pathsOf('---\npaths:\n  - "**/*.ts"\n  - src/**\n---\nx'), ["**/*.ts", "src/**"]);
  assert.deepEqual(pathsOf('---\npaths: ["a/**", "b/*.md"]\n---\nx'), ["a/**", "b/*.md"]);
  assert.deepEqual(pathsOf("---\npaths: docs/**\n---\nx"), ["docs/**"]);
  assert.deepEqual(pathsOf("---\ndescription: x\n---\nx"), []);
  assert.deepEqual(pathsOf("no front matter"), []);
  assert.deepEqual(pathsOf("---\r\npaths:\r\n  - a\r\n---\r\nx"), ["a"]);
  const w = world("rules");
  fs.mkdirSync(path.join(w.claude, "rules", "deep"), { recursive: true });
  fs.writeFileSync(path.join(w.claude, "rules", "deep", "u.md"), "---\npaths: x/**\n---\n");
  fs.writeFileSync(path.join(w.claude, "rules", "plain.md"), "no paths");
  assert.deepEqual(pathScopedRuleFiles({ project: w.work, configDir: w.claude }).map((r) => [r.scope, r.globs]), [["user", ["x/**"]]]);
});

test("allow rules that auto mode drops are notes, the narrow ones are left alone", () => {
  const w = world("dropped", { user: { permissions: { allow: ["Bash(*)", "Bash(python *)", "Bash(npm run test *)", "Bash(git status)", "Read(./a)", "Bash"] } } });
  const l = lintOf(w);
  assert.deepEqual(l.findings.filter((f) => f.id === "dropped-allow-rule").map((f) => f.message.split(" is dropped")[0]), ["Bash(*)", "Bash(python *)", "Bash"]);
});

test("a file Claude Code ignores for a comment: the lint says what it carried, and says nothing for a file that carries nothing about auto mode", () => {
  const w = world("comment", { user: `{\n  // notes\n  "autoMode": { "allow": ["x"] }\n}\n`, project: `{\n  // notes\n  "model": "sonnet"\n}\n` });
  const l = lintOf(w);
  assert.deepEqual(l.findings.map((f) => [f.id, f.scope, f.line]), [["file-ignored", "user", 2]]);
  assert.match(l.findings[0].message, /an autoMode block in it do nothing/);
});

test("the CLI: lint exits 1 on an error or a warning, 0 for notes only, and --markdown always 0 within 12 findings", async () => {
  const w = world("cli-lint", { user: { autoMode: { soft_deny: ["x"] } } });
  let r = await run(["lint"], w);
  assert.equal(r.code, 1);
  assert.match(r.out, /error\s+replaces-defaults\s+line 3\s+autoMode\.soft_deny/);
  assert.match(r.out, /1 error, 0 warnings, 0 notes in 1 settings file/);
  r = await run(["lint", "--markdown"], w);
  assert.equal(r.code, 0);
  assert.match(r.out, /^## automode-doctor lint: /);
  assert.match(r.out, /- ERROR `replaces-defaults` ~\/\.claude\/settings\.json:3: autoMode\.soft_deny has 1 entry/);
  const notes = world("cli-notes", { user: { permissions: { disableAutoMode: "disable" } } });
  r = await run(["lint"], notes);
  assert.equal(r.code, 0);
  r = await run(["lint", "--json"], w);
  const j = r.json();
  assert.equal(j.counts.error, 1);
  assert.equal(j.findings[0].id, "replaces-defaults");
  assert.ok(j.files.some((f) => f.scope === "user" && f.exists));
});

test("--markdown stops at 12 findings and says how many more", () => {
  const findings = Array.from({ length: 15 }, (_, i) => ({ id: "unknown-key", severity: "warning", display: "~/.claude/settings.json", line: i + 1, message: "x".repeat(400), fix: "y" }));
  const md = markdownLint({ project: "/p", files: [{ exists: true }], counts: { error: 0, warning: 15, note: 0 }, findings });
  assert.equal(md.split("\n").filter((l) => l.startsWith("- WARNING")).length, 12);
  assert.match(md, /- \.\.\. and 3 more \(run `claude-automode-doctor lint`\)/);
  for (const l of md.split("\n")) assert.ok(l.length <= 300, `${l.length}`);
});
