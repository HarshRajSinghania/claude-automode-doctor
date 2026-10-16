// Read the tool decisions Claude Code recorded in its transcripts: <config folder>/projects/<slug>/<session>.jsonl
// (and <session>/subagents/*.jsonl). A decision is a tool_use block of an assistant record and the tool_result that
// answers it in a user record. Claude Code 2.1.295 and 2.1.299 stamp that result record with
//
//   permissionDecision   { decision: "accept" | "reject", source, reasonType }: who decided, and on what ground
//   toolDenialKind       on a call that did not run: "permission-rule", "user-rejected", "automode-blocked",
//                        "automode-parsing-error", "automode-unavailable" ...
//   classifierBoundary   true on a decision the client's own classifier requests made
//   serverClassifierContext   present on a decision the server's review made
//
// and the tool_result block holds the text the model was told. This file only reads. It keeps, of each decision, the
// fields above, the text of a refusal, and the command or path that was decided; never the user's prompts and never
// the output of a command.
import fs from "node:fs";
import path from "node:path";

/** The folder name Claude Code uses under projects/ for a working directory. */
export function projectSlug(p) {
  const s = String(p).replace(/[^a-zA-Z0-9]/g, "-");
  if (s.length <= 200) return s;
  let h = 0;
  for (let i = 0; i < p.length; i++) h = ((h << 5) - h + p.charCodeAt(i)) | 0;
  return `${s.slice(0, 200)}-${Math.abs(h).toString(36)}`;
}

const lower = (p) => (process.platform === "win32" ? p.toLowerCase() : p);

/** Call fn(line) for each line of a file without reading it all into memory. Stop when fn returns false. */
export function forEachLine(file, fn) {
  let fd;
  try { fd = fs.openSync(file, "r"); } catch { return; }
  try {
    const buf = Buffer.allocUnsafe(1 << 20);
    let carry = Buffer.alloc(0);
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      const data = carry.length ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n);
      let start = 0;
      for (;;) {
        const nl = data.indexOf(10, start);
        if (nl === -1) break;
        let end = nl;
        if (end > start && data[end - 1] === 13) end--;
        if (fn(data.toString("utf8", start, end)) === false) return;
        start = nl + 1;
      }
      carry = Buffer.from(data.subarray(start));
    }
    if (carry.length) fn(carry.toString("utf8"));
  } finally {
    fs.closeSync(fd);
  }
}

const listDir = (dir) => {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
};

/**
 * The transcript files to read.
 *   project  a folder: its own sessions, and those of folders below it; ignored with all
 *   all      every project
 *   sinceMs  skip files not touched since then
 */
export function transcriptFiles({ configDir, project, all = false, sinceMs = 0 }) {
  const base = path.join(configDir, "projects");
  const slug = project ? projectSlug(path.resolve(project)).toLowerCase() : "";
  const out = [];
  for (const d of listDir(base)) {
    if (!d.isDirectory()) continue;
    const name = d.name.toLowerCase();
    if (!all && name !== slug && !name.startsWith(`${slug}-`)) continue;
    const dir = path.join(base, d.name);
    const consider = (file) => {
      let st;
      try { st = fs.statSync(file); } catch { return; }
      if (!st.isFile() || st.mtimeMs < sinceMs) return;
      out.push({ file, slug: d.name, mtimeMs: st.mtimeMs });
    };
    for (const f of listDir(dir)) {
      if (f.isFile() && f.name.endsWith(".jsonl")) consider(path.join(dir, f.name));
      // the transcripts of the subagents a session started
      if (f.isDirectory()) for (const s of listDir(path.join(dir, f.name, "subagents"))) if (s.isFile() && s.name.endsWith(".jsonl")) consider(path.join(dir, f.name, "subagents", s.name));
    }
  }
  if (!all && project) {
    // a folder that only shares the slug prefix is another project unless its working directory is inside this one
    const root = lower(path.resolve(project));
    return out.filter((t) => {
      if (t.slug.toLowerCase() === slug) return true;
      const cwd = firstCwd(t.file);
      if (!cwd) return false;
      const rel = path.relative(root, lower(path.resolve(cwd)));
      return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    });
  }
  return out;
}

function firstCwd(file) {
  let cwd = "";
  let seen = 0;
  forEachLine(file, (line) => {
    if (!line.includes('"cwd"')) return ++seen < 100;
    try {
      const j = JSON.parse(line);
      if (typeof j.cwd === "string") { cwd = j.cwd; return false; }
    } catch { /* not JSON */ }
    return ++seen < 100;
  });
  return cwd;
}

const textOf = (content) => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((b) => (b && typeof b.text === "string" ? b.text : "")).join("");
  return "";
};

const SHELL = new Set(["Bash", "PowerShell"]);
const FILE_TOOLS = new Set(["Read", "Write", "Edit", "MultiEdit", "NotebookEdit"]);

/** What was decided, as short text: the command, the path or the URL. Null for a tool whose input is not worth printing. */
export function subjectOf(tool, input) {
  if (!input || typeof input !== "object") return null;
  if (SHELL.has(tool) && typeof input.command === "string") return input.command;
  if (FILE_TOOLS.has(tool)) {
    const p = input.file_path || input.notebook_path || input.path;
    return typeof p === "string" ? p : null;
  }
  if (tool === "WebFetch" && typeof input.url === "string") return input.url;
  return null;
}

/**
 * Every decision in a transcript file:
 *   { id, ts, session, cwd, version, mode, tool, subject, decision, permSource, reasonType, kind, classifierBoundary,
 *     serverReview, isError, text, file }
 * where decision, permSource and reasonType are the fields of permissionDecision and kind is toolDenialKind.
 * `text` is the first 700 characters of what the model was told, kept only for a call that did not run or was
 * judged by the classifier. `mode` is the permission mode of the latest prompt before the call.
 */
export function readDecisions(file, { sinceMs = 0 } = {}) {
  const pending = new Map();
  const out = [];
  let mode = null;
  forEachLine(file, (line) => {
    if (!line) return true;
    if (line.includes('"permissionMode"') && line.includes('"type":"user"') && !line.includes('"tool_result"')) {
      const m = /"permissionMode":"([^"]+)"/.exec(line);
      if (m) mode = m[1];
      return true;
    }
    if (line.includes('"tool_use"') && line.includes('"type":"assistant"')) {
      let j;
      try { j = JSON.parse(line); } catch { return true; }
      if (j.type !== "assistant" || !j.message || !Array.isArray(j.message.content)) return true;
      for (const b of j.message.content) {
        if (b && b.type === "tool_use" && typeof b.id === "string") {
          pending.set(b.id, { id: b.id, tool: String(b.name || ""), subject: subjectOf(b.name, b.input), ts: j.timestamp || "", session: j.sessionId || "", cwd: j.cwd || "", version: j.version || "", mode });
        }
      }
      return true;
    }
    if (pending.size && line.includes('"tool_result"')) {
      const m = /"tool_use_id":"([^"]+)"/.exec(line);
      if (!m || !pending.has(m[1])) return true;
      let j;
      try { j = JSON.parse(line); } catch { return true; }
      const blocks = j.message && Array.isArray(j.message.content) ? j.message.content : [];
      const block = blocks.find((b) => b && b.type === "tool_result" && b.tool_use_id === m[1]);
      if (!block) return true;
      const call = pending.get(m[1]);
      pending.delete(m[1]);
      const pd = j.permissionDecision && typeof j.permissionDecision === "object" ? j.permissionDecision : null;
      const ts = j.timestamp || call.ts;
      if (sinceMs && ts && Date.parse(ts) < sinceMs) return true;
      const decision = pd && (pd.decision === "accept" || pd.decision === "reject") ? pd.decision : null;
      const kind = typeof j.toolDenialKind === "string" ? j.toolDenialKind : null;
      const classifier = Boolean(pd && pd.reasonType === "classifier") || j.classifierBoundary === true || j.serverClassifierContext !== undefined;
      const didNotRun = decision === "reject" || kind !== null;
      const text = textOf(block.content);
      out.push({
        id: call.id, ts, session: call.session || j.sessionId || "", cwd: call.cwd || j.cwd || "", version: call.version || j.version || "", mode: call.mode,
        tool: call.tool, subject: call.subject, decision, permSource: pd && typeof pd.source === "string" ? pd.source : null, reasonType: pd && typeof pd.reasonType === "string" ? pd.reasonType : null,
        kind, classifierBoundary: j.classifierBoundary === true, serverReview: j.serverClassifierContext !== undefined, isError: block.is_error === true,
        text: didNotRun || classifier ? text.slice(0, 700) : "", file,
      });
    }
    return true;
  });
  return out;
}
