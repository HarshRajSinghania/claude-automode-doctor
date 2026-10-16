// The settings loader: which files, in which order, what each says about autoMode and permissions with the line of it, and
// which files Claude Code ignores whole.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpDir, world } from "./helpers.mjs";
import { AUTOMODE_SCOPES, analyzeText, loadSettings } from "../src/settings.mjs";

const load = (w, extra = {}) => loadSettings({ project: w.work, env: w.env, home: w.home, managed: w.managedDir, ...extra });

test("the files, highest precedence first: managed, local, project, user", () => {
  const w = world("order", { user: {}, project: {}, local: {}, managed: {} });
  const s = load(w);
  assert.deepEqual(s.files.map((f) => f.scope), ["managed", "local", "project", "user"]);
  assert.ok(s.files[0].rank > s.files[1].rank && s.files[1].rank > s.files[2].rank && s.files[2].rank > s.files[3].rank);
  assert.deepEqual([...AUTOMODE_SCOPES].sort(), ["managed", "user"]);
});

test("the config folder is CLAUDE_CONFIG_DIR, and a missing file is listed as not there", () => {
  const w = world("cfg");
  const s = load(w);
  assert.equal(s.configDir, w.claude);
  assert.equal(s.configSource, "CLAUDE_CONFIG_DIR");
  assert.ok(s.files.every((f) => f.exists === false));
});

test("managed settings and their drop-in files are read from the managed folder: a drop-in overrides the main file, a later one an earlier one", () => {
  const w = world("managed", { managed: { permissions: { deny: ["Bash(rm *)"] } } });
  fs.mkdirSync(path.join(w.managedDir, "managed-settings.d"), { recursive: true });
  fs.writeFileSync(path.join(w.managedDir, "managed-settings.d", "20-b.json"), JSON.stringify({ autoMode: { allow: ["B"] } }));
  fs.writeFileSync(path.join(w.managedDir, "managed-settings.d", "10-a.json"), JSON.stringify({ autoMode: { allow: ["A"] } }));
  const s = load(w);
  const managed = s.files.filter((f) => f.scope === "managed");
  assert.equal(managed.length, 3);
  assert.ok(managed[0].rank > managed[1].rank && managed[1].rank > managed[2].rank);
  assert.deepEqual(managed.map((f) => path.basename(f.path)), ["20-b.json", "10-a.json", "managed-settings.json"], "highest first (the documentation: drop-ins are merged on top of the main file, in alphabetical order)");
});

test("the view gives the line of the autoMode block, each list, each entry, and the permission rules", () => {
  const w = world("view", { user: `{\n  "autoMode": {\n    "allow": [\n      "$defaults",\n      "Deploy to staging"\n    ],\n    "classifyAllShell": true\n  },\n  "permissions": {\n    "allow": ["Bash(git status)", "Bash(npm test)"],\n    "deny": ["Read(./.env)"],\n    "disableAutoMode": "disable",\n    "blockReadsOutsideWorkingDirectories": true\n  }\n}\n` });
  const f = load(w).files.find((x) => x.scope === "user");
  const am = f.view.autoMode;
  assert.equal(am.line, 2);
  assert.equal(am.lists.allow.line, 3);
  assert.deepEqual(am.lists.allow.items.map((i) => [i.text, i.line]), [["$defaults", 4], ["Deploy to staging", 5]]);
  assert.deepEqual(am.classifyAllShell, { line: 7, value: true });
  const p = f.view.permissions;
  assert.deepEqual(p.allow.map((r) => [r.raw, r.line]), [["Bash(git status)", 10], ["Bash(npm test)", 10]]);
  assert.deepEqual(p.deny.map((r) => [r.raw, r.line]), [["Read(./.env)", 11]]);
  assert.deepEqual(p.disableAutoMode, { value: "disable", line: 12 });
  assert.deepEqual(p.blockReads, { value: true, line: 13 });
  assert.equal(f.ignored, null);
});

test("a file with a comment or a trailing comma is ignored whole by Claude Code: its rules do not apply, but its view is kept for the lint", () => {
  const w = world("comment", { user: `{\n  // my notes\n  "autoMode": { "allow": ["x"] },\n  "permissions": { "deny": ["Bash(rm *)"] }\n}\n` });
  const s = load(w);
  const f = s.files.find((x) => x.scope === "user");
  assert.equal(f.ignored.reason, "not-json");
  assert.equal(f.ignored.line, 2);
  assert.equal(f.data, null);
  assert.ok(f.view.autoMode && f.view.permissions, "the lint can still say what the file would have said");
  assert.equal(s.rules.filter((r) => r.file === f.path).length, 0, "an ignored file contributes no rule");
});

test("a value of the wrong type in autoMode, disableAutoMode or blockReadsOutsideWorkingDirectories makes Claude Code ignore the whole file", () => {
  const cases = [
    { autoMode: { allow: "x" } }, { autoMode: "x" }, { autoMode: { classifyAllShell: "true" } }, { autoMode: { allow: ["$defaults", 5] } },
    { permissions: { disableAutoMode: true } }, { permissions: { disableAutoMode: "enable" } }, { permissions: { blockReadsOutsideWorkingDirectories: "true" } },
  ];
  for (const bad of cases) {
    const w = world("wrongtype", { user: { ...bad, permissions: { ...(bad.permissions || {}), deny: ["Bash(rm *)"] } } });
    const s = load(w);
    const f = s.files.find((x) => x.scope === "user");
    assert.equal(f.ignored && f.ignored.reason, "wrong-type", JSON.stringify(bad));
    assert.equal(s.rules.length, 0, "the deny rule in the same file does not apply either");
  }
});

test("a key the block does not know leaves the file alone", () => {
  const w = world("unknown", { user: { autoMode: { softDeny: ["x"] }, permissions: { deny: ["Bash(rm *)"] } } });
  const s = load(w);
  const f = s.files.find((x) => x.scope === "user");
  assert.equal(f.ignored, null);
  assert.equal(s.rules.length, 1);
  assert.deepEqual(f.view.autoMode.unknown.map((u) => u.key), ["softDeny"]);
});

test("an empty list is fine; permissions.ask with a non-string entry does not cost the file", () => {
  const w = world("empty", { user: { autoMode: { environment: [] }, permissions: { allow: ["Bash(x)"], ask: [1] } } });
  const f = load(w).files.find((x) => x.scope === "user");
  assert.equal(f.ignored, null);
});

test("the rules of the files that apply are joined, with the file each came from", () => {
  const w = world("rules", { user: { permissions: { allow: ["Bash(a *)"] } }, project: { permissions: { allow: ["Bash(b *)"], deny: ["Bash(c *)"] } }, local: { permissions: { ask: ["Bash(d *)"] } } });
  const s = load(w);
  assert.deepEqual(s.rules.map((r) => [r.behavior, r.raw, r.scope]).sort(), [["allow", "Bash(a *)", "user"], ["allow", "Bash(b *)", "project"], ["ask", "Bash(d *)", "local"], ["deny", "Bash(c *)", "project"]]);
});

test("allowManagedPermissionRulesOnly in managed settings makes the engine ignore the rules of the other files", () => {
  const w = world("only", { user: { permissions: { allow: ["Bash(a *)"] } }, managed: { allowManagedPermissionRulesOnly: true, permissions: { allow: ["Bash(m *)"] } } });
  const s = load(w);
  assert.equal(s.managedOnly, true);
  assert.ok(s.rules.find((r) => r.raw === "Bash(a *)").ignored);
  assert.ok(!s.rules.find((r) => r.raw === "Bash(m *)").ignored);
});

test("analyzeText: strict JSON loads, comments and trailing commas do not, an empty file is an empty object", () => {
  assert.equal(analyzeText('{"a":1}').ignored, false);
  assert.equal(analyzeText("").data !== null && analyzeText("").empty, true);
  assert.equal(analyzeText("   \n").empty, true);
  assert.equal(analyzeText('{"a":1 // x\n}').problems[0].kind, "comment");
  assert.equal(analyzeText('{"a":1,}').problems[0].kind, "trailing-comma");
  assert.equal(analyzeText("[1]").problems[0].kind, "not-object");
  assert.equal(analyzeText("{").problems[0].kind, "syntax");
  assert.equal(analyzeText("﻿{\"a\":1}").ignored, false, "a byte-order mark is fine");
});

test("paths with spaces and backslashes in the project folder are handled", () => {
  const base = tmpDir("cad space ");
  const work = path.join(base, "my project (2)");
  fs.mkdirSync(path.join(work, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(work, ".claude", "settings.json"), JSON.stringify({ permissions: { allow: ["Bash(ls *)"] } }));
  const w = world("space");
  const s = loadSettings({ project: work, env: w.env, home: w.home, managed: w.managedDir });
  const f = s.files.find((x) => x.scope === "project");
  assert.equal(f.exists, true);
  assert.equal(f.display, ".claude/settings.json");
  assert.equal(s.rules.length, 1);
});
