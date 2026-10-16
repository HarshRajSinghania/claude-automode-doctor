// Allow rules for the commands the classifier turned back more than once.
//
// This exists because the binary shows that a narrow allow rule skips the classifier in auto mode (README, "What was
// verified"). A rule that auto mode drops would help nobody, so a proposal is checked against the whole command line that
// was turned back: every part of it that is not already approved gets a rule that is not one of the broad rules auto mode
// drops, and with those rules added `why` must say the line no longer goes to the classifier. A line for which no rules can
// do that (inline code, a pipe into a shell, a variable in front) is listed as one no rule helps.
//
// Two kinds of refusal are told apart, because they are not the same decision:
//   judged     the classifier read the command and called it dangerous ([Code from External], [Git Destructive] ...).
//              An allow rule makes it run unchecked from then on, so these are listed with the category and the risk,
//              and written only with --include-judged.
//   no verdict the check did not run (the service was unavailable, the answer could not be read). Nothing was judged.
import { checkRule, SHELL_TOOLS } from "./engine/rule.mjs";
import { parseContent } from "./engine/pattern.mjs";
import { parseBash } from "./engine/shell.mjs";
import { parsePowerShell } from "./engine/powershell.mjs";
import { inlineCode, operation, ruleFor } from "./engine/propose.mjs";
import { SAFE_ENV, strippedWords } from "./engine/wrappers.mjs";
import { droppedInAutoMode } from "./automode.mjs";
import { whyCommand } from "./why.mjs";

/** The settings with extra allow rules, as if they were in the user's file. */
export function withRules(settings, raws) {
  const rules = [...settings.rules];
  for (const raw of raws) {
    const check = checkRule(raw, "allow");
    const r = check.rule;
    const entry = { raw, behavior: "allow", tool: r.tool, content: r.content, shape: r.shape, problem: check.problem, warnings: check.warnings, scope: "user", file: "(proposed)", label: "proposed rule", index: rules.length, bare: false, parsed: null };
    if (!check.problem) {
      if (SHELL_TOOLS.has(r.tool) && r.content !== undefined) {
        entry.parsed = r.content === ":*" ? null : parseContent(r.content);
        if (r.content === "*") entry.bare = true;
      }
      if (r.content === undefined) entry.bare = true;
    }
    rules.push(entry);
  }
  return { ...settings, rules };
}

const contentOf = (rule) => { const m = /^[A-Za-z]+\((.*)\)$/s.exec(rule); return m ? m[1] : undefined; };

/**
 * The rules a command line needs to skip the classifier: { rules: [{ rule, key, risk, text }] } or { problem } when no
 * rule can do it.
 */
function rulesFor(entry, { settings, cwd, home, platform }) {
  const ps = entry.tool === "PowerShell";
  const parsed = ps ? parsePowerShell(entry.subject) : parseBash(entry.subject);
  if (!parsed.ok) return { problem: "Claude Code cannot parse the command line, so no rule can approve it" };
  const need = [];
  for (const cmd of parsed.cmds) {
    if (!cmd.argv.length || cmd.inert) continue;
    const words = ps ? cmd.argv.map((w) => w.value) : strippedWords(cmd, "allow");
    const part = whyCommand({ tool: entry.tool, command: cmd.text, settings, cwd, home, platform });
    if (part.outcome === "static") continue; // approved by looking at it
    if (part.outcome === "refused" || part.outcome === "prompt") return { problem: part.summary };
    if (!ps && cmd.assigns.some((a) => !SAFE_ENV.has(a.raw.slice(0, a.raw.indexOf("="))))) return { problem: `a variable in front of ${words[0] || "the command"} stops an allow rule from matching` };
    if (inlineCode(words)) return { problem: `${cmd.text} is inline code: only a rule that spells out the whole command could approve it, and it would approve nothing else` };
    const op = operation(words);
    if (!op) return { problem: `no rule can be written for ${cmd.text}` };
    const rule = ruleFor(entry.tool, op.key);
    if (droppedInAutoMode(entry.tool, contentOf(rule))) return { problem: `${rule} is one of the broad rules auto mode drops, so it would not skip the classifier` };
    if (!need.some((n) => n.rule === rule)) need.push({ rule, key: op.key, risk: op.risk, text: cmd.text });
  }
  return { rules: need };
}

/**
 * Propose rules.
 *   settings   loadSettings() for the project
 *   report     buildReport() for the same transcripts
 *   min        how often a command line must have been turned back (default 2)
 *   cwd, home, platform   for `why`
 * Returns { proposals, skipped, stats }:
 *   proposals  [{ rule, tool, key, count, judged, noVerdict, categories, causes, risk, examples, last, skipsClassifier }]
 *   skipped    [{ subject, count, reason }] refusals no rule can fix
 */
export function suggestRules({ settings, report, min = 2, cwd, home, platform = process.platform }) {
  const groups = new Map();
  const skipped = [];
  const stats = { lines: 0, below: 0, covered: 0 };
  const entries = [
    ...report.refused.filter((r) => (r.tool === "Bash" || r.tool === "PowerShell") && r.subject).map((r) => ({ ...r, kind: "judged" })),
    ...report.noVerdict.filter((r) => (r.tool === "Bash" || r.tool === "PowerShell") && r.subject).map((r) => ({ ...r, kind: "noVerdict" })),
  ];
  // one rule can serve several command lines: count the turned-back lines per rule, but only a line a whole set of rules fixes
  for (const e of entries) {
    stats.lines += e.count;
    const r = rulesFor(e, { settings, cwd, home, platform });
    if (r.problem) { skipped.push({ subject: e.subject, count: e.count, reason: r.problem }); continue; }
    if (!r.rules.length) { stats.covered += e.count; continue; }
    // with these rules added, the whole line must stop going to the classifier
    const after = whyCommand({ tool: e.tool, command: e.subject, settings: withRules(settings, r.rules.map((n) => n.rule)), cwd, home, platform });
    if (after.outcome === "classifier") { skipped.push({ subject: e.subject, count: e.count, reason: `even with ${r.rules.map((n) => n.rule).join(" and ")} the line goes to the classifier: ${after.summary}` }); continue; }
    for (const n of r.rules) {
      const key = `${e.tool}\u0000${e.tool === "PowerShell" ? n.rule.toLowerCase() : n.rule}`;
      let g = groups.get(key);
      if (!g) { g = { rule: n.rule, tool: e.tool, key: n.key, count: 0, judged: 0, noVerdict: 0, categories: new Set(), causes: new Set(), risk: n.risk, examples: [], last: "", lines: new Set() }; groups.set(key, g); }
      g.count += e.count;
      g.lines.add(e.subject);
      if (e.kind === "judged") { g.judged += e.count; if (e.category || e.reason) g.categories.add(e.category || e.reason); } else { g.noVerdict += e.count; if (e.cause) g.causes.add(e.cause); }
      if (g.examples.length < 3 && !g.examples.includes(e.subject)) g.examples.push(e.subject.length > 90 ? `${e.subject.slice(0, 87)}...` : e.subject);
      if (e.last > g.last) g.last = e.last;
    }
  }
  const proposals = [];
  for (const g of groups.values()) {
    if (g.count < min) { stats.below++; continue; }
    proposals.push({ rule: g.rule, tool: g.tool, key: g.key, count: g.count, judged: g.judged, noVerdict: g.noVerdict, categories: [...g.categories], causes: [...g.causes], risk: g.risk, examples: g.examples, last: g.last, lines: g.lines.size, skipsClassifier: true });
  }
  proposals.sort((a, b) => b.count - a.count || a.rule.localeCompare(b.rule));
  return { proposals, skipped, stats };
}
