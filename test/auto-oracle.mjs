// The oracle for `why`: put one command to the real Claude Code binary in auto mode and say what happened to it, at zero
// tokens. A row of test/auto-table.mjs is a command under some settings; this runs it and reports one of
//
//   static      Claude Code approved it without asking the classifier (the transcript says how: reasonType)
//   classifier  Claude Code sent it to the classifier (the fake API saw a classifier request); the fake classifier allows it
//   prompt      Claude Code needed someone to approve it (claude -p cannot ask, so the call is refused: toolDenialKind user-rejected,
//               or reasonType safetyCheck for the built-in safety check of a critical path)
//   refused     a permission rule refused it (toolDenialKind permission-rule)
//
// Each run has its own throwaway HOME, USERPROFILE and CLAUDE_CONFIG_DIR, project folder and fake API. The fake classifier
// refuses what it is asked about (severity 95 at both stages), so a command that goes to the classifier never runs; a command
// that is approved without it really runs, in that folder: the rows only use commands that do no harm there. A row never
// names a path outside the throwaway folders that a mistake could damage.
import fs from "node:fs";
import path from "node:path";
import { callsOf, fakeApi, put, runAuto, sandbox } from "./claude-sandbox.mjs";
import { world } from "./helpers.mjs";
import { loadSettings } from "../src/settings.mjs";
import { whyCommand } from "../src/why.mjs";

const posix = (p) => String(p).replace(/^([A-Za-z]):/, (m, d) => `/${d.toLowerCase()}`).split(String.fromCharCode(92)).join("/");

/** Replace {WORK}, {HOME}, {CFG}, {ROOT} (and their _POSIX forms) in every string of a value. */
export function fill(value, dirs) {
  if (typeof value === "string") return value.replace(/\{(WORK|HOME|CFG|ROOT)(_POSIX)?\}/g, (m, k, p) => (p ? posix(dirs[k]) : dirs[k]));
  if (Array.isArray(value)) return value.map((v) => fill(v, dirs));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [fill(k, dirs), fill(v, dirs)]));
  return value;
}

/**
 * Run one row. row = { command, tool, settings: { user, project, local }, files, args, env, stage1 }.
 * Returns { outcome, reasonType, source, kind, text, classifierRequests, requests }.
 */
export async function askAuto(row, { timeout = 120000 } = {}) {
  const sb = sandbox("auto");
  const dirs = { WORK: sb.work, HOME: sb.home, CFG: sb.cfg, ROOT: sb.root };
  const r = fill(row, dirs);
  const s = r.settings || {};
  for (const [name, file] of [["user", sb.user], ["project", sb.project], ["local", sb.local]]) if (s[name] !== undefined) put(file, s[name]);
  for (const [rel, text] of Object.entries(r.files || {})) put(path.isAbsolute(rel) ? rel : path.join(sb.work, rel), text);
  const tool = r.tool || "Bash";
  const api = await fakeApi({ calls: [{ tool, input: tool === "Bash" || tool === "PowerShell" ? { command: r.command } : r.input }], stage1: r.stage1 ?? 95, stage2: r.stage2 ?? 95 });
  try {
    const env = tool === "PowerShell" ? { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1", CLAUDE_CODE_GIT_BASH_PATH: "C:/nonexistent/bash.exe", ...(r.env || {}) } : r.env || {};
    const run = await runAuto(sb, api, "run it", ["--max-turns", "2", ...(r.args || [])], { env, timeout });
    const calls = callsOf(sb);
    const call = calls[0] || null;
    const classifierRequests = api.classifier().length;
    let outcome = "none";
    if (call) {
      if (/No such tool available/.test(call.text)) outcome = "refused"; // a bare deny rule removes the tool
      else if (classifierRequests > 0) outcome = "classifier";
      else if (call.decision && call.decision.decision === "accept") outcome = "static";
      else if (call.decision && call.decision.reasonType === "safetyCheck") outcome = /is blocked. This path is protected/.test(call.text) ? "refused" : "prompt"; // a built-in safety check: Remove-Item on a system path or a wildcard is refused in every mode; an rm of a critical path asks in a terminal and is refused in claude -p
      else if (call.kind === "permission-rule") outcome = "refused";
      else if (call.kind === "user-rejected") outcome = "prompt";
      else outcome = "other";
    }
    return { outcome, reasonType: call && call.decision ? call.decision.reasonType || null : null, source: call && call.decision ? call.decision.source : null, kind: call ? call.kind : null, text: call ? call.text.slice(0, 200) : "", classifierRequests, requests: api.requests.length, code: run.code, err: run.err.slice(0, 300) };
  } finally {
    await api.close();
    try { fs.rmSync(sb.root, { recursive: true, force: true }); } catch { /* the OS cleans the temp folder eventually */ }
  }
}

/** Run `rows` with at most `limit` binaries at once; results come back in order. A run that never reached the call is repeated. */
export async function askAll(rows, { limit = 5 } = {}) {
  const results = new Array(rows.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= rows.length) return;
      let r;
      for (let attempt = 0; attempt < 3; attempt++) {
        r = await askAuto(rows[i]);
        if (r.outcome !== "none") break;
      }
      results[i] = r;
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, worker));
  return results;
}

/** What `why` says for a row, in a world of its own (the same settings and files the binary gets). */
export function predict(row) {
  const w = world("table");
  const r = fill(row, { WORK: w.work, HOME: w.home, CFG: w.claude, ROOT: w.base });
  const s = r.settings || {};
  if (s.user) w.user(s.user);
  if (s.project) w.project(s.project);
  if (s.local) w.local(s.local);
  for (const [rel, text] of Object.entries(r.files || {})) w.write(path.isAbsolute(rel) ? rel : path.join(w.work, rel), text);
  const settings = loadSettings({ project: w.work, env: w.env, home: w.home, managed: w.managedDir });
  return whyCommand({ tool: r.tool || "Bash", command: r.command, settings, cwd: w.work, home: w.home, platform: r.platform ? "win32" : process.platform });
}
