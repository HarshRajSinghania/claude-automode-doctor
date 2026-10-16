// Why a command does or does not go to the auto mode classifier.
//
// The order Claude Code follows in auto mode (documentation, "How the classifier evaluates actions"; each step below was
// put to the binary, see test/auto-table.mjs):
//   1. deny rules refuse the command; ask rules make it prompt, and the classifier cannot approve what they stop;
//   2. an rm or rmdir of a critical path prompts, whatever allow rules say;
//   3. allow rules approve it, except the broad ones auto mode drops (Bash(*), Bash(python *), Bash(npm run *) ...),
//      or all of them with autoMode.classifyAllShell;
//   4. a read-only command, and the file commands acceptEdits mode approves (mkdir, touch, rm, rmdir, mv, cp, sed, a
//      redirection into a file) inside the working folders, are approved by looking at them;
//   5. everything else goes to the classifier.
// The static analysis (the shell reader, the read-only list, the rule matching) is the engine copied from
// claude-permission-doctor, which was checked against the default permission mode; what this file adds is the
// auto mode layer on top, and that is what the table checks.
import path from "node:path";
import { decideShell } from "./engine/decide.mjs";
import { parseBash } from "./engine/shell.mjs";
import { fileArguments } from "./engine/readonly.mjs";
import { strippedWords } from "./engine/wrappers.mjs";
import { resolveArg, insideAny, unsafePath } from "./engine/paths.mjs";
import { activeRules } from "./engine/settings.mjs";
import { droppedInAutoMode } from "./automode.mjs";

const EDIT_PROGRAMS = new Set(["mkdir", "touch", "rm", "rmdir", "mv", "cp", "sed"]);

/** The settings Claude Code works with while auto mode is on: the allow rules it drops are gone. */
export function autoSettings(settings) {
  const classifyAll = settings.files.some((f) => !f.ignored && f.view && f.view.autoMode && f.view.autoMode.classifyAllShell && f.view.autoMode.classifyAllShell.value === true && (f.scope === "user" || f.scope === "managed"));
  const dropped = [];
  const rules = settings.rules.filter((r) => {
    if (r.behavior !== "allow" || r.problem) return true;
    const shell = r.tool === "Bash" || r.tool === "PowerShell";
    if (shell && classifyAll) { dropped.push({ rule: r, why: "classifyAllShell" }); return false; }
    if (droppedInAutoMode(r.tool, r.content)) { dropped.push({ rule: r, why: "broad" }); return false; }
    return true;
  });
  return { settings: { ...settings, rules }, dropped, classifyAll };
}

const ruleInfo = (r) => (r ? { raw: r.raw, behavior: r.behavior, scope: r.scope, display: r.display || null, file: r.file, label: r.label } : null);

// a rm or rmdir target that is a critical path: the root, a top-level folder, the home folder, the working folder or one
// of its parents, a glob straight under a variable
function criticalTarget(arg, ctx) {
  if (/^"?\$\{?[A-Za-z_][A-Za-z0-9_]*\}?"?\/?(\*|\*\/)?$/.test(arg) && /[$]/.test(arg) && (/\/(\*\/?)?$/.test(arg))) return true;
  if (arg === "~" || arg === "~/" || arg === "$HOME" || arg === "${HOME}" || arg === '"$HOME"') return true;
  if (/^(~|\$HOME|\$\{HOME\})\/\*$/.test(arg)) return true;
  const abs = resolveArg(arg, ctx.cwd, ctx.home);
  if (!abs) return false;
  const root = path.parse(abs).root;
  if (abs === root) return true;
  if (path.dirname(abs) === root) return true; // a top-level folder
  if (ctx.home && path.resolve(ctx.home) === abs) return true;
  const rel = path.relative(abs, path.resolve(ctx.cwd));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)); // the working folder or a parent of it
}

function criticalRemoval(parts, ctx) {
  for (const p of parts) {
    const words = strippedWords(p.cmd, "allow");
    if (words[0] !== "rm" && words[0] !== "rmdir") continue;
    const operands = words.slice(1).filter((w) => !w.startsWith("-"));
    for (const o of operands) if (criticalTarget(o, ctx)) return { part: p, target: o };
  }
  return null;
}

// does a redirection write only inside the working folders?
function redirectsInside(cmd, ctx) {
  for (const r of cmd.redirs || []) {
    if (r.heredoc || !r.target) continue;
    if (!/^(>|>>|>\||&>|&>>|<>)$/.test(r.op)) continue;
    const target = r.target.value;
    if (target === "/dev/null" || target === "/dev/stdout" || target === "/dev/stderr") continue;
    if (r.target.dynamic || unsafePath(target, ctx.platform)) return false;
    const abs = resolveArg(target, ctx.cwd, ctx.home);
    if (!abs || !insideAny(abs, ctx.dirs)) return false;
  }
  return true;
}

// does the permission mode approve this part? (the acceptEdits commands inside the working folders)
function modeApproves(cmd, ctx) {
  const words = strippedWords(cmd, "allow");
  if (!redirectsInside(cmd, ctx)) return false;
  if (!words.length) return (cmd.redirs || []).length > 0; // a bare redirection, as in `> file`
  if (!EDIT_PROGRAMS.has(words[0])) return false;
  const fa = fileArguments(words);
  const files = [...fa.reads, ...fa.writes];
  for (const f of files) {
    const abs = resolveArg(f, ctx.cwd, ctx.home);
    if (!abs || !insideAny(abs, ctx.dirs)) return false;
    if (unsafePath(f, ctx.platform)) return false;
  }
  return true;
}

/**
 * Decide a command for auto mode.
 *   tool      "Bash" (default) or "PowerShell"
 *   command   the command line
 *   settings  the result of loadSettings()
 *   cwd, home, platform
 * Returns { outcome, basis, summary, rule, parts, dropped, notes, engine }:
 *   outcome  "refused" (a deny rule), "prompt" (an ask rule, a critical path, the read block: you are asked, and in claude -p
 *            the command is refused), "static" (approved by looking at it, no classifier), "classifier"
 *   basis    deny-rule | tool-denied | ask-rule | critical-path | block-reads | allow-rule | read-only | mode | no-rule |
 *            unparseable | cannot-check | path | cd
 */
export function whyCommand({ tool = "Bash", command, settings, cwd, home, platform = process.platform }) {
  const auto = autoSettings(settings);
  const dirs = [cwd, ...settings.additionalDirectories];
  const ctx = { cwd, home, platform, dirs };
  const engine = decideShell({ tool, command, settings: auto.settings, cwd, home, platform });
  const asDefault = auto.dropped.length ? decideShell({ tool, command, settings, cwd, home, platform }) : engine;
  const notes = [];
  const out = { tool, command, outcome: "classifier", basis: "no-rule", summary: "", rule: null, parts: engine.parts.map((p) => ({ text: p.text, status: p.status, detail: p.detail || "", rule: ruleInfo(p.rule) })), dropped: [], notes, engine: { verdict: engine.verdict, kind: engine.kind, summary: engine.summary } };
  // allow rules that matched, and that auto mode dropped: say so, they are why a command nobody expected goes to the classifier
  if (auto.dropped.length && asDefault.verdict === "allow" && engine.verdict !== "allow") {
    out.dropped = auto.dropped.map((d) => ({ raw: d.rule.raw, why: d.why, display: d.rule.display || null })).filter((d) => engine.parts.concat(asDefault.parts).some((p) => p.rule && p.rule.raw === d.raw));
  }
  const finish = (outcome, basis, summary, rule = null) => Object.assign(out, { outcome, basis, summary, rule: ruleInfo(rule) });

  if (engine.verdict === "deny") return finish("refused", engine.kind === "tool-denied" ? "tool-denied" : "deny-rule", `${engine.summary}. A deny rule refuses the command before the classifier is asked.`, engine.rule);
  if (engine.verdict === "ask" && engine.kind === "ask-rule") return finish("prompt", "ask-rule", `${engine.summary}. An ask rule makes Claude Code prompt you, and the classifier cannot approve what it stops; claude -p has nobody to ask and refuses the command.`, engine.rule);

  const parsed = tool === "Bash" ? parseBash(command) : null;
  if (parsed && parsed.ok) {
    const crit = criticalRemoval(engine.parts, ctx);
    if (crit) return finish("prompt", "critical-path", `${crit.part.text} removes a critical path (${crit.target}): Claude Code asks you, whatever allow rules say, and the classifier is not asked; claude -p refuses it.`);
  }
  const readBlock = settings.files.some((f) => !f.ignored && f.view && f.view.permissions && f.view.permissions.blockReads && f.view.permissions.blockReads.value === true);
  if (readBlock && parsed && parsed.ok) {
    const cd = engine.parts.find((p) => strippedWords(p.cmd, "allow")[0] === "cd");
    const nested = parsed.issues.find((i) => i.kind === "substitution" || i.kind === "quoted-substitution" || i.kind === "process-substitution");
    const outside = engine.parts.find((p) => p.outside || (p.blockKind === "path" && p.unsafePath === undefined));
    if (cd || nested || outside) return finish("prompt", "block-reads", `permissions.blockReadsOutsideWorkingDirectories is on, and ${cd ? "a cd" : nested ? "a command substitution" : "a path outside the working folders"} cannot be shown to stay inside them: Claude Code asks you, whatever allow rules say, and the classifier is not asked; claude -p refuses it.`);
  }

  if (engine.verdict === "allow") {
    const rule = engine.rule;
    if (rule) return finish("static", "allow-rule", `${engine.summary}; auto mode keeps this rule, so the command skips the classifier.`, rule);
    return finish("static", "read-only", "every part of it is read-only, so it is approved by looking at it and skips the classifier.");
  }

  // verdict "ask" (a prompt in the default mode): in auto mode, the permission mode may still approve it
  if (engine.kind === "no-rule" || engine.kind === "path" || engine.kind === "cd") {
    const unresolved = engine.parts.filter((p) => !["allow", "read-only", "assign", "inert"].includes(p.status) || p.blockKind);
    if (unresolved.length && unresolved.every((p) => modeApproves(p.cmd, ctx))) {
      for (const p of unresolved) { const mine = out.parts.find((x) => x.text === p.text && x.status === p.status); if (mine) { mine.status = "mode"; mine.detail = "approved by the permission mode"; } }
      return finish("static", "mode", `${unresolved.map((p) => p.text).join("; ")} ${unresolved.length === 1 ? "is" : "are"} approved by the permission mode (file edits and the common file commands inside the working folders), so the command skips the classifier.`);
    }
  }
  const why = engine.kind === "unparseable" ? "Claude Code cannot parse the command line" : engine.kind === "cannot-check" ? engine.summary : engine.summary;
  return finish("classifier", engine.kind === "no-rule" || !engine.kind ? "no-rule" : engine.kind, `${why}. No allow rule covers it and it is not read-only, so it goes to the classifier.`);
}

export { activeRules };
