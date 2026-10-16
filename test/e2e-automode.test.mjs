// Checks against the real Claude Code binary (run only when E2E_CLAUDE points at one) about the autoMode block and what the
// lint says of it:
//   b. the autoMode block: "$defaults", the files it is read from, wrong types, and `claude auto-mode config` against `show`;
//   c. the traps lint reports: permissions.disableAutoMode, the Bash-first instruction, the path-scoped rule files of issue 88565;
//   d. what a classified command costs: the request sizes `cost` quotes, and when stage two is asked.
// (a, the decisions, is test/e2e-claude.test.mjs; the table for `why` is test/auto-oracle.test.mjs.)
// Everything runs against a fake API on 127.0.0.1: no model is reached, no token is spent, and every run has its own throwaway
// HOME, USERPROFILE and CLAUDE_CONFIG_DIR.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { run, world } from "./helpers.mjs";
import { callsOf, claudeInfo, claudeSync, fakeApi, put, readLog, recorder, runClaude, sandbox, severity, skip, stage2, stageOf, systemText, transcriptLines } from "./claude-sandbox.mjs";
import { MEASURED } from "../src/measured.mjs";
import { loadSettings } from "../src/settings.mjs";

const bash = (command) => ({ tool: "Bash", input: { command, description: "check" } });
const ROUTINE = bash("mytool deploy --prod");

/** Run one classified command with these settings and say what the classifier was sent. */
async function classified(label, { user, project, local, args = [], calls = [ROUTINE], stage1 = severity(5), stage2: s2 } = {}) {
  const sb = sandbox(label);
  for (const [name, value] of [["user", user], ["project", project], ["local", local]]) if (value !== undefined) put(sb[name], value);
  const api = await fakeApi({ calls, stage1, stage2: s2 });
  try {
    const r = await runClaude(sb, api, ["-p", "run it", "--output-format", "json", "--permission-mode", "auto", "--max-turns", "2", ...args]);
    const cls = api.classifier();
    return { sb, r, cls, prompt: cls[0] ? systemText(cls[0]) : null };
  } finally { await api.close(); }
}

const autoMode = (sb, args = []) => {
  const r = claudeSync(sb, ["auto-mode", ...args]);
  assert.equal(r.status, 0, r.all);
  return JSON.parse(r.out);
};

/** Run `items` through `fn`, `width` at a time. */
async function pool(items, width, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: width }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }));
  return out;
}

// ---- (b) the autoMode block ------------------------------------------------------------------------------------------------

test("claude auto-mode defaults prints the built-in rules: the numbers the lint quotes", { skip: skip(), timeout: 120000 }, (t) => {
  const d = autoMode(sandbox("defaults"), ["defaults"]);
  assert.deepEqual(Object.keys(d).sort(), ["allow", "environment", "hard_deny", "soft_deny"]);
  const counts = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.length]));
  t.diagnostic(`Claude Code ${claudeInfo().version}: ${counts.allow} allow, ${counts.soft_deny} soft_deny, ${counts.hard_deny} hard_deny and ${counts.environment} environment rules`);
  for (const v of Object.values(d)) assert.ok(v.length > 0 && v.every((x) => typeof x === "string"));
  if (claudeInfo().number === MEASURED.version) assert.deepEqual(counts, MEASURED.builtin, "the figures the lint quotes are the binary's");
});

test("a list without $defaults replaces the built-in rules in the classifier's prompt; with it they stay (allow, soft_deny, hard_deny, environment)", { skip: skip(), timeout: 600000 }, async (t) => {
  const defaults = autoMode(sandbox("defaults2"), ["defaults"]);
  const base = await classified("am-base", {});
  assert.ok(base.prompt, "the classifier was asked");
  const probe = (key, i) => defaults[key][i].slice(0, 70);
  for (const key of ["allow", "soft_deny", "hard_deny", "environment"]) {
    const first = probe(key, 0);
    const last = probe(key, defaults[key].length - 1);
    assert.ok(base.prompt.includes(first) && base.prompt.includes(last), `${key}: the built-in rules are in the prompt`);
    const without = await classified(`am-${key}-no`, { user: { autoMode: { [key]: ["CAD-MARK"] } } });
    const withDefaults = await classified(`am-${key}-yes`, { user: { autoMode: { [key]: ["CAD-MARK", "$defaults"] } } });
    assert.ok(without.prompt.includes("CAD-MARK") && withDefaults.prompt.includes("CAD-MARK"), `${key}: your entry is in the prompt either way`);
    assert.ok(!without.prompt.includes(first) && !without.prompt.includes(last), `${key}: without $defaults the built-in rules are gone`);
    assert.ok(withDefaults.prompt.includes(first) && withDefaults.prompt.includes(last), `${key}: with $defaults they stay`);
    // the built-in text taken out: the prompt shrank by this much, and the one line of your own entry went in
    const removed = base.prompt.length - without.prompt.length + "- CAD-MARK\n".length;
    t.diagnostic(`${key}: a list without $defaults took ${removed.toLocaleString("en-US")} characters of built-in rules out of a prompt of ${base.prompt.length.toLocaleString("en-US")}; with $defaults the prompt grew by ${withDefaults.prompt.length - base.prompt.length}`);
    assert.ok(removed > 1000);
    assert.ok(withDefaults.prompt.length - base.prompt.length < 100);
    if (claudeInfo().number === MEASURED.version) assert.equal(removed, MEASURED.removedChars[key], `${key}: the figure the lint quotes`);
  }
});

test("an empty list changes nothing, and a second $defaults adds nothing", { skip: skip(), timeout: 300000 }, async () => {
  const base = await classified("am-e-base", {});
  const empty = await classified("am-e-empty", { user: { autoMode: { soft_deny: [], allow: [], environment: [], hard_deny: [] } } });
  assert.equal(empty.prompt.length, base.prompt.length);
  const twice = await classified("am-e-twice", { user: { autoMode: { hard_deny: ["$defaults", "CAD-MARK", "$defaults"] } } });
  const once = await classified("am-e-once", { user: { autoMode: { hard_deny: ["$defaults", "CAD-MARK"] } } });
  assert.equal(twice.prompt.length, once.prompt.length);
});

test("the autoMode block is read from the user's settings and the --settings flag, not from the project's or the local file", { skip: skip(), timeout: 300000 }, async (t) => {
  const mark = (name) => ({ autoMode: { allow: [name, "$defaults"] } });
  const user = await classified("sc-user", { user: mark("MARK-USER") });
  const project = await classified("sc-project", { project: mark("MARK-PROJECT") });
  const local = await classified("sc-local", { local: mark("MARK-LOCAL") });
  const flag = await classified("sc-flag", { args: ["--settings", JSON.stringify(mark("MARK-FLAG"))] });
  assert.ok(user.prompt.includes("MARK-USER"));
  assert.ok(!project.prompt.includes("MARK-PROJECT"), "not from .claude/settings.json");
  assert.ok(!local.prompt.includes("MARK-LOCAL"), "not from .claude/settings.local.json");
  assert.ok(flag.prompt.includes("MARK-FLAG"), "the --settings flag is a source too");
  // two sources: the entries are added, and the built-in rules stay when either has "$defaults"
  const both = await classified("sc-both", { user: { autoMode: { allow: ["MARK-USER"] } }, args: ["--settings", JSON.stringify(mark("MARK-FLAG"))] });
  assert.ok(both.prompt.includes("MARK-USER") && both.prompt.includes("MARK-FLAG"));
  const base = await classified("sc-base", {});
  assert.ok(both.prompt.length > base.prompt.length - 100, "the built-in rules stayed because the flag's list has $defaults");
  t.diagnostic("user + --settings: both entries are in the prompt, and the built-in rules stay when either list has $defaults");
});

// every value put to the binary: does the file that holds it still apply? (a `model` in the same file arrives or does not)
const TYPE_ROWS = [
  [{ autoMode: "x" }, true], [{ autoMode: 5 }, true], [{ autoMode: true }, true], [{ autoMode: null }, true], [{ autoMode: ["x"] }, true], [{ autoMode: {} }, false], [{ autoMode: [] }, true],
  [{ autoMode: { allow: [] } }, false], [{ autoMode: { allow: ["x"] } }, false], [{ autoMode: { allow: "x" } }, true], [{ autoMode: { allow: [1] } }, true], [{ autoMode: { allow: ["x", null] } }, true], [{ autoMode: { allow: null } }, true], [{ autoMode: { allow: {} } }, true], [{ autoMode: { allow: [[]] } }, true], [{ autoMode: { allow: [true] } }, true], [{ autoMode: { allow: [""] } }, false],
  [{ autoMode: { soft_deny: {} } }, true], [{ autoMode: { soft_deny: 5 } }, true], [{ autoMode: { hard_deny: "x" } }, true], [{ autoMode: { hard_deny: null } }, true], [{ autoMode: { environment: "x" } }, true], [{ autoMode: { environment: [1] } }, true], [{ autoMode: { environment: null } }, true],
  [{ autoMode: { classifyAllShell: "true" } }, true], [{ autoMode: { classifyAllShell: 1 } }, true], [{ autoMode: { classifyAllShell: null } }, true], [{ autoMode: { classifyAllShell: false } }, false], [{ autoMode: { classifyAllShell: true } }, false], [{ autoMode: { classifyAllShell: [] } }, true],
  [{ autoMode: { unknownKey: 1 } }, false], [{ autoMode: { softDeny: ["x"] } }, false], [{ autoMode: { allow: ["$defaults"] } }, false],
  [{ permissions: { disableAutoMode: true } }, true], [{ permissions: { disableAutoMode: false } }, true], [{ permissions: { disableAutoMode: "enable" } }, true], [{ permissions: { disableAutoMode: "disable" } }, false], [{ permissions: { disableAutoMode: "Disable" } }, true], [{ permissions: { disableAutoMode: null } }, true], [{ permissions: { disableAutoMode: 0 } }, true], [{ permissions: { disableAutoMode: [] } }, true],
  [{ permissions: { blockReadsOutsideWorkingDirectories: "true" } }, true], [{ permissions: { blockReadsOutsideWorkingDirectories: 1 } }, true], [{ permissions: { blockReadsOutsideWorkingDirectories: null } }, true], [{ permissions: { blockReadsOutsideWorkingDirectories: true } }, false], [{ permissions: { blockReadsOutsideWorkingDirectories: false } }, false], [{ permissions: { blockReadsOutsideWorkingDirectories: [] } }, true],
];

test("a value of the wrong type in autoMode, permissions.disableAutoMode or permissions.blockReadsOutsideWorkingDirectories makes Claude Code ignore the whole file, in the user, project and local file; the loader says the same", { skip: skip(), timeout: 900000 }, async (t) => {
  const jobs = [];
  for (const scope of ["user", "project", "local"]) for (const [v, ignored] of TYPE_ROWS) jobs.push({ scope, v, ignored });
  const results = await pool(jobs, 6, async (j) => {
    const sb = sandbox("types");
    put(sb[j.scope], { model: "m-probe", ...j.v });
    const api = await fakeApi();
    try {
      await runClaude(sb, api, ["-p", "PROBE-MAIN hello", "--output-format", "json"]);
      const req = api.conversation()[0];
      const s = loadSettings({ project: sb.work, env: { CLAUDE_CONFIG_DIR: sb.cfg, HOME: sb.home, USERPROFILE: sb.home }, home: sb.home, managed: sb.managed });
      const f = s.files.find((x) => x.scope === j.scope);
      return { ...j, applied: Boolean(req) && req.model === "m-probe", toolSays: Boolean(f.ignored) };
    } finally { await api.close(); }
  });
  const wrong = results.filter((r) => r.applied === r.ignored || r.toolSays !== r.ignored);
  t.diagnostic(`${results.length} files (${TYPE_ROWS.length} values in 3 places): ${results.filter((r) => !r.applied).length} were ignored whole, ${results.filter((r) => r.applied).length} were read`);
  assert.deepEqual(wrong.map((r) => `${r.scope} ${JSON.stringify(r.v)}: ${r.applied ? "read" : "ignored"}, tool says ${r.toolSays ? "ignored" : "read"}`), []);
});

test("`claude auto-mode config` is what `show` says the classifier gets: the user's lists in place, $defaults spliced where it is, other files ignored", { skip: skip(), timeout: 300000 }, async () => {
  const defaults = autoMode(sandbox("cfgdef"), ["defaults"]);
  const VARIANTS = [
    {},
    { user: { autoMode: { allow: ["A"] } } },
    { user: { autoMode: { allow: ["A", "$defaults"] } } },
    { user: { autoMode: { allow: ["$defaults", "A", "B"], soft_deny: ["S"], hard_deny: ["H", "$defaults"], environment: ["Org: X"] } } },
    { user: { autoMode: { soft_deny: [] } } },
    { user: { autoMode: { hard_deny: ["$defaults", "H", "$defaults"] } } },
    { project: { autoMode: { allow: ["P"] } }, local: { autoMode: { allow: ["L"] } } },
    { user: { autoMode: { allow: ["A"] }, permissions: { allow: ["Bash(ls *)"] } }, project: { autoMode: { soft_deny: ["P"] } } },
    { user: { autoMode: { allow: "x" } } },
    { user: { autoMode: { classifyAllShell: "yes" } } },
    { user: "{\n  // a note\n  \"autoMode\": { \"allow\": [\"A\"] }\n}\n" },
    { user: { autoMode: { allow: [""] } } },
  ];
  for (const v of VARIANTS) {
    const sb = sandbox("cfg");
    for (const [name, value] of Object.entries(v)) put(sb[name], value);
    const binary = autoMode(sb, ["config"]);
    const w = world("cfgshow");
    for (const [name, value] of Object.entries(v)) put(name === "user" ? w.userFile : name === "project" ? w.projectFile : w.localFile, value);
    const m = (await run(["show", "--json"], w)).json();
    for (const key of ["allow", "soft_deny", "hard_deny", "environment"]) {
      const expected = [];
      for (const e of m.autoMode.lists[key].effective) { if (e.defaults) expected.push(...defaults[key]); else expected.push(e.text); }
      assert.deepEqual(binary[key], expected, `${key} for ${JSON.stringify(v)}`);
    }
  }
});

// ---- (c) the traps lint reports ---------------------------------------------------------------------------------------------

test("permissions.disableAutoMode set to disable, in the user, project or local file, turns auto mode off: the classifier is not asked and the command is not run", { skip: skip(), timeout: 300000 }, async () => {
  const off = [];
  for (const scope of ["user", "project", "local"]) {
    const r = await classified(`dis-${scope}`, { [scope]: { permissions: { disableAutoMode: "disable" } } });
    assert.equal(r.cls.length, 0, `${scope}: no classifier request`);
    const calls = callsOf(r.sb);
    assert.equal(calls[0].kind, "user-rejected", `${scope}: the command needed approval, and -p cannot ask`);
    off.push(scope);
  }
  const on = await classified("dis-none", {});
  assert.equal(on.cls.length, 1);
  assert.deepEqual(off, ["user", "project", "local"]);
});

test("auto mode tells Claude it can do much of its work through Bash (the Bash-first instruction the lint speaks of); its words are recorded", { skip: skip(), timeout: 120000 }, async (t) => {
  const sb = sandbox("bashfirst");
  const api = await fakeApi({ calls: [ROUTINE] });
  try {
    await runClaude(sb, api, ["-p", "PROBE-MAIN hello", "--output-format", "json", "--permission-mode", "auto"]);
    const first = api.conversation()[0];
    const blocks = [systemText(first), ...(first.messages || []).flatMap((m) => (Array.isArray(m.content) ? m.content : [m.content])).map((b) => (typeof b === "string" ? b : (b && b.text) || ""))];
    const text = blocks.find((b) => b.includes("While auto mode is active"));
    assert.ok(text, "the instruction is in the request");
    const sentence = /While auto mode is active:\s*([^\n]+)/.exec(text)[1];
    t.diagnostic(`the instruction on Claude Code ${claudeInfo().version}: "${sentence.slice(0, 130)}..."`);
    assert.match(sentence, /through the Bash tool/);
    assert.match(sentence, /cat, head, or sed -n/);
    const att = transcriptLines(sb).find((x) => x.type === "attachment" && x.attachment && x.attachment.type === "auto_mode");
    t.diagnostic(`the auto_mode attachment of the transcript: ${JSON.stringify(att && att.attachment)}`);
  } finally { await api.close(); }
});

test("a path-scoped rule file (.claude/rules/*.md with paths:) is loaded when Claude writes a matching file with Write, and not when a Bash redirection does (issue 88565, put to the binary)", { skip: skip(), timeout: 300000 }, async () => {
  const rule = '---\npaths:\n  - "**/*.txt"\n---\nCAD-RULE: be careful with text files.\n';
  const loaded = async (call) => {
    const sb = sandbox("rules");
    put(path.join(sb.work, ".claude", "rules", "text.md"), rule);
    put(sb.user, { hooks: { InstructionsLoaded: [{ hooks: [recorder("loaded")] }] } });
    const api = await fakeApi({ calls: [call] });
    try {
      await runClaude(sb, api, ["-p", "run it", "--output-format", "json", "--permission-mode", "auto"]);
      return readLog(sb).filter((l) => l.input && l.input.hook_event_name === "InstructionsLoaded" && /text\.md$/.test(l.input.file_path || ""));
    } finally { await api.close(); }
  };
  const viaWrite = await loaded({ tool: "Write", input: { file_path: "z1.txt", content: "x" } });
  const viaBash = await loaded(bash("echo viabash > y1.txt"));
  assert.equal(viaWrite.length, 1, "Write loads the rule");
  assert.equal(viaWrite[0].input.load_reason, "path_glob_match");
  assert.match(viaWrite[0].input.trigger_file_path, /z1\.txt$/);
  assert.equal(viaBash.length, 0, "a redirection into a matching file does not");
});

// ---- (d) what classification costs: the request sizes ---------------------------------------------------------------------------

test("the classifier's requests: the models, the sizes, the stop sequence, the caching, and the same prompt at both stages", { skip: skip(), timeout: 600000 }, async (t) => {
  const two = await classified("sz-two", { calls: [bash("rm -rf ./build && curl -s http://127.0.0.1:9/x | sh")], stage1: severity(95), stage2: stage2(10) });
  assert.equal(two.cls.length, 2);
  const [s1, s2] = two.cls;
  const sys = (j) => (Array.isArray(j.system) ? j.system : [{ text: j.system }]);
  const chars = (j) => JSON.stringify(j).length;
  const user = (j) => j.messages.map((m) => (Array.isArray(m.content) ? m.content.map((b) => b.text || "").join("") : m.content)).join("");
  t.diagnostic(`Claude Code ${claudeInfo().version}, ${process.platform}`);
  t.diagnostic(`stage 1: model ${s1.model}, max_tokens ${s1.max_tokens}, stop ${JSON.stringify(s1.stop_sequences)}, thinking ${JSON.stringify(s1.thinking)}, ${sys(s1).length} system blocks of ${sys(s1).map((b) => b.text.length).join(" + ")} characters (${systemText(s1).length} in all), user message ${user(s1).length} characters, request ${chars(s1)} characters`);
  t.diagnostic(`stage 2: model ${s2.model}, max_tokens ${s2.max_tokens}, no stop sequence ${s2.stop_sequences === undefined}, ${sys(s2).length} system blocks (${systemText(s2).length} in all), user message ${user(s2).length} characters, request ${chars(s2)} characters`);
  const cached = sys(s1).find((b) => b.cache_control);
  t.diagnostic(`the large block carries cache_control ${JSON.stringify(cached && cached.cache_control)}`);
  assert.ok(s1.max_tokens <= 200 && (s1.stop_sequences || []).includes("</severity>"), "stage one answers a severity only");
  assert.ok(s2.max_tokens > s1.max_tokens && !s2.stop_sequences, "stage two reasons first");
  assert.equal(systemText(s1), systemText(s2), "the same system prompt at both stages");
  assert.ok(systemText(s1).length > 100000, "a system prompt of over a hundred thousand characters");
  assert.ok(sys(s1).some((b) => b.cache_control && b.cache_control.type === "ephemeral"), "the large block is marked for caching");
  assert.ok(!s1.tools && !s2.tools, "no tools");
  assert.match(user(s1), /<transcript>[\s\S]*"Bash"[\s\S]*<\/transcript>/);
  assert.match(user(s1), /<severity>N<\/severity>/);
  assert.match(user(s2), /<thinking>/);
  if (claudeInfo().number === MEASURED.version) {
    assert.equal(s1.model, MEASURED.stages.one.model);
    assert.equal(s1.max_tokens, MEASURED.stages.one.maxTokens);
    assert.equal(s2.model, MEASURED.stages.two.model);
    assert.equal(s2.max_tokens, MEASURED.stages.two.maxTokens);
    assert.ok(Math.abs(systemText(s1).length - MEASURED.prompt.totalSystemChars) <= 60, `the system prompt size that cost quotes: ${systemText(s1).length} here (it holds the operating system user name, so it differs by a few characters between machines)`);
    assert.equal(sys(s1).length, MEASURED.prompt.blocks);
    assert.equal(user(s1).length, MEASURED.stages.one.userChars, "the user message of a one-line session, stage one");
    assert.equal(user(s2).length, MEASURED.stages.two.userChars, "the user message of a one-line session, stage two");
  }
});

test("stage one clears a command up to a severity and hands the rest to stage two", { skip: skip(), timeout: 600000 }, async (t) => {
  const seen = {};
  for (const n of [5, 25, 26, 40, 95]) {
    const r = await classified(`thr-${n}`, { stage1: severity(n), stage2: stage2(5) });
    seen[n] = r.cls.length;
  }
  t.diagnostic(`classifier requests by the severity stage one answered: ${JSON.stringify(seen)}`);
  assert.equal(seen[5], 1);
  assert.equal(seen[95], 2);
  if (claudeInfo().number === MEASURED.version) assert.deepEqual([seen[MEASURED.stageOneClears.upTo], seen[MEASURED.stageOneClears.goesOnFrom]], [1, 2]);
});

test("a classifier that answers something that is not a verdict is asked again: five times at each stage on the version measured", { skip: skip(), timeout: 600000 }, async (t) => {
  const garbage = await classified("att-garbage", { stage1: "ok", stage2: "ok" });
  const byStage = [garbage.cls.filter((j) => stageOf(j) === 1).length, garbage.cls.filter((j) => stageOf(j) === 2).length];
  t.diagnostic(`answers that are not verdicts: ${byStage[0]} requests at stage one and ${byStage[1]} at stage two`);
  assert.ok(byStage[0] > 1 && byStage[1] > 1);
  if (claudeInfo().number === MEASURED.version) assert.deepEqual(byStage, [MEASURED.attempts.stageOne, MEASURED.attempts.stageTwo]);
});

test("when the classifier's model is overloaded, five requests to it are followed by five to the session's own model, and the refusal names that one", { skip: skip(), timeout: 600000 }, async (t) => {
  const r = await classified("fallback", { args: ["--model", "m-probe"], stage1: { status: 529 }, stage2: { status: 529 } });
  const models = r.cls.map((j) => j.model);
  t.diagnostic(`models asked, in order: ${models.join(" ")}; max_tokens ${r.cls.map((j) => j.max_tokens).join(" ")}`);
  assert.notEqual(models[0], "m-probe", "the classifier's own model is asked first");
  assert.equal(models[models.length - 1], "m-probe", "and the session's model last");
  const text = callsOf(r.sb)[0].text;
  assert.match(text, /^m-probe is temporarily unavailable \(overloaded\), so auto mode cannot determine the safety of Bash/, "the refusal names the session's model, not the classifier's");
  if (claudeInfo().number === MEASURED.version) {
    assert.deepEqual([models.filter((m) => m !== "m-probe").length, models.filter((m) => m === "m-probe").length], [MEASURED.attempts.stageOne, MEASURED.fallback.attempts]);
    assert.equal(r.cls[models.length - 1].max_tokens, MEASURED.fallback.maxTokens);
  }
});

test("a comment or a trailing comma in the settings file makes Claude Code ignore the whole file, the autoMode block in it too; strict JSON is read", { skip: skip(), timeout: 300000 }, async (t) => {
  const block = '"autoMode": { "environment": ["COMMENT-MARK-RULE"] }';
  const kinds = {
    "a // comment": `{\n  // my rules\n  ${block}\n}\n`,
    "a /* */ comment": `{\n  /* my rules */\n  ${block}\n}\n`,
    "a trailing comma": `{\n  "autoMode": { "environment": ["COMMENT-MARK-RULE"], }\n}\n`,
    "strict JSON": `{\n  ${block}\n}\n`,
  };
  const seen = {};
  for (const [kind, text] of Object.entries(kinds)) seen[kind] = (await classified("cmt", { user: text })).prompt.includes("COMMENT-MARK-RULE");
  t.diagnostic(`the rule reached the classifier's prompt: ${JSON.stringify(seen)}`);
  assert.deepEqual(seen, { "a // comment": false, "a /* */ comment": false, "a trailing comma": false, "strict JSON": true });
});

test("a key the block does not have (softDeny, deny) is ignored: its entries never reach the classifier, and the file is still read", { skip: skip(), timeout: 300000 }, async () => {
  const typo = await classified("typo", { user: { autoMode: { softDeny: ["TYPO-MARK-RULE"], deny: ["TYPO-MARK-RULE-2"], environment: ["TYPO-KEPT-RULE"] } } });
  assert.ok(!typo.prompt.includes("TYPO-MARK-RULE"), "softDeny");
  assert.ok(!typo.prompt.includes("TYPO-MARK-RULE-2"), "deny");
  assert.ok(typo.prompt.includes("TYPO-KEPT-RULE"), "the rest of the block is read");
});
