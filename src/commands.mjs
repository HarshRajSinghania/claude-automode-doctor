// The commands as plain objects: report, show, lint, why, cost, suggest, restore. src/render.mjs prints them; --json prints
// them as they are. Nothing here prints, and only addAllowRules and restoreBackup (src/write.mjs) change a file.
import os from "node:os";
import path from "node:path";
import { buildReport } from "./aggregate.mjs";
import { buildCost } from "./cost.mjs";
import { configDir, loadSettings, shortPath } from "./settings.mjs";
import { lintSettings } from "./lint.mjs";
import { buildShow } from "./show.mjs";
import { suggestRules } from "./suggest.mjs";
import { addAllowRules, restoreBackup } from "./write.mjs";
import { whyCommand } from "./why.mjs";
import { operation, ruleFor } from "./engine/propose.mjs";
import { parseBash } from "./engine/shell.mjs";
import { strippedWords } from "./engine/wrappers.mjs";

const base = (o) => ({ env: o.env || process.env, home: o.home || os.homedir(), platform: o.platform || process.platform, managed: o.managed });

function settingsFor(o) {
  return loadSettings({ project: o.project, ...base(o) });
}

export function buildReportModel(o) {
  const b = base(o);
  const cfg = configDir(b.env, b.home);
  const m = buildReport({ configDir: cfg.dir, project: o.project || null, days: o.days || 30, session: o.session || null, now: o.now ?? Date.now() });
  return { ok: true, configSource: cfg.source, ...m };
}

export function buildShowModel(o) {
  const s = settingsFor(o);
  return { ok: true, configSource: configDir(base(o).env, base(o).home).source, ...buildShow(s) };
}

export function buildLintModel(o) {
  const s = settingsFor(o);
  const { findings, counts } = lintSettings(s);
  return { ok: true, project: s.project, configDir: s.configDir, findings, counts, files: s.files.map((f) => ({ scope: f.scope, label: f.label, path: f.path, display: f.display, exists: f.exists, ignored: f.ignored })) };
}

export function buildWhyModel(o) {
  const s = settingsFor(o);
  const tool = o.tool || "Bash";
  const cwd = s.project;
  const r = whyCommand({ tool, command: o.command, settings: s, cwd, home: s.home, platform: s.platform });
  const withDisplay = (rule) => (rule ? { ...rule, display: shortPath(rule.file, { home: s.home, project: s.project }) } : null);
  let suggestion = null;
  if (r.outcome === "classifier" && tool === "Bash") {
    const parsed = parseBash(o.command);
    const part = parsed.ok ? parsed.cmds.find((c) => c.argv.length && !c.inert) : null;
    const op = part ? operation(strippedWords(part, "allow")) : null;
    if (op) suggestion = ruleFor(tool, op.key);
  }
  const notes = [...r.notes];
  notes.push("A PreToolUse hook, or a mod, can decide a call before any of this; hooks are not read.");
  return { ok: true, ...r, rule: withDisplay(r.rule), parts: r.parts.map((p) => ({ ...p, rule: withDisplay(p.rule) })), notes, suggestion, project: s.project, cwd, configDir: s.configDir };
}

export function buildCostModel(o) {
  const b = base(o);
  let report = null;
  if (o.withTranscripts !== false) {
    const cfg = configDir(b.env, b.home);
    report = buildReport({ configDir: cfg.dir, project: o.project || null, days: o.days || 30, now: o.now ?? Date.now(), limit: 0 });
  }
  return { ok: true, ...buildCost({ report }) };
}

/** The settings file a write is about: { target, file, project }. */
export function targetFile({ user, local, project, cwd, env, home, platform }) {
  const cfg = configDir(env, home);
  const proj = path.resolve(cwd, project || ".");
  if (user) return { target: "user", file: path.join(cfg.dir, "settings.json"), project: proj };
  if (local) return { target: "local", file: path.join(proj, ".claude", "settings.local.json"), project: proj };
  return { target: "project", file: path.join(proj, ".claude", "settings.json"), project: proj };
}

export function buildSuggestModel(o) {
  const s = settingsFor(o);
  const b = base(o);
  const cfg = configDir(b.env, b.home);
  const days = o.days || 30;
  const report = buildReport({ configDir: cfg.dir, project: s.project, days, now: o.now ?? Date.now(), limit: 0 });
  const min = o.min || 2;
  const r = suggestRules({ settings: s, report, min, cwd: s.project, home: s.home, platform: s.platform });
  const model = { ok: true, project: s.project, window: report.window, min, includeJudged: Boolean(o.includeJudged), ...r, write: null };
  if (o.write) {
    const t = targetFile({ user: o.user, local: o.local, project: o.targetProject, cwd: o.cwd, env: b.env, home: b.home, platform: b.platform });
    const chosen = r.proposals.filter((g) => o.includeJudged || (g.judged === 0 && g.asked === 0)).map((g) => g.rule);
    const held = r.proposals.filter((g) => !o.includeJudged && (g.judged > 0 || g.asked > 0)).map((g) => g.rule);
    const w = addAllowRules(t.file, chosen, { scope: t.target, dryRun: o.dryRun, now: o.now !== undefined ? new Date(o.now) : new Date(), settings: s });
    model.write = { ...w, held };
    model.ok = !w.skipped;
  }
  return model;
}

export function runRestore(o) {
  const b = base(o);
  const t = targetFile({ user: o.user, local: o.local, project: o.project, cwd: o.cwd, env: b.env, home: b.home, platform: b.platform });
  const r = restoreBackup(t.file, { now: o.now !== undefined ? new Date(o.now) : new Date(), dryRun: o.dryRun });
  const short = (p) => (p ? shortPath(p, { home: b.home, project: o.cwd }) : p);
  return { ok: r.restored || Boolean(r.dryRun), scope: t.target, ...r, display: short(t.file), fromDisplay: short(r.from), savedCurrentDisplay: short(r.savedCurrent) };
}
