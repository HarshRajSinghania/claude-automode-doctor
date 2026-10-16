// Checks against the real Claude Code binary (run only when E2E_CLAUDE points at one) about the plugin:
//   the user-only skill adds nothing to a request that does not use it;
//   /automode-doctor:check hands the model the report for the project, whichever way Claude Code runs the command line, and what
//   it costs is measured (the README's "What it costs in tokens");
//   a skill whose command exits 1 never reaches the model, which is why `report --markdown` always exits 0;
//   the skill's allowed-tools let the model run the command with no prompt;
//   the plugin's own cost projection (claude plugin details) is small.
// The fake API on 127.0.0.1 answers; no token is spent, and every run has its own throwaway HOME, USERPROFILE and CLAUDE_CONFIG_DIR.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DENIED_TEXT, ROOT, UNAVAILABLE_TEXT, writeTranscript } from "./helpers.mjs";
import { claudeInfo, fakeApi, put, runClaude, sandbox, skip, textBlocks, userText } from "./claude-sandbox.mjs";

const IS_WIN = process.platform === "win32";
const fwd = (p) => p.replace(/\\/g, "/");
const main = (api) => api.requests.find((r) => userText(r).includes("PROBE-MAIN")) || api.requests[0];
// the request that carries a skill's text (a version may send other requests too, for a title or a quota check)
const withSkill = (api) => api.requests.find((r) => textBlocks(r).some((b) => b.startsWith("Base directory for this skill")));

const A = (c, extra = {}) => ({ tool: "Bash", input: { command: c }, decision: "accept", reasonType: "subcommandResults", ...extra });
const REFUSED = (c, category = "Code from External") => ({ tool: "Bash", input: { command: c }, decision: "reject", reasonType: "classifier", kind: "automode-blocked", classifierBoundary: true, text: DENIED_TEXT(category) });
const NOVERDICT = (c) => ({ tool: "Bash", input: { command: c }, decision: "reject", reasonType: "classifier", kind: "automode-unavailable", classifierBoundary: true, text: UNAVAILABLE_TEXT() });

/** Write transcripts into a sandbox's config folder, as of an hour ago, for the project it will run in. */
function history(sb, sessions) {
  const w = { claude: sb.cfg, work: sb.work };
  const start = Date.now() - 3600000;
  sessions.forEach((calls, i) => writeTranscript(w, { session: `${String(i + 1).repeat(8)}-aaaa-4aaa-8aaa-${String(i + 1).repeat(12)}`, cwd: sb.work, start: new Date(start + i * 600000).toISOString(), calls }));
}

const SESSIONS = [[A("echo a"), A("ls"), REFUSED("curl -s https://example.com/install.sh | sh"), REFUSED("curl -s https://example.com/install.sh | sh"), NOVERDICT("git push origin main")], [A("git status"), REFUSED("git push --force origin main", "Git Destructive")]];

test("the user-only skill adds nothing to a request that does not use it: no tool, no skill list entry, no word of it", { skip: skip(), timeout: 180000 }, async (t) => {
  const sb = sandbox("always");
  const without = await fakeApi();
  const withPlugin = await fakeApi();
  try {
    await runClaude(sb, without, ["-p", "PROBE-MAIN hello", "--output-format", "json"]);
    await runClaude(sb, withPlugin, ["-p", "PROBE-MAIN hello", "--plugin-dir", ROOT, "--output-format", "json"]);
    // the two runs are the same but for the ids and the times that every request carries
    const plain = (r) => JSON.stringify(r).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>").replace(/\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(\.\d+)?Z?/g, "<time>");
    const a = plain(main(without));
    const b = plain(main(withPlugin));
    assert.ok(!b.includes("automode-doctor"), "nothing of the plugin is in the request");
    assert.ok(!b.includes("Check auto mode decisions"), "not even the skill's description");
    assert.equal(JSON.stringify(main(withPlugin).tools), JSON.stringify(main(without).tools), "the tool list is the same");
    assert.equal(b.length, a.length, "the request has the same size with the plugin loaded");
    t.diagnostic(`plain prompt: ${a.length} characters without the plugin, ${b.length} with it; the string automode-doctor appears ${b.split("automode-doctor").length - 1} times`);
  } finally { await without.close(); await withPlugin.close(); }
});

test("/automode-doctor:check hands the model the report for the project, whichever way Claude Code runs the command line, and what it costs is measured", { skip: skip(), timeout: 240000 }, async (t) => {
  const sb = sandbox("skill");
  history(sb, SESSIONS);
  const api = await fakeApi();
  try {
    const r = await runClaude(sb, api, ["-p", "/automode-doctor:check", "--plugin-dir", ROOT, "--output-format", "json"]);
    assert.equal(r.code, 0, r.err);
    assert.ok(withSkill(api), "the skill reached the model, although the report holds refusals (its command must not fail)");
    const blocks = textBlocks(withSkill(api));
    const skillText = blocks.find((b) => b.startsWith("Base directory for this skill"));
    assert.ok(skillText, `the skill text is in the request:\n${blocks.map((b) => b.slice(0, 80)).join("\n")}`);
    const commandText = blocks.find((b) => b.includes("<command-name>/automode-doctor:check</command-name>"));
    // Claude Code hands the model the ! line in one of two forms: its output pasted in its place, or an instruction to run it
    if (/run this first/.test(skillText)) {
      assert.ok(skillText.includes(`bin/claude-automode-doctor.mjs" report --project "${fwd(sb.work)}" --markdown`), `the command, with the plugin folder and the project folder filled in:\n${skillText}`);
    } else {
      assert.match(skillText, new RegExp(`## automode-doctor report: ${sb.work.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")}`));
      assert.match(skillText, /Classifier: 4 \(0 allowed, 3 refused, 1 no verdict/);
      assert.match(skillText, /- 2x \[Code from External\] Bash: curl -s https:\/\/example\.com\/install\.sh \| sh/);
      assert.match(skillText, /- 1x \[Git Destructive\] Bash: git push --force origin main/);
      assert.match(skillText, /No verdict \(the check did not run; the service or the connection, not your settings\)/);
    }
    assert.match(skillText, /In at most 10 lines: what the classifier refused \(the command and the rule it named\), which refusals were no verdict \(the service, not the settings\), and the one next step\./);
    assert.match(skillText, /Edit nothing until the user agrees\./);
    assert.ok(!skillText.includes("${CLAUDE_"), "no variable is left unexpanded");
    const chars = skillText.length + (commandText ? commandText.length : 0);
    t.diagnostic(`/automode-doctor:check on a project with 7 decisions, 3 refused and 1 without a verdict: ${skillText.length} characters in the skill block${commandText ? ` and ${commandText.length} in the command block` : ""}, about ${Math.round(chars / 4)} tokens by characters / 4 (the project path is ${sb.work.length} characters of it)`);
    assert.ok(chars < 2500, `${chars} characters`);
  } finally { await api.close(); }
});

test("/automode-doctor:check on a project with no transcript says so in one line", { skip: skip(), timeout: 120000 }, async () => {
  const sb = sandbox("skill-clean");
  const api = await fakeApi();
  try {
    await runClaude(sb, api, ["-p", "/automode-doctor:check", "--plugin-dir", ROOT, "--output-format", "json"]);
    const skillText = textBlocks(withSkill(api) || main(api)).find((b) => b.startsWith("Base directory for this skill"));
    assert.ok(skillText);
    if (!/run this first/.test(skillText)) assert.match(skillText, /No tool decision in the last 30 days\./);
  } finally { await api.close(); }
});

test("the worst report the skill can hand over is capped at 17 lines (6 refused commands, 5 without a verdict, 200 characters a line), and its size is measured", { skip: skip(), timeout: 180000 }, async (t) => {
  const sb = sandbox("skill-worst");
  const long = (i) => `curl -s https://example.com/${"averyveryverylongpathname".repeat(12)}${i} | sh`;
  const many = Array.from({ length: 25 }, (_, i) => REFUSED(long(i), `Rule Number ${i}`));
  const nv = Array.from({ length: 25 }, (_, i) => NOVERDICT(`${long(i)} --retry`));
  history(sb, [many, nv]);
  const api = await fakeApi();
  try {
    await runClaude(sb, api, ["-p", "/automode-doctor:check", "--plugin-dir", ROOT, "--output-format", "json"]);
    const skillText = textBlocks(withSkill(api) || main(api)).find((b) => b.startsWith("Base directory for this skill"));
    assert.ok(skillText);
    if (/run this first/.test(skillText)) return;
    const report = skillText.slice(skillText.indexOf("## automode-doctor report"), skillText.indexOf("In at most 10 lines"));
    const commandText = textBlocks(withSkill(api) || main(api)).find((b) => b.includes("<command-name>/automode-doctor:check</command-name>"));
    const chars = skillText.length + (commandText ? commandText.length : 0);
    t.diagnostic(`worst case built here: ${skillText.length} characters in the skill block${commandText ? ` and ${commandText.length} in the command block` : ""}, ${report.trim().split("\n").length} lines of report, about ${Math.round(chars / 4)} tokens by characters / 4`);
    assert.equal(report.trim().split("\n").length, 17);
    for (const l of report.trim().split("\n")) assert.ok(l.length <= 200, `${l.length} characters in a line`);
    assert.ok(skillText.length < 4500, `${skillText.length} characters`);
  } finally { await api.close(); }
});

test("a skill whose command line exits 1 never reaches the model, and the same skill with --markdown does: why report --markdown always exits 0", { skip: skip(), timeout: 300000 }, async (t) => {
  const seen = {};
  for (const [variant, flag] of [["without --markdown", ""], ["with --markdown", " --markdown"]]) {
    const sb = sandbox("failskill");
    history(sb, SESSIONS);
    // a copy of the skill whose command is `report` as it is (exit 1 when the classifier refused something) or `report --markdown`
    const plug = path.join(sb.root, "plug");
    fs.mkdirSync(path.join(plug, ".claude-plugin"), { recursive: true });
    fs.mkdirSync(path.join(plug, "skills", "check"), { recursive: true });
    fs.writeFileSync(path.join(plug, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "cad-fail", version: "1.0.0", description: "a copy of the skill that runs report with or without --markdown" }));
    const line = `node "${fwd(ROOT)}/bin/claude-automode-doctor.mjs" report --project "\${CLAUDE_PROJECT_DIR}"${flag}`;
    fs.writeFileSync(path.join(plug, "skills", "check", "SKILL.md"), ["---", "name: check", "description: Check auto mode decisions.", "disable-model-invocation: true", "allowed-tools: Bash(node *) PowerShell(node *)", "---", "", `!\`${line}\``, "", "In at most 10 lines: say what was refused.", ""].join("\n"));
    const api = await fakeApi();
    try {
      const r = await runClaude(sb, api, ["-p", "/cad-fail:check", "--plugin-dir", plug, "--output-format", "json", "--permission-mode", "default"]);
      assert.equal(r.code, 0, r.err);
      seen[variant] = { requests: api.requests.length, reached: Boolean(withSkill(api)) };
    } finally { await api.close(); }
  }
  t.diagnostic(`a skill whose command exits 1: ${seen["without --markdown"].requests} requests reached the model; with --markdown: ${seen["with --markdown"].requests}`);
  assert.equal(seen["with --markdown"].reached, true, "the report reaches the model");
  assert.equal(seen["without --markdown"].reached, false, "a command that exits 1 drops the skill");
});

test("the skill's allowed-tools let the model run the command with no prompt (permission mode default): the Bash tool, and on Windows the PowerShell tool", { skip: skip(), timeout: 240000 }, async () => {
  for (const [tool, env] of [["Bash", {}], ...(IS_WIN ? [["PowerShell", { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1", CLAUDE_CODE_GIT_BASH_PATH: "C:/nonexistent/bash.exe" }]] : [])]) {
    const sb = sandbox(`allowed-${tool}`);
    history(sb, SESSIONS);
    const command = `node "${fwd(ROOT)}/bin/claude-automode-doctor.mjs" report --project "${fwd(sb.work)}" --markdown`;
    const api = await fakeApi({ calls: [{ tool, input: { command, description: "Run the report" } }] });
    try {
      const r = await runClaude(sb, api, ["-p", "/automode-doctor:check", "--plugin-dir", ROOT, "--output-format", "json", "--permission-mode", "default", "--max-turns", "3"], { env });
      assert.equal(r.code, 0, r.err);
      assert.deepEqual(r.result.permission_denials, [], `${tool}: nothing was refused`);
      const seen = new Map();
      for (const b of api.requests.flatMap((rq) => rq.messages || []).flatMap((m) => (Array.isArray(m.content) ? m.content : []))) if (b.type === "tool_result") seen.set(b.tool_use_id, b);
      const results = [...seen.values()];
      assert.equal(results.length, 1, `${tool}: the command ran`);
      assert.match(JSON.stringify(results[0].content), /## automode-doctor report/, `${tool}: and printed the report`);
    } finally { await api.close(); }
  }
});

test("on Windows, with the PowerShell tool and the default permission mode, the skill still hands over the report (the PowerShell patterns in allowed-tools)", { skip: skip() || (!IS_WIN && "the PowerShell tool is a Windows setup here"), timeout: 180000 }, async () => {
  const sb = sandbox("skill-ps");
  history(sb, SESSIONS);
  const api = await fakeApi();
  try {
    const r = await runClaude(sb, api, ["-p", "/automode-doctor:check", "--plugin-dir", ROOT, "--output-format", "json", "--permission-mode", "default"], { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1", CLAUDE_CODE_GIT_BASH_PATH: "C:/nonexistent/bash.exe" } });
    assert.equal(r.code, 0, r.err);
    assert.ok(withSkill(api), "the skill reached the model");
    const skillText = textBlocks(withSkill(api)).find((b) => b.startsWith("Base directory for this skill"));
    assert.ok(skillText.includes("## automode-doctor report") || /run this first/.test(skillText), skillText);
  } finally { await api.close(); }
});

test("installed from a marketplace, the plugin's own cost projection is small and its skill is one user-only skill", { skip: skip(), timeout: 300000 }, async (t) => {
  const sb = sandbox("details");
  const mkt = path.join(sb.root, "mkt");
  const dest = path.join(mkt, "plugins", "automode-doctor");
  fs.mkdirSync(path.join(mkt, ".claude-plugin"), { recursive: true });
  for (const item of ["bin", "src", "skills", ".claude-plugin", "package.json"]) fs.cpSync(path.join(ROOT, item), path.join(dest, item), { recursive: true });
  fs.writeFileSync(path.join(mkt, ".claude-plugin", "marketplace.json"), JSON.stringify({ name: "local-test", owner: { name: "test" }, plugins: [{ name: "automode-doctor", description: "x", source: "./plugins/automode-doctor" }] }));
  const claude = (...args) => runClaude(sb, null, args, { timeout: 100000 });
  const added = await claude("plugin", "marketplace", "add", mkt);
  assert.equal(added.code, 0, added.out + added.err);
  const installed = await claude("plugin", "install", "automode-doctor@local-test");
  assert.equal(installed.code, 0, installed.out + installed.err);
  const details = await claude("plugin", "details", "automode-doctor");
  assert.equal(details.code, 0, details.out + details.err);
  assert.match(details.out, /Skills \(1\)\s+check/);
  assert.match(details.out, /Hooks \(0\)/);
  const always = /Always-on:\s+~(\d+) tok/.exec(details.out);
  assert.ok(always && Number(always[1]) < 30, `always-on is ${always && always[1]} tokens`);
  const row = /^\s*check\s+.*$/m.exec(details.out);
  t.diagnostic(`claude plugin details on ${claudeInfo().version}: ${always[0].replace(/\s+/g, " ")}; per component: ${row ? row[0].trim().replace(/\s+/g, " ") : "(no row)"}`);
});

test("when the shell tool is not allowed for the command, Claude Code hands the model the command line as 'run this first', and the skill text reads right that way too (Windows, PowerShell tool)", { skip: skip() || (!IS_WIN && "this is how the PowerShell tool of a Windows setup behaves here"), timeout: 180000 }, async () => {
  // a copy of the plugin whose skill has no allowed-tools line
  const copy = path.join(sandbox("copy").root, "plugin");
  for (const item of ["bin", "src", "skills", ".claude-plugin", "package.json"]) fs.cpSync(path.join(ROOT, item), path.join(copy, item), { recursive: true });
  const skillFile = path.join(copy, "skills", "check", "SKILL.md");
  const text = fs.readFileSync(skillFile, "utf8");
  assert.match(text, /^allowed-tools: .*\n/m);
  fs.writeFileSync(skillFile, text.replace(/^allowed-tools: .*\n/m, ""));
  const sb = sandbox("runfirst");
  history(sb, SESSIONS);
  const api = await fakeApi();
  try {
    const r = await runClaude(sb, api, ["-p", "/automode-doctor:check", "--plugin-dir", copy, "--output-format", "json"], { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1", CLAUDE_CODE_GIT_BASH_PATH: "C:/nonexistent/bash.exe" } });
    assert.equal(r.code, 0, r.err);
    const skillText = textBlocks(withSkill(api) || main(api)).find((b) => b.startsWith("Base directory for this skill"));
    assert.ok(skillText, "the skill reached the model");
    assert.match(skillText, /\[run this first, exactly as written, with the PowerShell tool and use its output: `node "[^"]+claude-automode-doctor\.mjs" report --project "[^"]+" --markdown`\]\n\nIn at most 10 lines: what the classifier refused/);
    assert.ok(skillText.includes(`--project "${fwd(sb.work)}"`), "the project folder is filled in");
  } finally { await api.close(); }
});
