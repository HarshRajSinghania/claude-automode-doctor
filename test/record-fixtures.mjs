// Record the fixtures of test/fixtures/ from the real binary:   RECORD_FIXTURES=1 E2E_CLAUDE=<claude> node test/record-fixtures.mjs [scenario ...]
//
// Each scenario of test/scenarios.mjs is run against the fake API. Of the transcript the binary writes, only three lines are
// kept: the prompt, the tool call and its result, which carries permissionDecision, toolDenialKind and the rest of the
// fields the report reads. The sandbox's folders are replaced by /home/me/shop, /home/me and /home/me/.claude, ids and times
// are fixed, and the fields the tool does not read are dropped, so a fixture holds no system prompt, no user text and no path
// of this machine. The files are committed; test/fixtures.test.mjs reads them with the same code `report` uses.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { claudeInfo } from "./claude-sandbox.mjs";
import { SCENARIOS, finishScenario, runScenario } from "./scenarios.mjs";

const OUT = fileURLToPath(new URL("./fixtures/", import.meta.url));
const posix = (p) => String(p).replace(/^([A-Za-z]):/, (m, d) => `/${d.toLowerCase()}`).split(String.fromCharCode(92)).join("/");
const fwd = (p) => String(p).split(String.fromCharCode(92)).join("/");
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function scrubber(sb) {
  const pairs = [[sb.cfg, "/home/me/.claude"], [sb.work, "/home/me/shop"], [sb.home, "/home/me"], [sb.root, "/tmp/sandbox"]];
  const subs = [];
  for (const [dir, to] of pairs) for (const v of new Set([dir, fwd(dir), posix(dir)])) subs.push([new RegExp(escRe(v), "gi"), to]);
  subs.sort((a, b) => b[0].source.length - a[0].source.length);
  const text = (s) => { let t = s; for (const [re, to] of subs) t = t.replace(re, to); return t; };
  const walk = (v) => (typeof v === "string" ? text(v) : Array.isArray(v) ? v.map(walk) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v);
  return walk;
}

const sessionOf = (name) => {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hex = (n) => ((h * (n + 7)) >>> 0).toString(16).padStart(8, "0");
  return `${hex(1)}-${hex(2).slice(0, 4)}-4${hex(3).slice(1, 4)}-8${hex(4).slice(1, 4)}-${hex(5)}${hex(6).slice(0, 4)}`;
};

export async function record(only = null) {
  const info = claudeInfo();
  if (!info.ok) throw new Error(info.reason);
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = { version: info.number, recordedWith: info.version, platform: process.platform, scenarios: {} };
  for (const sc of SCENARIOS) {
    if (only && !only.includes(sc.name)) continue;
    const r = await runScenario(sc);
    try {
      const scrub = scrubber(r.sb);
      const session = sessionOf(sc.name);
      const t0 = Date.parse("2026-10-15T09:00:00.000Z");
      const at = (n) => new Date(t0 + n * 1000).toISOString();
      const lines = r.lines;
      const prompt = lines.find((x) => x.type === "user" && typeof (x.message && x.message.content) === "string");
      // the call the scenario is about (the first, unless it says `at`), and the line that answers it
      const uses = lines.filter((x) => x.type === "assistant" && Array.isArray(x.message && x.message.content) && x.message.content.some((b) => b.type === "tool_use"));
      const use = uses[sc.at || 0];
      const wanted = use && use.message.content.find((b) => b.type === "tool_use");
      const result = wanted && lines.find((x) => x.type === "user" && Array.isArray(x.message && x.message.content) && x.message.content.some((b) => b.type === "tool_result" && b.tool_use_id === wanted.id));
      if (!prompt || !use || !result) throw new Error(`${sc.name}: the transcript has no ${!prompt ? "prompt" : !use ? "tool call" : "result"} line`);
      const common = { cwd: "/home/me/shop", sessionId: session, version: info.number };
      const useBlock = use.message.content.find((b) => b.type === "tool_use");
      const keep = {
        prompt: { type: "user", message: { role: "user", content: "run it" }, timestamp: at(0), permissionMode: prompt.permissionMode || "auto", ...common },
        use: { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: useBlock.id, name: useBlock.name, input: scrub(useBlock.input) }] }, timestamp: at(1), ...common },
        result: { type: "user", message: scrub(result.message), timestamp: at(2), toolUseResult: scrub(result.toolUseResult), ...(result.classifierBoundary ? { classifierBoundary: true } : {}), ...(result.toolDenialKind ? { toolDenialKind: result.toolDenialKind } : {}), ...(result.permissionDecision ? { permissionDecision: result.permissionDecision } : {}), ...(result.serverClassifierContext !== undefined ? { serverClassifierContext: scrub({ ...result.serverClassifierContext, request: "00000000-0000-4000-8000-000000000000" }) } : {}), ...common },
      };
      const file = `${sc.name}.jsonl`;
      fs.writeFileSync(path.join(OUT, file), `${[keep.prompt, keep.use, keep.result].map((l) => JSON.stringify(l)).join("\n")}\n`);
      manifest.scenarios[sc.name] = { file, calls: sc.calls.length, classifierRequests: r.classifier.length };
      console.log(`${sc.name}: ${file}`);
    } finally { await finishScenario(r); }
  }
  if (!only) fs.writeFileSync(path.join(OUT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

// `node --test` runs every file under test/: without RECORD_FIXTURES=1 this file only defines record()
if (process.env.RECORD_FIXTURES === "1") {
  await record(process.argv.slice(2).length ? process.argv.slice(2) : null);
}
