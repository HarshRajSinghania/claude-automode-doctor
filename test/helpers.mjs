// Shared test helpers: throwaway worlds (a Claude config folder, a home folder, project folders, transcripts) and ways to
// run the CLI.
//
// SAFETY: nothing here reads or writes the real Claude folder. Importing this file points HOME, USERPROFILE,
// CLAUDE_CONFIG_DIR and the managed-settings folder of the test process at an empty temporary folder, so even a test that
// forgets to pass its own environment cannot reach ~/.claude. Every child process gets a world's environment, and runCli
// refuses to run with a config or home folder outside the OS temp folder.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { main } from "../src/cli.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CLI = path.join(ROOT, "bin", "claude-automode-doctor.mjs");
export const NOW = Date.parse("2026-10-16T12:00:00.000Z");

const made = [];
export function tmpDir(prefix = "cad-") {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  made.push(dir);
  return dir;
}
process.on("exit", () => { for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* the OS cleans the temp folder eventually */ } } });

// The guard: an empty home, config folder and managed-settings folder for this process.
const guard = tmpDir("cad-guard-");
process.env.HOME = guard;
process.env.USERPROFILE = guard;
process.env.CLAUDE_CONFIG_DIR = path.join(guard, ".claude");
process.env.CLAUDE_AUTOMODE_DOCTOR_MANAGED_DIR = path.join(guard, "no-managed-settings");
process.env.NO_COLOR = "1";
for (const k of Object.keys(process.env)) if (/^(CLAUDE_CODE_|ANTHROPIC_)/.test(k)) delete process.env[k];
delete process.env.CLAUDE_PROJECT_DIR;

const underTmp = (p) => path.resolve(p).toLowerCase().startsWith(fs.realpathSync(os.tmpdir()).toLowerCase());
const configDirOf = (e) => e.CLAUDE_CONFIG_DIR || path.join((process.platform === "win32" ? e.USERPROFILE || e.HOME : e.HOME) || "", ".claude");

const asText = (v) => (typeof v === "string" ? v : `${JSON.stringify(v, null, 2)}\n`);
const put = (file, v) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, asText(v)); return file; };

// A throwaway world: base/home/.claude is the config folder, base/work is the project folder, base/managed is the
// managed-settings folder. Settings files are written from objects (as JSON) or from text.
export function world(name = "w", { user, project, local, managed } = {}) {
  const base = tmpDir(`cad-${name}-`);
  const home = path.join(base, "home");
  const claude = path.join(home, ".claude");
  const work = path.join(base, "work");
  const managedDir = path.join(base, "managed");
  for (const d of [claude, work]) fs.mkdirSync(d, { recursive: true });
  const env = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: claude, CLAUDE_AUTOMODE_DOCTOR_MANAGED_DIR: managedDir, NO_COLOR: "1" };
  delete env.FORCE_COLOR;
  const w = {
    base, home, claude, work, managedDir, env,
    userFile: path.join(claude, "settings.json"),
    projectFile: path.join(work, ".claude", "settings.json"),
    localFile: path.join(work, ".claude", "settings.local.json"),
    managedFile: path.join(managedDir, "managed-settings.json"),
    write: (file, v) => put(file, v),
    read: (file) => fs.readFileSync(file, "utf8"),
    exists: (file) => fs.existsSync(file),
    user: (v) => put(w.userFile, v),
    project: (v) => put(w.projectFile, v),
    local: (v) => put(w.localFile, v),
    managedSettings: (v) => put(w.managedFile, v),
    // names of the backups of a file made by this tool
    backups: (file) => { try { return fs.readdirSync(path.dirname(file)).filter((n) => n.startsWith(`${path.basename(file)}.bak-automode-doctor-`)).sort(); } catch { return []; } },
  };
  if (user !== undefined) w.user(user);
  if (project !== undefined) w.project(project);
  if (local !== undefined) w.local(local);
  if (managed !== undefined) w.managedSettings(managed);
  return w;
}

// Runs the real CLI in a child process.
export function runCli(args, { cwd, env, input, timeout = 120000 } = {}) {
  const e = { ...process.env, ...env };
  if (!underTmp(configDirOf(e)) || !underTmp(e.HOME || "") || !underTmp(e.USERPROFILE || "")) {
    throw new Error("runCli needs an environment from world(): the Claude config and home folders must be temporary");
  }
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env: e, input, encoding: "utf8", windowsHide: true, timeout });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "", all: `${r.stdout || ""}${r.stderr || ""}` };
}

// Runs main() in this process and captures what it prints.
export async function run(args, w, { cwd, env = {}, now = NOW, platform, tty = false } = {}) {
  let out = "";
  let err = "";
  const code = await main(args, {
    cwd: cwd || w.work,
    env: { ...w.env, ...env },
    home: w.home,
    managed: w.managedDir,
    platform,
    now,
    stdout: { write: (s) => { out += s; return true; }, isTTY: tty },
    stderr: { write: (s) => { err += s; return true; } },
  });
  return { code, out, err, all: out + err, json: () => JSON.parse(out) };
}

export const fwd = (p) => String(p).split(path.sep).join("/");

// ---- transcripts ------------------------------------------------------------------------------------------------------

import { projectSlug } from "../src/transcripts.mjs";
export { projectSlug };

/**
 * Write a transcript into a world, in the shape Claude Code 2.1.299 wrote them (the fields the tool reads are the ones
 * test/fixtures/ records from the real binary). `calls` is a list of
 *   { tool, input, at, decision: "accept"|"reject", source, reasonType, kind, classifierBoundary, serverReview, text }
 * `at` is minutes after the start. Returns the file.
 */
export function writeTranscript(w, { session = "11111111-1111-4111-8111-111111111111", cwd = w.work, start = "2026-10-15T09:00:00.000Z", mode = "auto", calls = [], version = "2.1.299" } = {}) {
  const dir = path.join(w.claude, "projects", projectSlug(cwd));
  fs.mkdirSync(dir, { recursive: true });
  const t0 = Date.parse(start);
  const stamp = (min) => new Date(t0 + (min || 0) * 60000).toISOString();
  const lines = [];
  const base = { isSidechain: false, userType: "external", entrypoint: "cli", cwd, sessionId: session, version, gitBranch: "main" };
  lines.push({ ...base, type: "user", message: { role: "user", content: "do the work" }, timestamp: stamp(0), permissionMode: mode });
  calls.forEach((c, i) => {
    const id = c.id || `toolu_${session.slice(0, 4)}_${i}`;
    lines.push({ ...base, type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name: c.tool, input: c.input }] }, timestamp: stamp(c.at ?? i + 1) });
    const rec = { ...base, type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: c.text ?? "ok", is_error: c.decision === "reject" }] }, timestamp: stamp((c.at ?? i + 1) + 0.01), toolUseResult: c.text ?? "ok" };
    if (c.classifierBoundary) rec.classifierBoundary = true;
    if (c.serverReview) rec.serverClassifierContext = {};
    if (c.kind) rec.toolDenialKind = c.kind;
    if (c.decision) rec.permissionDecision = { decision: c.decision, source: c.source || "config", ...(c.reasonType ? { reasonType: c.reasonType } : {}) };
    lines.push(rec);
  });
  const file = path.join(dir, `${session}.jsonl`);
  fs.writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
  return file;
}

/** The text Claude Code puts in a refusal by the classifier, as the binary wrote it. */
export const DENIED_TEXT = (category) => `Permission for this action was denied by the Claude Code auto mode classifier. Reason: ${category ? `[${category}]` : "Blocked by classifier"}. If you have other tasks that don't depend on this action, continue working on those.`;
export const UNAVAILABLE_TEXT = (model = "claude-opus-5-5", cause = "overloaded", tool = "Bash") => `${model} is temporarily unavailable (${cause}), so auto mode cannot determine the safety of ${tool} right now. Wait a moment and then try this action again.`;
export const UNPARSEABLE_TEXT = "Auto mode could not evaluate this action and is blocking it for safety — run with --debug for details. This is not a judgment that the action is unsafe.";
