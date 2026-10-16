// Why a command does or does not go to the auto mode classifier.
//
// The order Claude Code follows in auto mode (documentation, "How the classifier evaluates actions"; each step below was
// put to the binary, see test/auto-table.mjs):
//   1. deny rules refuse the command; ask rules make it prompt, and the classifier cannot approve what they stop;
//   2. an rm or rmdir of a critical path stops at a safety check that asks you, whatever allow rules say;
//   3. allow rules approve it, except the broad ones auto mode drops (Bash(*), Bash(python *), Bash(npm run *) ...),
//      or all of them with autoMode.classifyAllShell;
//   4. a read-only command, and the file commands the permission mode approves (mkdir, touch, rm, rmdir, mv, cp, sed, a
//      redirection into a file) inside the working folders, are approved by looking at them;
//   5. everything else goes to the classifier.
// The static analysis (the shell reader, the read-only list, the rule matching) is the engine copied from
// claude-permission-doctor, which was checked against the default permission mode; what this file adds is the
// auto mode layer on top, and that is what the table checks.
import path from "node:path";
import { decideShell } from "./engine/decide.mjs";
import { parseBash } from "./engine/shell.mjs";
import { READS_FILES, readOnly } from "./engine/readonly.mjs";
import { SAFE_ENV, strippedWords } from "./engine/wrappers.mjs";
import { hasDoubleSlash, resolveArg, insideAny, unsafePath } from "./engine/paths.mjs";
import { droppedInAutoMode } from "./automode.mjs";

const SIMPLE_EDITS = new Set(["mkdir", "touch", "rm", "rmdir"]);
const SHELLS = new Set(["bash", "sh", "zsh", "dash"]);
// programs that read files, for the cd + Read deny rule case (put to the binary: ls cat head wc stat file diff grep sort jq find git
// and sed after a cd went to the classifier; echo pwd date tree du which test did not)
const CD_READERS = new Set([...READS_FILES, "find", "git"]);

// Folders and files that auto mode treats as protected: a write to one goes to the classifier (documentation, "Protected
// paths"; .git, .claude, .vscode and .env-style names were put to the binary)
const PROTECTED_DIRS = new Set([".git", ".vscode", ".idea", ".husky", ".cargo", ".devcontainer", ".yarn", ".mvn", ".claude"]);
const PROTECTED_FILES = new Set([".gitconfig", ".gitmodules", ".bashrc", ".bash_profile", ".bash_login", ".bash_aliases", ".bash_logout", ".zshrc", ".zprofile", ".zshenv", ".zlogin", ".zlogout", ".profile", ".envrc", ".npmrc", ".yarnrc", ".yarnrc.yml", ".pnp.cjs", ".pnp.loader.mjs", ".pnpmfile.cjs", "bunfig.toml", ".bunfig.toml", ".bazelrc", ".bazelversion", ".bazeliskrc", ".pre-commit-config.yaml", "lefthook.yml", "lefthook.yaml", ".lefthook.yml", ".lefthook.yaml", "gradle-wrapper.properties", "maven-wrapper.properties", ".devcontainer.json", ".ripgreprc", "pyrightconfig.json", ".mcp.json", ".claude.json"]);

export function isProtectedPath(abs) {
  const parts = path.resolve(abs).split(/[\\/]+/).filter(Boolean).map((s) => (process.platform === "win32" ? s.toLowerCase() : s));
  if (parts.some((s) => PROTECTED_DIRS.has(s))) return true;
  return PROTECTED_FILES.has(parts[parts.length - 1] || "");
}

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

const ruleInfo = (r) => (r ? { raw: r.raw, behavior: r.behavior, scope: r.scope, file: r.file, label: r.label } : null);

// ---- critical paths -------------------------------------------------------------------------------------------------------
// an rm or rmdir target that is a critical path: the root, a top-level folder, the home folder, the working folder or one
// of its parents, a glob straight in the working folder or under the home folder or under a variable nothing assigns
function criticalTarget(arg, ctx, assigned) {
  const bare = arg.replace(/^"(.*)"$/, "$1");
  if (bare === "~" || bare === "~/" || bare === "$HOME" || bare === "${HOME}" || bare === "$HOME/" || /^(~|\$HOME|\$\{HOME\})\/\*$/.test(bare)) return true;
  if (bare === "*" || bare === "./*" || bare === "./*/" || bare === "*/") return true;
  if (/^\$\(.*\)$/.test(bare) || /^`.*`$/.test(bare)) return true; // only the output of a command substitution
  const v = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?\/(\*|\*\/)?$/.exec(bare);
  if (v && !assigned.has(v[1]) && v[1] !== "HOME") return true; // a glob or trailing slash straight under a variable that nothing assigns
  const abs = resolveArg(bare, ctx.cwd, ctx.home);
  if (!abs) return false;
  const root = path.parse(abs).root;
  if (abs === root || path.dirname(abs) === root) return true; // the root, a top-level folder
  if (ctx.home && path.resolve(ctx.home) === abs) return true;
  const rel = path.relative(abs, path.resolve(ctx.cwd));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)); // the working folder or a parent of it
}

function removalsOf(parsed) {
  // every rm or rmdir in the command, also inside a bash -c '...' script
  const found = [];
  const visit = (p, depth) => {
    const assigned = new Set(p.cmds.flatMap((c) => c.assigns.map((a) => a.raw.slice(0, a.raw.indexOf("=")))));
    for (const c of p.cmds) {
      const words = strippedWords(c, "allow");
      const name = words[0];
      if (name === "rm" || name === "rmdir") found.push({ cmd: c, words, assigned });
      if (depth < 2 && SHELLS.has(name)) {
        const i = words.indexOf("-c");
        if (i > 0 && words[i + 1] !== undefined) { const inner = parseBash(words[i + 1]); if (inner.ok) visit(inner, depth + 1); }
      }
    }
  };
  visit(parsed, 0);
  return found;
}

function criticalRemoval(parsed, ctx) {
  for (const r of removalsOf(parsed)) {
    for (const o of r.words.slice(1).filter((w) => !w.startsWith("-"))) if (criticalTarget(o, ctx, r.assigned)) return { text: r.cmd.text, target: o };
    // the raw word, for a target written with a substitution that the reader marks as dynamic
    for (const w of r.cmd.argv.slice(1)) if (!w.value.startsWith("-") && criticalTarget(w.raw, ctx, r.assigned)) return { text: r.cmd.text, target: w.raw };
  }
  return null;
}

// ---- what the permission mode approves ------------------------------------------------------------------------------------
const OUTPUT_OPS = /^(>|>>|>\||&>|&>>|<>)$/;

// does every redirection of the command write only to /dev/null or inside the working folders (and not to a protected path)?
function redirectsInside(cmd, ctx) {
  for (const r of cmd.redirs || []) {
    if (r.heredoc || !r.target) continue;
    const isOut = OUTPUT_OPS.test(r.op) || (r.op === ">&" && !/^\d+$|^-$/.test(r.target.value));
    if (!isOut) {
      // an input redirection with a .. after a folder name or a // in it is asked about too
      if (r.op === "<" && !r.target.dynamic && unsafePath(r.target.value, ctx.platform)) return false;
      continue;
    }
    const target = r.target.value;
    if (target === "/dev/null") continue;
    if (r.target.dynamic || unsafePath(target, ctx.platform)) return false;
    const abs = resolveArg(target, ctx.cwd, ctx.home);
    if (!abs || !insideAny(abs, ctx.dirs) || isProtectedPath(abs)) return false;
  }
  return true;
}

// the words of a command once the safe variables and the wrappers the mode looks through are off; null when xargs, env or
// an unsafe variable is in the way, or the program is written with a path or a backslash
function modeWords(cmd) {
  const values = [...cmd.assigns, ...cmd.argv].map((w) => w.value);
  const words = strippedWords(cmd, "allow");
  const taken = values.slice(0, values.length - words.length);
  if (taken.includes("xargs")) return null;
  if (cmd.argv.length && cmd.argv[0].raw.startsWith("\\") && !taken.length) return null; // \touch: written with a backslash
  return words;
}

// the sed forms the mode approves (put to the binary): sed [-E] -i|--in-place 's/x/y/flags' files, and sed 's/x/y/' files
function sedApproved(words) {
  const rest = words.slice(1);
  let inPlace = false;
  const operands = [];
  for (const w of rest) {
    if (w === "-i" || w === "--in-place") { inPlace = true; continue; }
    if (w === "-E" || w === "-r") continue;
    if (w.startsWith("-")) return null; // -n with -i, -e, -f, -z, -s, -i.bak ...: not one of the forms
    operands.push(w);
  }
  if (!operands.length) return null;
  const script = operands[0];
  if (!/^s(.)(?:(?!\1).|\\.)*\1(?:(?!\1).|\\.)*\1[gpiI0-9]*$/.test(script)) return null; // a substitution without the e and w flags
  return operands.slice(1);
}

// does the permission mode approve this part? returns { ok, why }
function modeApproves(cmd, ctx) {
  if (!redirectsInside(cmd, ctx)) return { ok: false, why: "it writes through a redirection outside the working folders" };
  const words = modeWords(cmd);
  if (words === null) return { ok: false, why: "xargs, env, a program written with a path or an unsafe variable in front stop it" };
  if (!words.length) return (cmd.redirs || []).length > 0 ? { ok: true } : { ok: false, why: "nothing to run" };
  const name = words[0];
  const operandsInside = (list) => {
    for (const f of list) {
      const abs = resolveArg(f, ctx.cwd, ctx.home);
      if (!abs) return `${f} cannot be known before it runs`;
      if (!insideAny(abs, ctx.dirs)) return `${f} is outside the working folders`;
      if (unsafePath(f, ctx.platform)) return `${f} has a .. after a folder name or a // in it`;
      if (isProtectedPath(abs)) return `${f} is a protected path`;
    }
    return null;
  };
  const operands = (ws) => { const out = []; let dashes = false; for (const w of ws.slice(1)) { if (!dashes && w === "--") { dashes = true; continue; } if (dashes || !w.startsWith("-")) out.push(w); } return out; };
  let bad = null;
  if (SIMPLE_EDITS.has(name)) bad = operandsInside(operands(words));
  else if (name === "cp" || name === "mv") {
    if (words.slice(1).some((w) => w.startsWith("-"))) return { ok: false, why: `${name} is approved without the classifier only with no option at all` };
    bad = operandsInside(words.slice(1));
  } else if (name === "sed") {
    const files = sedApproved(words);
    if (files === null) return { ok: false, why: "sed is approved without the classifier only as sed [-E] -i 's/x/y/' file, or sed 's/x/y/' file, or a read-only sed -n 'Np'" };
    bad = operandsInside(files);
  } else {
    // a read-only command (or one an allow rule covers, which the caller checks) that writes through a redirection inside the folders
    const ro = readOnly(words, { cwd: ctx.cwd, home: ctx.home, dirs: ctx.dirs, platform: ctx.platform, allowed: () => false });
    if (ctx.platform === "win32" && hasDoubleSlash(cmd.text)) return { ok: false, why: "a // inside the command could be a network path" };
    if (!ro.ok) return { ok: false, why: `${name} is not one of the file commands the mode approves` };
    return (cmd.redirs || []).length ? { ok: true } : { ok: false, why: "nothing to approve" };
  }
  return bad ? { ok: false, why: bad } : { ok: true };
}

// ---- the PowerShell tool ---------------------------------------------------------------------------------------------------
// The cmdlets the permission mode approves inside the working folders (put to the binary on Windows, Windows PowerShell 5.1):
// Set-Content, Add-Content, Clear-Content, Remove-Item and the aliases ac, rm, del, erase, ri, rd, rmdir. New-Item, Copy-Item,
// Move-Item, Out-File and a redirection are not among them, and sc is sc.exe there.
const PS_EDITS = new Set(["set-content", "add-content", "clear-content", "remove-item", "ac", "rm", "del", "erase", "ri", "rd", "rmdir"]);
const PS_REMOVE = new Set(["remove-item", "rm", "del", "erase", "ri", "rd", "rmdir"]);
const PS_PATH_PARAMS = new Set(["-path", "-literalpath", "-lp", "-pspath"]);
const PS_VALUE_PARAMS = new Set(["-value", "-encoding", "-filter", "-include", "-exclude", "-stream", "-nonewline"]);

function psOperands(words, name) {
  const out = [];
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    const lw = w.toLowerCase();
    if (PS_PATH_PARAMS.has(lw)) { if (words[i + 1] !== undefined) out.push(words[++i]); continue; }
    if (lw.startsWith("-")) { if (PS_VALUE_PARAMS.has(lw) && lw !== "-nonewline") i++; continue; }
    out.push(w);
    if (name === "set-content" || name === "add-content") break; // the second positional is the value
  }
  return out;
}

// what the PowerShell mode does with one part: { ok } approved, { safety } refused by the built-in check on Remove-Item, or { ok: false }
function psModeVerdict(cmd, ctx) {
  const words = cmd.argv.map((w) => w.value);
  const name = (words[0] || "").toLowerCase();
  if (!PS_EDITS.has(name)) return { ok: false };
  const operands = psOperands(words, name);
  const remove = PS_REMOVE.has(name);
  for (const o of operands) {
    if (remove) {
      // wildcards and the system paths are refused by a check that asks nothing (documentation: "Remove-Item in PowerShell")
      const wildcard = o === "*" || /[\\/]\*$/.test(o);
      const system = o === "~" || o === "~/" || o === "/" || o === "\\" || /^[A-Za-z]:[\\/]?$/.test(o) || /^[A-Za-z]:[\\/][^\\/]+[\\/]?$/.test(o) || /^[\\/][^\\/]+[\\/]?$/.test(o);
      if (wildcard || system) return { safety: true, target: o };
    }
    if (o.includes(",")) return { ok: false, why: "a list of paths is not one of the forms the mode approves" };
    const abs = resolveArg(o, ctx.cwd, ctx.home);
    if (!abs || !insideAny(abs, ctx.dirs) || isProtectedPath(abs)) return { ok: false, why: `${o} is not a path inside the working folders the mode can check` };
  }
  if (remove && words.some((w) => /^-recurse$/i.test(w))) {
    // removing the working folder or a parent of it, recursively, is judged by the classifier
    for (const o of operands) { const abs = resolveArg(o, ctx.cwd, ctx.home); const rel = path.relative(abs, path.resolve(ctx.cwd)); if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) return { ok: false, why: "a recursive removal of the working folder or a parent of it" }; }
  }
  return { ok: true };
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
    out.dropped = auto.dropped.map((d) => ({ raw: d.rule.raw, why: d.why })).filter((d) => engine.parts.concat(asDefault.parts).some((p) => p.rule && p.rule.raw === d.raw));
  }
  const finish = (outcome, basis, summary, rule = null) => Object.assign(out, { outcome, basis, summary, rule: ruleInfo(rule) });

  if (engine.verdict === "deny") return finish("refused", engine.kind === "tool-denied" ? "tool-denied" : "deny-rule", `${engine.summary}. A deny rule refuses the command before the classifier is asked.`, engine.rule);
  if (engine.verdict === "ask" && engine.kind === "ask-rule") return finish("prompt", "ask-rule", `${engine.summary}. An ask rule makes Claude Code prompt you, and the classifier cannot approve what it stops; claude -p has nobody to ask and refuses the command.`, engine.rule);

  const parsed = tool === "Bash" ? parseBash(command) : null;
  if (tool === "PowerShell" && engine.verdict === "ask" && (engine.kind === "no-rule" || engine.kind === "path")) {
    const need = engine.parts.filter((p) => !["allow", "read-only", "assign", "inert"].includes(p.status) || p.blockKind);
    const verdicts = need.map((p) => ({ p, v: psModeVerdict(p.cmd, ctx) }));
    const stop = verdicts.find((x) => x.v.safety);
    if (stop) return finish("refused", "safety-check", `Remove-Item on ${stop.v.target} is blocked by a built-in check: a wildcard, a system path or your home folder is refused in every mode, without asking and before the classifier (the documentation says so; seen in claude -p).`);
    if (need.length && verdicts.every((x) => x.v.ok)) {
      for (const { p } of verdicts) { const mine = out.parts.find((x) => x.text === p.text); if (mine) { mine.status = "mode"; mine.detail = "approved by the permission mode"; } }
      return finish("static", "mode", `${verdicts.map((x) => x.p.text).join("; ")} ${verdicts.length === 1 ? "is" : "are"} approved by the permission mode (the PowerShell file cmdlets inside the working folders), so the command skips the classifier.`);
    }
  }
  if (parsed && parsed.ok) {
    const crit = criticalRemoval(parsed, ctx);
    if (crit) return finish("prompt", "critical-path", `${crit.text} removes a critical path (${crit.target}): a safety check stops it whatever allow rules say. Claude Code asks you in a terminal session (the documentation) and refuses it in claude -p (seen); the classifier is not asked.`);
  }
  const readBlock = settings.files.some((f) => !f.ignored && f.view && f.view.permissions && f.view.permissions.blockReads && f.view.permissions.blockReads.value === true);
  if (readBlock && parsed && parsed.ok) {
    const cd = engine.parts.find((p) => strippedWords(p.cmd, "allow")[0] === "cd");
    const nested = parsed.issues.find((i) => i.kind === "substitution" || i.kind === "quoted-substitution" || i.kind === "process-substitution");
    const outside = engine.parts.find((p) => p.outside || (p.blockKind === "path" && p.unsafePath === undefined && !p.redirect));
    if (cd || nested || outside) return finish("prompt", "block-reads", `permissions.blockReadsOutsideWorkingDirectories is on, and ${cd ? "a cd" : nested ? "a command substitution" : "a path outside the working folders"} cannot be shown to stay inside them: Claude Code asks you, whatever allow rules say, and the classifier is not asked; claude -p refuses it.`);
  }

  const readDeny = settings.rules.some((r) => r.behavior === "deny" && r.tool === "Read" && !r.problem && !r.ignored);
  if (readDeny && parsed && parsed.ok) {
    const parts = engine.parts.map((p) => ({ p, name: strippedWords(p.cmd, "allow")[0] }));
    const reader = parts.find((x) => x.name && x.name !== "cd" && CD_READERS.has(x.name));
    if (parts.some((x) => x.name === "cd") && reader) return finish("classifier", "read-deny-cd", `a Read deny rule exists and the line has a cd and ${reader.name}, which reads files: Claude Code no longer approves such a compound command by looking at it (issue #91650), so it goes to the classifier.`);
  }
  if (engine.verdict === "allow") {
    // a read-only command that writes through a redirection is only as good as the redirection
    const unsafeRedirect = parsed && parsed.ok && engine.parts.some((p) => !redirectsInside(p.cmd, ctx));
    if (!unsafeRedirect) {
      const rule = engine.rule;
      if (rule) return finish("static", "allow-rule", `${engine.summary}; auto mode keeps this rule, so the command skips the classifier.`, rule);
      return finish("static", "read-only", "every part of it is read-only, so it is approved by looking at it and skips the classifier.");
    }
  }

  // verdict "ask" (a prompt in the default mode): in auto mode, the permission mode may still approve it
  if (parsed && parsed.ok && (engine.verdict === "allow" || engine.kind === "no-rule" || engine.kind === "path" || engine.kind === "cd")) {
    const covered = (p) => ["allow", "read-only", "assign", "inert"].includes(p.status) && !p.blockKind && !p.redirect;
    const unresolved = engine.parts.filter((p) => !covered(p) || (p.cmd.redirs || []).some((r) => !r.heredoc && r.target && OUTPUT_OPS.test(r.op) && r.target.value !== "/dev/null"));
    const verdicts = unresolved.map((p) => ({ p, v: p.rule && (p.status === "allow" || p.blockKind === "path") && p.unsafePath === undefined && p.outside === undefined && !(p.redirect && p.redirect.unsafe) && redirectsInside(p.cmd, ctx) ? { ok: true } : modeApproves(p.cmd, ctx) }));
    const hasCd = engine.parts.some((p) => strippedWords(p.cmd, "allow")[0] === "cd");
    if (unresolved.length && verdicts.every((x) => x.v.ok)) {
      if (hasCd) {
        notes.push("A cd in the same command as an edit makes Claude Code send the command to the classifier: the folder the edit works in is not known before it runs (seen).");
      } else {
        for (const { p } of verdicts) { const mine = out.parts.find((x) => x.text === p.text); if (mine) { mine.status = "mode"; mine.detail = "approved by the permission mode"; } }
        return finish("static", "mode", `${verdicts.map((x) => x.p.text).join("; ")} ${verdicts.length === 1 ? "is" : "are"} approved by the permission mode (file edits and the common file commands inside the working folders), so the command skips the classifier.`);
      }
    }
    const why = verdicts.find((x) => !x.v.ok);
    if (why && why.v.why) notes.push(`${why.p.text}: ${why.v.why}.`);
  }
  const why = engine.kind === "unparseable" ? "Claude Code cannot parse the command line" : engine.summary || "nothing approves it";
  return finish("classifier", engine.kind === "no-rule" || !engine.kind ? "no-rule" : engine.kind, `${why}. No allow rule covers it and it is not read-only, so it goes to the classifier.`);
}

export { SAFE_ENV };
