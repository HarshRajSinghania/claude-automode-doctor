// The lint: the traps in the settings that decide what auto mode does. Each finding says which file and line, what
// Claude Code does about it, and on what the statement rests:
//
//   binary  it was put to the real Claude Code binary (the version is in the message or the README)
//   docs    it is what the documentation says, and the binary was not asked
//   issue   it is what an issue thread reports, and the binary was asked about its premise only (the README says how)
//
// A finding has a severity:
//   error    Claude Code drops something the file says (the whole file, or a list of protections)
//   warning  the file still applies, but something in it is probably not what you meant
//   note     worth knowing; nothing is lost
import { MEASURED } from "./measured.mjs";
import { DEFAULTS, LISTS, droppedInAutoMode, replacesDefaults } from "./automode.mjs";
import { AUTOMODE_SCOPES } from "./settings.mjs";
import { splitRule } from "./engine/rule.mjs";
import { pathScopedRuleFiles } from "./rulefiles.mjs";

const V = MEASURED.version;
const SECTION_TEXT = {
  soft_deny: "soft block rules (force push, curl | bash, production deploys and the rest)",
  hard_deny: "hard block rule (data exfiltration)",
  allow: "allow exceptions",
  environment: "environment entries (the trusted repo, source control, the sensitivity defaults)",
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const num = (n) => n.toLocaleString("en-US");

/**
 * Lint the settings. `settings` is the result of loadSettings().
 * Returns { findings: [{ id, severity, effect, evidence, scope, file, display, line, keyPath, message, fix, issue? }], counts, files }.
 */
export function lintSettings(settings) {
  const findings = [];
  const add = (f, partial) => findings.push({ id: partial.id, severity: partial.severity, effect: partial.effect || "none", evidence: partial.evidence || "binary", scope: f ? f.scope : null, file: f ? f.path : null, display: f ? f.display : null, line: partial.line || null, keyPath: partial.keyPath || null, message: partial.message, fix: partial.fix || null, issue: partial.issue || null });

  // ---- files Claude Code ignores whole ------------------------------------------------------------------------------
  for (const f of settings.files) {
    if (!f.exists || !f.ignored) continue;
    const am = f.view && f.view.autoMode;
    const perm = f.view && f.view.permissions;
    const carries = [];
    if (am) carries.push("an autoMode block");
    if (perm && (perm.allow.length || perm.ask.length || perm.deny.length)) carries.push(plural(perm.allow.length + perm.ask.length + perm.deny.length, "permission rule", "permission rules"));
    if (perm && perm.disableAutoMode) carries.push("permissions.disableAutoMode");
    if (f.ignored.reason === "not-json") {
      if (!carries.length) continue; // claude-settings-doctor lint is the tool for a file that says nothing about auto mode
      add(f, { id: "file-ignored", severity: "error", effect: "file", line: f.ignored.line, message: `Claude Code ignores this whole file because it has ${f.ignored.detail}; ${carries.join(" and ")} in it do nothing.`, fix: "Remove the comment or the trailing comma. claude-settings-doctor builds a settings.json from a commented settings.jsonc." });
    }
  }

  // ---- wrong types (the whole file is ignored) ------------------------------------------------------------------------
  for (const f of settings.files) {
    if (!f.exists || !f.view) continue;
    for (const p of f.view.problems) {
      add(f, { id: "wrong-type", severity: "error", effect: "file", line: p.line, keyPath: p.path.join("."), message: `${p.message}. Claude Code ignores the whole file when it finds this, with everything else in it (put to Claude Code ${V}).`, fix: p.path[1] === "disableAutoMode" ? 'Write "disable", or remove the key.' : p.path[0] === "autoMode" ? "Write the lists as arrays of strings and classifyAllShell as true or false." : "Write true or false." });
    }
  }

  // ---- the autoMode block ---------------------------------------------------------------------------------------------
  for (const f of settings.files) {
    if (!f.exists || !f.view || !f.view.autoMode) continue;
    const am = f.view.autoMode;
    if (!AUTOMODE_SCOPES.has(f.scope)) {
      if (!f.ignored) add(f, { id: "automode-not-read", severity: "warning", effect: "key", line: am.line, keyPath: "autoMode", message: `Claude Code reads autoMode from the user's settings and from managed settings, not from ${f.scope === "project" ? "a project's shared .claude/settings.json" : "a project's .claude/settings.local.json"}: this block does nothing (claude auto-mode config ignores it, ${V}).`, fix: "Move the block to ~/.claude/settings.json (or the settings.json in CLAUDE_CONFIG_DIR). A repository's own file is not read for it so that a checked-in repository cannot widen what the classifier allows." });
      continue;
    }
    if (f.ignored) continue;
    for (const p of am.problems) if (p.kind === "unknown-key") add(f, { id: "unknown-key", severity: "warning", effect: "key", line: p.line, keyPath: p.path.join("."), message: p.message, fix: p.near ? `Write ${p.near}.` : "Remove it, or use one of allow, soft_deny, hard_deny, environment and classifyAllShell." });
    for (const key of LISTS) {
      const l = am.lists[key];
      if (!l || !l.valid) continue;
      const texts = l.items.map((i) => i.text);
      const builtin = MEASURED.builtin[key];
      if (texts.length === 0) {
        add(f, { id: "empty-list", severity: "note", line: l.line, keyPath: `autoMode.${key}`, message: `autoMode.${key} is an empty list, which changes nothing: the ${builtin} built-in ${plural(builtin, "rule", "rules").split(" ")[1]} stay (put to Claude Code ${V}).`, fix: "Remove it, or add entries and \"$defaults\"." });
        continue;
      }
      if (texts.filter((t) => t === DEFAULTS).length > 1) add(f, { id: "defaults-twice", severity: "note", line: l.line, keyPath: `autoMode.${key}`, message: `autoMode.${key} has "$defaults" more than once; the built-in rules are put in once, at the first place (put to Claude Code ${V}).`, fix: 'Keep one "$defaults".' });
      if (replacesDefaults(texts)) {
        const n = texts.length;
        const removed = MEASURED.removedChars[key];
        const full = builtin >= 5 && n >= builtin; // a list as long as a long built-in one may be a copy you own on purpose
        add(f, {
          id: "replaces-defaults",
          severity: full ? "note" : key === "soft_deny" || key === "hard_deny" ? "error" : "warning",
          effect: "list", line: l.line, keyPath: `autoMode.${key}`,
          message: full
            ? `autoMode.${key} has ${plural(n, "entry", "entries")} and no "$defaults", so it replaces the ${builtin} built-in ${SECTION_TEXT[key]}. It has as many entries as the built-in list, so it may be a copy you own on purpose.`
            : `autoMode.${key} has ${plural(n, "entry", "entries")} and no "$defaults", so it replaces the ${builtin} built-in ${SECTION_TEXT[key]}: the classifier's prompt lost about ${num(removed)} characters of them (Claude Code ${V}).`,
          fix: full ? "Nothing to do if you meant it. claude auto-mode defaults prints the built-in rules to compare with." : `Put "$defaults" in the list to keep the built-in rules and add yours: "${key}": ["$defaults", ...]. Leave it out only to own the whole list; claude auto-mode defaults prints the built-in rules to copy.`,
        });
      }
    }
    if (am.classifyAllShell && am.classifyAllShell.value === true) {
      const live = settings.files.filter((x) => !x.ignored && x.view && x.view.permissions);
      const allowShell = live.flatMap((x) => x.view.permissions.allow).filter((r) => { const sp = splitRule(r.raw); return sp.tool === "Bash" || sp.tool === "PowerShell"; }).length;
      add(f, { id: "classify-all-shell", severity: "warning", line: am.classifyAllShell.line, keyPath: "autoMode.classifyAllShell", message: `autoMode.classifyAllShell is true: every Bash and PowerShell allow rule is suspended while auto mode is on${allowShell ? ` (${plural(allowShell, "rule", "rules")} in your settings)` : ""}, so every shell command that is not read-only waits for the classifier. Read-only commands such as echo and ls still skip it (put to Claude Code ${V}).`, fix: "Keep it only if you want every such command judged. `report` shows how many commands the classifier has seen, `cost` what a classified command costs." });
    }
  }

  // ---- permissions.disableAutoMode ------------------------------------------------------------------------------------
  for (const f of settings.files) {
    if (!f.exists || f.ignored || !f.view || !f.view.permissions || !f.view.permissions.disableAutoMode) continue;
    const d = f.view.permissions.disableAutoMode;
    if (d.value === "disable") add(f, { id: "auto-mode-disabled", severity: "note", line: d.line, keyPath: "permissions.disableAutoMode", message: `permissions.disableAutoMode is "disable": auto mode is off for every session that reads this file, and a session started with --permission-mode auto starts in the default mode, with no classifier (put to Claude Code ${V} in the user, project and local files).`, fix: "Remove the key to use auto mode again." });
  }

  // ---- the bad interactions --------------------------------------------------------------------------------------------
  const live = settings.files.filter((f) => f.exists && !f.ignored && f.view && f.view.permissions);
  const blockReads = live.find((f) => f.view.permissions.blockReads && f.view.permissions.blockReads.value === true);
  if (blockReads) {
    const b = blockReads.view.permissions.blockReads;
    add(blockReads, { id: "block-reads-bash-first", severity: "warning", line: b.line, keyPath: "permissions.blockReadsOutsideWorkingDirectories", issue: 95238, evidence: "binary", message: `permissions.blockReadsOutsideWorkingDirectories is true, and auto mode tells Claude it can do much of its work through the Bash tool (cat, sed -n, grep, heredocs). With the setting on, a Bash command that Claude Code cannot show stays inside the working folder is asked about, whatever your allow rules say, and the classifier never sees it: seen on Claude Code ${V} for cat $(...), a path with .. and a cd (even cd sub && ...). In claude -p such a command is refused. Issue #95238.`, fix: "Add the folders Claude reads with permissions.additionalDirectories or /add-dir, or turn the setting off; Claude's own Read, Grep and Glob tools are not affected by the Bash-first instruction." });
  }
  const readDeny = live.flatMap((f) => f.view.permissions.deny.map((r) => ({ f, r }))).filter(({ r }) => /^Read(\(|$)/.test(r.raw));
  if (readDeny.length) {
    const { f, r } = readDeny[0];
    add(f, { id: "read-deny-cd", severity: "note", line: r.line, keyPath: "permissions.deny", issue: 91650, evidence: "binary", message: `${plural(readDeny.length, "Read deny rule", "Read deny rules")} (first: ${r.raw}). While a Read deny rule exists, a compound command with a cd followed by a read of a relative path is no longer approved by looking at it: on Claude Code ${V} in auto mode it went to the classifier (cd sub && sed -n 1,2p b.txt did, and was approved by looking at it without the rule). Issue #91650 reports a prompt for the same command on 2.1.257 to 2.1.259.`, fix: "Run the command without the cd (sed -n 1,2p sub/b.txt), or accept the classifier call." });
  }
  const rulesFiles = pathScopedRuleFiles({ project: settings.project, configDir: settings.configDir });
  if (rulesFiles.length) {
    const first = rulesFiles[0];
    add(null, { id: "path-rules-bash", severity: "note", issue: 88565, evidence: "binary", keyPath: null, message: `${plural(rulesFiles.length, "rule file has", "rule files have")} a paths: front matter (first: ${first.path.replace(/\\/g, "/").slice(-70)} for ${first.globs.slice(0, 2).join(", ")}). Claude Code loads such a file when Claude uses Read, Write or Edit on a matching file, not when a Bash command changes the file: on ${V} a redirection into a matching file did not load it, while Write did. Auto mode tells Claude it can do much of its work through Bash. Issue #88565.`, fix: "Put what must always hold in CLAUDE.md, or tell Claude to use Edit and Write for those files." });
  }

  // ---- allow rules that auto mode drops ---------------------------------------------------------------------------------
  const dropped = [];
  for (const f of settings.files) {
    if (!f.exists || f.ignored || !f.view || !f.view.permissions) continue;
    for (const r of f.view.permissions.allow) {
      const sp = splitRule(r.raw);
      if (sp.shape === "malformed") continue;
      if (droppedInAutoMode(sp.tool, sp.content)) dropped.push({ f, r, sp });
    }
  }
  for (const { f, r } of dropped.slice(0, 8)) {
    add(f, { id: "dropped-allow-rule", severity: "note", line: r.line, keyPath: "permissions.allow", message: `${r.raw} is dropped when auto mode starts: a rule this broad would let anything run, so commands it matched go to the classifier instead (put to Claude Code ${V}). A narrower rule, such as Bash(npm run test *), stays.`, fix: "Narrow the rule if you want it to skip the classifier." });
  }
  if (dropped.length > 8) add(null, { id: "dropped-allow-rule", severity: "note", message: `... and ${dropped.length - 8} more allow rules that auto mode drops.` });

  const rank = { error: 0, warning: 1, note: 2 };
  findings.sort((a, b) => rank[a.severity] - rank[b.severity]);
  const counts = { error: 0, warning: 0, note: 0 };
  for (const f of findings) counts[f.severity]++;
  return { findings, counts };
}
