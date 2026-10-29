// Running the real claude binary at zero cost, for the checks that need it (test/e2e-claude.test.mjs).
//
// A check runs only when E2E_CLAUDE names a Claude Code binary ("claude" on a CI machine after
// `npm install -g @anthropic-ai/claude-code`, or the full path to claude.exe). Otherwise it is skipped, and `npm test`
// needs nothing but Node. The binary runs in a throwaway folder with its own config folder and home, with an
// environment scrubbed of every CLAUDE_* and ANTHROPIC_* variable of the machine, and with ANTHROPIC_BASE_URL pointing
// at a tiny server on 127.0.0.1 that answers from a script. No request leaves the machine, no token is spent, no login
// is needed.
//
// The fake API plays two parts. For the conversation it answers with the tool calls the script names, one per turn.
// For the auto mode classifier it answers the requests Claude Code sends itself (no tools, a system prompt that starts
// "You are a security monitor"): stage one with a severity, stage two with the verdict, or with an error, a stream, a
// dropped connection, text that is not a verdict, or a delay. It can also play the server's side of the review that
// Claude Code asks for in the conversation's own requests (the `safeguards` field and its `safeguard_results` answer).
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpDir } from "./helpers.mjs";

export const CLAUDE = process.env.E2E_CLAUDE || "";
export const RECORD = fileURLToPath(new URL("./record-hook.mjs", import.meta.url));
const IS_WIN = process.platform === "win32";
const USAGE = { input_tokens: 1, output_tokens: 1 };
const viaShell = () => IS_WIN && !/\.exe$/i.test(CLAUDE);

/** A scrubbed environment: none of the machine's CLAUDE_* and ANTHROPIC_* variables, no updates, no telemetry. */
export function baseEnv(extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(CLAUDE|ANTHROPIC|CLAUDECODE|AI_AGENT)/i.test(k)) env[k] = v;
  return { ...env, DISABLE_AUTOUPDATER: "1", DISABLE_TELEMETRY: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", NO_COLOR: "1", ...bashEnv(), ...extra };
}

let info;
/** { ok, version, reason }: whether E2E_CLAUDE names a binary that runs, and the version it prints. */
export function claudeInfo() {
  if (info) return info;
  if (!CLAUDE) return (info = { ok: false, version: "", reason: "E2E_CLAUDE is not set (point it at a claude binary to run the checks against the real thing)" });
  const home = tmpDir("cad-e2e-probe-");
  const r = spawnSync(CLAUDE, ["--version"], { encoding: "utf8", timeout: 60000, windowsHide: true, shell: viaShell(), env: baseEnv({ CLAUDE_CONFIG_DIR: path.join(home, ".claude"), HOME: home, USERPROFILE: home }) });
  const version = (r.stdout || "").trim();
  info = r.status === 0 && version ? { ok: true, version, number: (/\d+\.\d+\.\d+/.exec(version) || [""])[0], reason: "" } : { ok: false, version: "", reason: `E2E_CLAUDE (${CLAUDE}) did not run: ${(r.error && r.error.message) || (r.stderr || "").trim().slice(0, 120)}` };
  return info;
}
/** The value for node:test's `skip` option: false when the binary is there, else the reason. */
export const skip = () => (claudeInfo().ok ? false : claudeInfo().reason);

/** Git Bash on Windows, so the Bash tool exists; nothing on the other systems. */
function bashEnv() {
  if (!IS_WIN) return {};
  const candidates = [];
  if (process.env.CLAUDE_CODE_GIT_BASH_PATH) candidates.push(process.env.CLAUDE_CODE_GIT_BASH_PATH);
  const where = spawnSync("where", ["git"], { encoding: "utf8", windowsHide: true });
  for (const line of (where.stdout || "").split(/\r?\n/).filter(Boolean)) candidates.push(path.join(path.dirname(line), "..", "bin", "bash.exe"));
  candidates.push("C:/Program Files/Git/bin/bash.exe", "C:/Program Files (x86)/Git/bin/bash.exe");
  for (const c of candidates) if (c && fs.existsSync(c)) return { CLAUDE_CODE_USE_POWERSHELL_TOOL: "0", CLAUDE_CODE_GIT_BASH_PATH: path.resolve(c).replace(/\\/g, "/") };
  return {};
}

/**
 * A throwaway world for the binary: home, a config folder and a project folder that Claude Code already trusts.
 *   cfg/settings.json                 the user's file
 *   work/.claude/settings.json        the project's file
 *   work/.claude/settings.local.json  the local file
 */
export function sandbox(label) {
  const root = tmpDir(`cad-e2e-${label}-`);
  const home = path.join(root, "home");
  const cfg = path.join(root, "cfg");
  const work = path.join(root, "work");
  for (const d of [home, cfg, work]) fs.mkdirSync(d, { recursive: true });
  const trusted = { hasTrustDialogAccepted: true, allowedTools: [] };
  fs.writeFileSync(path.join(cfg, ".claude.json"), JSON.stringify({ hasCompletedOnboarding: true, projects: { [work]: trusted, [work.replace(/\\/g, "/")]: trusted } }));
  return {
    root, home, cfg, work,
    log: path.join(root, "events.jsonl"),
    user: path.join(cfg, "settings.json"),
    project: path.join(work, ".claude", "settings.json"),
    local: path.join(work, ".claude", "settings.local.json"),
    managed: path.join(root, "managed"),
  };
}

/** Write a file: an object as JSON, a string as it is. */
export function put(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

// ---- the fake Messages API ---------------------------------------------------------------------------------------------

const msgStart = (id, model) => ["message_start", { type: "message_start", message: { id, type: "message", role: "assistant", model: model || "x", content: [], stop_reason: null, usage: USAGE } }];

/** SSE events for an assistant message with the given blocks: { text } or { tool, input, id }. */
export function message(id, model, blocks, { safeguardResults } = {}) {
  const ev = [msgStart(id, model)];
  blocks.forEach((b, i) => {
    if (b.text !== undefined) {
      ev.push(["content_block_start", { type: "content_block_start", index: i, content_block: { type: "text", text: "" } }]);
      ev.push(["content_block_delta", { type: "content_block_delta", index: i, delta: { type: "text_delta", text: b.text } }]);
    } else {
      ev.push(["content_block_start", { type: "content_block_start", index: i, content_block: { type: "tool_use", id: b.id || `toolu_${id}_${i}`, name: b.tool, input: {} } }]);
      ev.push(["content_block_delta", { type: "content_block_delta", index: i, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } }]);
    }
    ev.push(["content_block_stop", { type: "content_block_stop", index: i }]);
  });
  const delta = { stop_reason: blocks.some((b) => b.tool) ? "tool_use" : "end_turn", stop_sequence: null };
  if (safeguardResults) delta.safeguard_results = safeguardResults;
  ev.push(["message_delta", { type: "message_delta", delta, usage: { output_tokens: 1 } }]);
  ev.push(["message_stop", { type: "message_stop" }]);
  return ev;
}

/** All the text the user side of a request holds (the prompt, expanded skills, tool results). */
export const userText = (j) => (j.messages || []).filter((m) => m.role === "user").map((m) => (typeof m.content === "string" ? m.content : (m.content || []).map((b) => b.text || "").join(""))).join("\n");
/** Every text block of a request's messages. */
export const textBlocks = (request) => (request.messages || []).flatMap((m) => (Array.isArray(m.content) ? m.content : [m.content])).map((b) => (typeof b === "string" ? b : (b && b.text) || ""));
/** The system prompt of a request as one string. */
export const systemText = (j) => (Array.isArray(j.system) ? j.system.map((b) => b.text || "").join("") : j.system || "");
/** Is this request one of the classifier's? It has no tools and a system prompt that opens with the security monitor. */
export const isClassifier = (j) => !(j.tools && j.tools.length) && /You are a security monitor for autonomous AI coding agents/.test(systemText(j));
/** 1 or 2: which stage of the classifier a request is (stage one stops at </severity> and asks for 64 tokens). */
export const stageOf = (j) => ((j.stop_sequences || []).includes("</severity>") || (j.max_tokens || 0) <= 200 ? 1 : 2);

/** The text of a verdict the way the classifier is asked to write it. */
export const severity = (n, category) => `<severity>${n}</severity>${category ? `<category>${category}</category>` : ""}`;
export const stage2 = (n, category, thinking = "The action was judged against the rules.") => `<thinking>${thinking}</thinking>${severity(n, category)}`;

const sse = (res, events) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const [ev, data] of events) res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  res.end();
};

/**
 * The fake Messages API. Every request is recorded in `requests`, whole. Script:
 *   calls    the conversation's replies, one per turn: { tool, input } or { text }; after the list, "PROBE-DONE"
 *   stage1   how the classifier answers stage one; stage2 for stage two. A string is the text of the answer; also
 *            { status } (an HTTP error), { sse } (the text as a stream), { raw } (a body as it is), { drop: true } (the
 *            connection is cut), { text, delay } (answer after delay ms). A function gets (request) and returns one.
 *            Default: severity 5 at stage one, which allows the call.
 *   server   (toolUseId, request) => the value of safeguard_results for a response that calls a tool, or undefined:
 *            plays the server's review. Only called when the request asked for it (it has a `safeguards` field).
 * Returns { port, requests, classifier(), conversation(), close() }.
 */
export function fakeApi(script = {}) {
  const requests = [];
  const calls = script.calls || (script.tool ? [{ tool: script.tool, input: script.input }] : []);
  const answerFor = (stage) => script[stage === 1 ? "stage1" : "stage2"];
  const server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8"); // so a character split across two chunks still decodes
    req.on("data", (c) => { body += c; });
    req.on("end", async () => {
      if (!req.url.includes("/v1/messages")) { res.writeHead(404); res.end("{}"); return; }
      let j = {};
      try { j = JSON.parse(body); } catch { /* empty */ }
      requests.push(j);
      const n = requests.length;
      if (isClassifier(j)) {
        const stage = stageOf(j);
        let a = answerFor(stage);
        if (typeof a === "function") a = a(j);
        if (a === undefined) a = stage === 1 ? severity(5) : stage2(5);
        if (typeof a === "number") a = stage === 1 ? severity(a) : stage2(a);
        const spec = typeof a === "string" ? { text: a } : a;
        if (spec.delay) await new Promise((r) => setTimeout(r, spec.delay));
        if (spec.drop) { req.socket.destroy(); return; }
        if (spec.status) { res.writeHead(spec.status, { "content-type": "application/json" }); res.end(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "fake" } })); return; }
        if (spec.raw !== undefined) { res.writeHead(200, { "content-type": "application/json" }); res.end(spec.raw); return; }
        if (spec.sse !== undefined) { sse(res, message(`msg_${n}`, j.model, [{ text: spec.sse }])); return; }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: `msg_${n}`, type: "message", role: "assistant", model: j.model || "x", content: [{ type: "text", text: spec.text ?? "" }], stop_reason: "end_turn", usage: USAGE }));
        return;
      }
      if (j.stream === false) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: `msg_${n}`, type: "message", role: "assistant", model: j.model || "x", content: [{ type: "text", text: "done" }], stop_reason: "end_turn", usage: USAGE }));
        return;
      }
      const turn = (j.messages || []).filter((m) => m.role === "assistant").length;
      const step = calls[turn];
      if (step && step.tool) {
        const id = `toolu_${turn}`;
        const safeguardResults = script.server && j.safeguards ? script.server(id, j) : undefined;
        sse(res, message(`msg_${n}`, j.model, [{ tool: step.tool, id, input: step.input }], { safeguardResults }));
      } else sse(res, message(`msg_${n}`, j.model, [{ text: (step && step.text) || "PROBE-DONE" }]));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    server.unref();
    resolve({
      port: server.address().port, requests,
      classifier: () => requests.filter(isClassifier),
      conversation: () => requests.filter((r) => !isClassifier(r)),
      close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
    });
  }));
}

/** The safeguard_results value that says "judged": { flagged: true, explanation } or { flagged: false }. */
export const serverVerdict = (id, { flagged, explanation } = {}) => [{ type: "dangerous_tool_use", status: { type: "available", tool_uses: { [id]: { type: "evaluated", outcome: flagged ? "flagged" : "not_flagged", ...(explanation ? { explanation } : {}) } } } }];
/** ... and "the review skipped this call". */
export const serverSkipped = (id) => [{ type: "dangerous_tool_use", status: { type: "available", tool_uses: { [id]: { type: "skipped" } } } }];

// ---- running the binary ------------------------------------------------------------------------------------------------

function killTree(child) {
  try {
    if (IS_WIN) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    else process.kill(-child.pid, "SIGKILL");
  } catch { try { child.kill("SIGKILL"); } catch { /* gone */ } }
}

/**
 * Run claude in the sandbox's project folder. Resolves { code, out, err, result } (result: the --output-format json
 * document). `api` is the fake API the binary talks to; null for a command that needs none (claude doctor, claude
 * auto-mode config). The binary is started with spawn, never spawnSync, because the fake server lives in this process
 * and spawnSync would block the event loop that has to answer it; stdin is ignored or `-p` waits for input forever.
 */
export function runClaude(sb, api, args, { timeout = 120000, env = {}, cwd } = {}) {
  return new Promise((resolve) => {
    const childEnv = baseEnv({ CLAUDE_CONFIG_DIR: sb.cfg, HOME: sb.home, USERPROFILE: sb.home, ...(api ? { ANTHROPIC_API_KEY: "sk-ant-probe", ANTHROPIC_BASE_URL: `http://127.0.0.1:${api.port}` } : {}), CAD_LOG: sb.log, ...env });
    const quoted = [CLAUDE, ...args].map((a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(" ");
    const where = cwd || sb.work;
    const child = viaShell() ? spawn(quoted, [], { cwd: where, env: childEnv, shell: true, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }) : spawn(CLAUDE, args, { cwd: where, env: childEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], detached: !IS_WIN });
    let out = "";
    let err = "";
    child.on("error", (e) => { err += String(e); });
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    const timer = setTimeout(() => killTree(child), timeout);
    child.on("close", (code) => {
      clearTimeout(timer);
      let result = null;
      try { result = JSON.parse(out); } catch { /* not json */ }
      resolve({ code, out, err, result });
    });
  });
}

/** Run claude with no model involved (`claude doctor`, `claude plugin ...`, `claude auto-mode config`), in the sandbox's world. */
export function claudeSync(sb, args, { timeout = 100000, env = {} } = {}) {
  const childEnv = baseEnv({ CLAUDE_CONFIG_DIR: sb.cfg, HOME: sb.home, USERPROFILE: sb.home, ...env });
  const r = spawnSync(CLAUDE, args, { encoding: "utf8", timeout, env: childEnv, cwd: sb.work, windowsHide: true, shell: viaShell(), input: "", maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, out: r.stdout || "", err: r.stderr || "", all: `${r.stdout || ""}${r.stderr || ""}` };
}

/** `claude -p` in auto mode with the permission mode named; resolves like runClaude. Auto mode is also the default of -p. */
export const runAuto = (sb, api, prompt, extra = [], opts = {}) => runClaude(sb, api, ["-p", prompt, "--output-format", "json", "--permission-mode", "auto", ...extra], opts);

// ---- reading what the binary wrote -------------------------------------------------------------------------------------

/** Every transcript line the run wrote, parsed, in order. */
export function transcriptLines(sb) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".jsonl")) for (const line of fs.readFileSync(p, "utf8").split("\n").filter(Boolean)) { try { out.push(JSON.parse(line)); } catch { /* skip */ } }
    }
  };
  walk(path.join(sb.cfg, "projects"));
  return out;
}

/**
 * The tool calls of a run with what the transcript says about each, read from the raw lines (not through the tool):
 * [{ tool, input, decision, kind, classifierBoundary, serverReview, isError, text }] in order.
 */
export function callsOf(sb) {
  const uses = new Map();
  const out = [];
  for (const x of transcriptLines(sb)) {
    if (x.type === "assistant" && Array.isArray(x.message && x.message.content)) for (const b of x.message.content) if (b.type === "tool_use") uses.set(b.id, b);
    if (x.type === "user" && Array.isArray(x.message && x.message.content)) {
      for (const b of x.message.content) {
        if (b.type !== "tool_result") continue;
        const u = uses.get(b.tool_use_id) || {};
        out.push({ tool: u.name, input: u.input, decision: x.permissionDecision || null, kind: x.toolDenialKind || null, classifierBoundary: x.classifierBoundary === true, serverReview: x.serverClassifierContext !== undefined, isError: b.is_error === true, text: typeof b.content === "string" ? b.content : JSON.stringify(b.content) });
      }
    }
  }
  return out;
}

/** What the recording hook wrote: one object per run, with { label, input, env, cwd }. */
export function readLog(sb) {
  if (!fs.existsSync(sb.log)) return [];
  return fs.readFileSync(sb.log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

/** A command hook entry that records one line in the sandbox's log when it runs (exec form, node). */
export function recorder(label) {
  return { type: "command", command: process.execPath, args: [RECORD, label] };
}
