// Plain-text, markdown and JSON reports. Text goes to a terminal (coloured when it is one), markdown is what the skill
// hands to Claude, JSON is for other tools. Nothing here prints prompt text: a report holds counts, settings lines, the
// command or path that was decided, and the reason the classifier gave.
import { NO_VERDICT_CAUSES, SOURCES, SOURCE_TEXT } from "./decisions.mjs";
import { VERSION } from "./version.mjs";

export const palette = (on) => {
  const c = (code) => (s) => (on ? `\x1b[${code}m${s}\x1b[0m` : String(s));
  return { red: c(31), green: c(32), yellow: c(33), blue: c(36), dim: c(2), bold: c(1) };
};

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const num = (n) => Number(n).toLocaleString("en-US");

/** The text broken into lines of at most `width` columns at spaces (a longer word has a line of its own). */
export function wrap(text, width) {
  const lines = [];
  for (const para of String(text).replace(/\r/g, "").split(/\n+/)) {
    let line = "";
    for (const word of para.trim().split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > width) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
    }
    if (line) lines.push(line);
  }
  return lines;
}
const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);
const clip = (s, n) => { const t = String(s).replace(/\s+/g, " "); return t.length > n ? `${t.slice(0, n - 3)}...` : t; };
const SHORT_CAUSE = { unavailable: "unavailable", "server-no-verdict": "no server verdict", "stage-two-error": "stage two failed", "safety-check": "safety check", unparseable: "unreadable answer", "context-window": "too long" };
/** Why the check gave no verdict: the one cause in words, or the causes with their counts when there were several. */
const causeLabel = (r) => {
  const kinds = Object.entries(r.causes || {}).sort((a, b) => b[1] - a[1]);
  if (kinds.length > 1) return kinds.map(([k, c]) => `${SHORT_CAUSE[k] || k}${c > 1 ? ` (${c})` : ""}`).join(", ");
  return `${NO_VERDICT_CAUSES[r.cause] || r.cause}${r.detail ? ` (${r.detail})` : ""}`;
};
/** The rule a refusal named, as the tables show it: [Category], or the reason, or that Claude Code asked instead. */
const refusalLabel = (r, width = 30) => (r.category ? `[${r.category}]` : r.asked && r.asked === r.count ? "(asked instead)" : r.reason ? clip(r.reason, width) : "(no reason)");
/** ", 2 asked instead" for a command that was refused by the classifier and, later, asked about instead. */
const askedNote = (r) => (r.asked && r.asked < r.count ? `, ${r.asked} asked instead` : "");
const where = (f) => `${f.display}${f.line ? `:${f.line}` : ""}`;
const BT = "`";
const day = (iso) => (iso || "").slice(0, 10);
const hm = (iso) => (iso || "").slice(11, 16);

/** The window as the command asked for it: a number of days, or the date --since named. */
const windowWords = (w) => (w.date ? `since ${w.date}` : `the last ${plural(w.days, "day")}`);

// ------------------------------------------------------------------------------------------------------------
// report
// ------------------------------------------------------------------------------------------------------------

function sourceRows(m) {
  const rows = [];
  for (const s of SOURCES) {
    const c = m.sources[s];
    if (!c) continue;
    rows.push({ key: s, label: SOURCE_TEXT[s], allowed: c.allowed, refused: c.refused, noVerdict: c.noVerdict, total: c.total });
  }
  return rows;
}

export function renderReport(m, { color = false } = {}) {
  const p = palette(color);
  const out = [];
  out.push(`${p.bold(`claude-automode-doctor ${VERSION}`)}  what auto mode decided`);
  out.push(`config    ${m.configDir}${m.configSource === "CLAUDE_CONFIG_DIR" ? "  (from CLAUDE_CONFIG_DIR)" : ""}`);
  out.push(`project   ${m.project || "all projects"}${m.session ? `  (session ${m.session}...)` : ""}`);
  out.push(`window    ${windowWords(m.window)} (to ${m.window.until}, days are UTC dates); ${plural(m.files, "transcript")}; ${plural(m.total, "tool decision")}`);
  out.push("");
  if (!m.total) {
    out.push(p.dim("  No tool decision was found in that window. Claude Code keeps transcripts for 30 days by default (cleanupPeriodDays)."));
    return `${out.join("\n")}\n`;
  }
  const rows = sourceRows(m);
  out.push(p.bold(`${pad("Who decided", 28)}${rpad("allowed", 9)}${rpad("refused", 9)}${rpad("no verdict", 12)}${rpad("total", 8)}`));
  for (const r of rows) {
    out.push(`  ${pad(r.label, 26)}${rpad(r.allowed, 9)}${rpad(r.refused, 9)}${rpad(r.key === "classifier" ? r.noVerdict : "-", 12)}${rpad(r.total, 8)}`);
    if (r.key === "classifier") {
      out.push(p.dim(`    ${pad("Claude Code's own requests", 24)}${rpad(m.classifier.client, 3)}   ${m.classifier.server ? `the server's review ${m.classifier.server}` : ""}`.trimEnd()));
    }
  }
  const modes = Object.entries(m.modes).sort((a, b) => b[1] - a[1]);
  if (modes.length > 1 || (modes[0] && modes[0][0] !== "auto")) out.push(p.dim(`  permission modes of these decisions: ${modes.map(([k, n]) => `${k} ${n}`).join(", ")}`));
  out.push("");
  const days = m.days.slice(-14);
  out.push(p.bold(`By day${m.days.length > days.length ? ` (the last ${days.length} of ${m.days.length})` : ""}${" ".repeat(10)}decisions   classifier: allowed  refused  no verdict`));
  for (const d of days) out.push(`  ${pad(d.day, 14)}${rpad(d.total, 14)}${rpad(d.classifier.allowed, 22)}${rpad(d.classifier.refused, 9)}${rpad(d.classifier.noVerdict, 12)}`);
  out.push("");
  const sess = m.sessions.slice(0, 10);
  out.push(p.bold(`Sessions${m.sessions.length > sess.length ? ` (the latest ${sess.length} of ${m.sessions.length})` : ""}`));
  for (const s of sess) {
    const c = s.classifier;
    out.push(`  ${pad((s.id || "?").slice(0, 8), 9)}${day(s.first)} ${hm(s.first)} to ${day(s.last) === day(s.first) ? hm(s.last) : `${day(s.last)} ${hm(s.last)}`}  ${rpad(s.total, 5)} decisions  classifier ${c.allowed + c.refused + c.noVerdict} (${c.allowed} allowed, ${c.refused} refused, ${c.noVerdict} no verdict)  ${clip(s.project || "", 40)}`);
  }
  out.push("");
  if (m.refused.length) {
    const n = m.refused.reduce((a, r) => a + r.count, 0);
    const asked = m.refused.reduce((a, r) => a + (r.asked || 0), 0);
    out.push(p.bold(`Refused by the classifier: ${plural(m.refused.length, "command")}, ${plural(n, "time")} (it read them and judged them unsafe${asked ? `, except ${asked} that Claude Code asked about instead` : ""})`));
    for (const r of m.refused.slice(0, 10)) out.push(`  ${rpad(`${r.count}x`, 4)}  ${pad(refusalLabel(r), 24)} ${pad(r.tool, 5)} ${clip(r.subject, 70)}  ${p.dim(`last ${day(r.last)}${askedNote(r)}`)}`);
    if (m.refused.length > 10) out.push(p.dim(`  ... and ${m.refused.length - 10} more commands (run with --json for all)`));
    if (asked) for (const l of wrap("\"Asked instead\": from the third refusal in a row Claude Code asks you instead of showing the classifier's refusal (claude -p, with nobody to ask, refuses the call). The classifier's own answer to those is not in the transcript.", 96)) out.push(p.dim(`  ${l}`));
    out.push("");
  }
  if (m.noVerdict.length) {
    const n = m.noVerdict.reduce((a, r) => a + r.count, 0);
    out.push(p.bold(`No verdict: ${plural(n, "time")} on ${plural(m.noVerdict.length, "command")}. The check did not judge these, so they say nothing about the commands`));
    for (const r of m.noVerdict.slice(0, 10)) out.push(`  ${rpad(`${r.count}x`, 4)}  ${pad(clip(causeLabel(r), 56), 57)} ${pad(r.tool, 5)} ${clip(r.subject, 50)}  ${p.dim(`last ${day(r.last)}`)}`);
    if (m.noVerdict.length > 10) out.push(p.dim(`  ... and ${m.noVerdict.length - 10} more commands`));
    const svc = m.noVerdict.reduce((a, r) => a + r.serviceCount, 0);
    out.push(p.dim(svc === n ? "  All of them trace to the service or the connection, not to your settings." : `  ${svc} of ${n} trace to the service or the connection; the others to the conversation (a safety check, or a transcript too long for the classifier).`));
    out.push("");
  }
  for (const n of m.notes) out.push(p.dim(`Note: ${n}`));
  return `${out.join("\n").trimEnd()}\n`;
}

/** The short form the skill hands to Claude: at most `max` lines. */
export function markdownReport(m, { max = 17, width = 200 } = {}) {
  const L = [];
  L.push(`## automode-doctor report: ${m.project || "all projects"}`);
  if (!m.total) { L.push(`No tool decision in the last ${plural(m.window.days, "day")}.`); return `${L.join("\n")}\n`; }
  const c = m.classifier;
  L.push(`${plural(m.total, "tool decision")} in ${plural(m.sessions.length, "session")}, ${m.window.date ? windowWords(m.window) : `last ${plural(m.window.days, "day")}`} (UTC). Classifier: ${c.total} (${c.allowed} allowed, ${c.refused} refused, ${c.noVerdict} no verdict; ${c.client} by Claude Code's own requests, ${c.server} by the server's review).`);
  L.push(`By source: ${sourceRows(m).filter((r) => r.key !== "classifier").map((r) => `${r.label} ${r.total}`).join(", ") || "none besides the classifier"}.`);
  if (m.refused.length) {
    L.push(m.refused.some((r) => r.asked) ? `Refused by the classifier (judged unsafe; "asked instead" is the third refusal in a row, with no verdict of its own):` : `Refused by the classifier (judged unsafe):`);
    for (const r of m.refused.slice(0, 6)) L.push(clip(`- ${r.count}x ${r.category || r.asked ? `${refusalLabel(r)} ` : ""}${r.tool}: ${r.subject}${askedNote(r)}`, width));
  }
  if (m.noVerdict.length) {
    const svc = m.noVerdict.reduce((a, r) => a + r.serviceCount, 0);
    const n = m.noVerdict.reduce((a, r) => a + r.count, 0);
    L.push(`No verdict (the check did not run; ${svc === n ? "the service or the connection, not your settings" : `${svc} of ${n} the service or the connection`}):`);
    for (const r of m.noVerdict.slice(0, 5)) L.push(clip(`- ${r.count}x ${causeLabel(r)}: ${r.tool}: ${r.subject}`, width));
  }
  const worst = m.days.slice().sort((a, b) => b.classifier.refused + b.classifier.noVerdict - (a.classifier.refused + a.classifier.noVerdict))[0];
  if (worst && worst.classifier.refused + worst.classifier.noVerdict > 0) L.push(`Worst day: ${worst.day} (${worst.classifier.refused} refused, ${worst.classifier.noVerdict} no verdict).`);
  if (L.length > max) { L.length = max - 1; L.push(`- ... cut at ${max} lines (run \`claude-automode-doctor report\`)`); }
  return `${L.join("\n")}\n`;
}

// ------------------------------------------------------------------------------------------------------------
// show
// ------------------------------------------------------------------------------------------------------------

export function renderShow(m, { color = false } = {}) {
  const p = palette(color);
  const out = [];
  out.push(`${p.bold(`claude-automode-doctor ${VERSION}`)}  the autoMode and permissions settings, merged`);
  out.push(`project   ${m.project}`);
  out.push(`config    ${m.configDir}`);
  out.push("");
  out.push("Settings files, highest precedence first");
  const w = Math.max(...m.files.map((f) => f.display.length));
  for (const f of m.files) {
    const state = f.state === "not found" ? p.dim("not found") : f.state === "read" ? `read${f.autoMode ? `; autoMode at line ${f.autoMode.line}${f.autoMode.read ? "" : p.yellow(" (Claude Code does not read it from here)")}` : ""}` : f.state === "empty" ? p.dim("empty") : p.red(`${f.state}${f.detail ? `: ${f.detail}` : ""}`);
    out.push(`  ${pad(f.scope, 8)} ${pad(f.display, w)}  ${state}`);
  }
  out.push("");
  out.push(p.bold("autoMode") + p.dim("  (read from the user's and managed settings; the lists below are what the classifier is given)"));
  for (const key of ["allow", "soft_deny", "hard_deny", "environment"]) {
    const l = m.autoMode.lists[key];
    const head = !l.contributions.length ? `built-in ${plural(l.builtinCount, "rule")}` : l.effective ? (l.builtinReplaced ? p.yellow(`yours only: the built-in ${l.builtinCount} are replaced`) : `built-in ${l.builtinCount} and yours`) : "see the files below";
    out.push(`  ${pad(key, 12)} ${head}`);
    for (const c of l.contributions) {
      out.push(p.dim(`      ${c.display}:${c.line}  ${plural(c.items.length, "entry", "entries")}${c.hasDefaults ? ', with "$defaults"' : ""}${c.replaces ? ', no "$defaults"' : ""}${c.empty ? " (empty: changes nothing)" : ""}`));
      for (const i of c.items.slice(0, 12)) out.push(`      ${i.text === "$defaults" ? p.dim('"$defaults"  (the built-in rules go here)') : JSON.stringify(clip(i.text, 90))}  ${p.dim(`line ${i.line}`)}`);
      if (c.items.length > 12) out.push(p.dim(`      ... and ${c.items.length - 12} more`));
    }
  }
  const cas = m.autoMode.classifyAllShell;
  out.push(`  ${pad("classifyAllShell", 16)} ${cas ? `${cas.value} (${cas.display}:${cas.line})` : p.dim("not set (false)")}`);
  for (const c of m.autoMode.ignoredCopies) out.push(p.yellow(`  ignored: ${c.display}:${c.line} has an autoMode block (${c.keys.join(", ") || "empty"}); Claude Code reads autoMode from user and managed settings only`));
  for (const n of m.autoMode.notes) out.push(p.dim(`  ${n}`));
  out.push("");
  out.push(p.bold("permissions"));
  const pm = m.permissions;
  const one = (label, v) => out.push(`  ${pad(label, 38)} ${v ? `${JSON.stringify(v.value)}  ${p.dim(`${v.display}:${v.line}`)}${v.shadowed.length ? p.yellow(`  (shadows ${v.shadowed.map((s) => `${JSON.stringify(s.value)} in ${s.display}`).join(", ")})`) : ""}` : p.dim("not set")}`);
  one("defaultMode", pm.defaultMode);
  one("disableAutoMode", pm.disableAutoMode);
  one("blockReadsOutsideWorkingDirectories", pm.blockReads);
  if (pm.additionalDirectories.length) out.push(`  additionalDirectories: ${pm.additionalDirectories.map((d) => d.value).join(", ")}`);
  for (const behavior of ["deny", "ask", "allow"]) {
    const list = pm.rules[behavior];
    out.push(`  ${pad(behavior, 6)} ${plural(list.length, "rule")}`);
    for (const r of list.slice(0, 40)) out.push(`      ${pad(clip(r.raw, 52), 52)}  ${r.display}:${r.line}${r.also.length ? p.dim(` (also ${r.also.map((a) => a.display).join(", ")})`) : ""}${r.droppedInAutoMode ? p.yellow("  dropped when auto mode starts") : ""}`);
    if (list.length > 40) out.push(p.dim(`      ... and ${list.length - 40} more`));
  }
  out.push("");
  out.push("Not read by this tool:");
  for (const n of m.notRead) out.push(`  - ${n}`);
  return `${out.join("\n")}\n`;
}

// ------------------------------------------------------------------------------------------------------------
// lint
// ------------------------------------------------------------------------------------------------------------

const TONE = { error: "red", warning: "yellow", note: "dim" };

export function renderLint(m, { color = false } = {}) {
  const p = palette(color);
  const out = [];
  out.push(`${p.bold(`claude-automode-doctor ${VERSION}`)}  lint`);
  out.push(`project   ${m.project}`);
  out.push(`config    ${m.configDir}`);
  out.push("");
  const byFile = new Map();
  for (const f of m.findings) {
    const k = f.display || "(not in a settings file)";
    if (!byFile.has(k)) byFile.set(k, []);
    byFile.get(k).push(f);
  }
  if (!m.findings.length) out.push(p.green("No findings."));
  for (const [file, list] of byFile) {
    out.push(`${p.bold(file)}`);
    for (const f of list) {
      out.push(`  ${p[TONE[f.severity]](pad(f.severity, 8))}${pad(f.id, 25)}${f.line ? `line ${f.line}  ` : ""}${f.keyPath || ""}${f.issue ? p.dim(`  (issue #${f.issue})`) : ""}`);
      for (const l of wrap(f.message, 94)) out.push(`      ${l}`);
      if (f.fix) for (const [i, l] of wrap(`fix: ${f.fix}`, 94).entries()) out.push(`      ${i === 0 ? p.dim(l) : p.dim(l)}`);
    }
    out.push("");
  }
  out.push(`${plural(m.counts.error, "error")}, ${plural(m.counts.warning, "warning")}, ${plural(m.counts.note, "note")} in ${plural(m.files.filter((f) => f.exists).length, "settings file")}`);
  return `${out.join("\n")}\n`;
}

/** The short form the skill hands to Claude. It always exits 0 (a skill whose command fails never reaches the model). */
export function markdownLint(m, { max = 12, width = 300 } = {}) {
  const L = [`## automode-doctor lint: ${m.project}`];
  const shown = m.findings.filter((f) => f.severity !== "note");
  L.push(`${plural(m.files.filter((f) => f.exists).length, "settings file")} read, ${plural(m.counts.error, "error")}, ${plural(m.counts.warning, "warning")}, ${plural(m.counts.note, "note")}.`);
  if (!shown.length) L.push("No findings.");
  for (const f of shown.slice(0, max)) {
    const at = f.display ? ` ${f.display}${f.line ? `:${f.line}` : ""}` : "";
    const line = `- ${f.severity.toUpperCase()} ${BT}${f.id}${BT}${at}: ${f.message}${f.fix ? ` Fix: ${f.fix}` : ""}`;
    L.push(line.length > width ? `${line.slice(0, width - 3)}...` : line);
  }
  if (shown.length > max) L.push(`- ... and ${shown.length - max} more (run ${BT}claude-automode-doctor lint${BT})`);
  return `${L.join("\n")}\n`;
}

// ------------------------------------------------------------------------------------------------------------
// why
// ------------------------------------------------------------------------------------------------------------

const OUTCOME_TEXT = {
  classifier: "Goes to the classifier.",
  static: "Approved without the classifier.",
  prompt: "Asks you; the classifier is not asked. In claude -p, which cannot ask, it is refused.",
  refused: "Refused by a deny rule, before the classifier.",
};

export function renderWhy(m, { color = false } = {}) {
  const p = palette(color);
  const out = [];
  out.push(`${p.bold(`claude-automode-doctor ${VERSION}`)}  why`);
  out.push(`command   ${m.command}`);
  out.push(`tool      ${m.tool}   in ${m.cwd}`);
  out.push("");
  out.push(p.bold(OUTCOME_TEXT[m.outcome] || m.outcome));
  for (const l of wrap(m.summary, 96)) out.push(`  ${l}`);
  if (m.rule) out.push(`  rule: ${m.rule.raw}  (${m.rule.display || m.rule.label}${m.rule.line ? `:${m.rule.line}` : ""})`);
  if (m.parts.length > 1) {
    out.push("");
    out.push("Parts");
    for (const part of m.parts) out.push(`  ${pad(part.status || "?", 10)} ${clip(part.text, 80)}${part.rule ? p.dim(`   ${part.rule.raw}`) : ""}`);
  }
  for (const d of m.dropped) out.push(p.yellow(`  ${d.raw} matched, and auto mode drops it${d.why === "classifyAllShell" ? " because classifyAllShell is on" : " (a rule this broad would let anything run)"}`));
  if (m.outcome === "classifier" && m.suggestion) out.push(`  A rule that would skip the classifier for it: ${m.suggestion}`);
  for (const n of m.notes) out.push(p.dim(`  ${n}`));
  return `${out.join("\n")}\n`;
}

// ------------------------------------------------------------------------------------------------------------
// cost
// ------------------------------------------------------------------------------------------------------------

export function renderCost(m, { color = false } = {}) {
  const p = palette(color);
  const out = [];
  out.push(`${p.bold(`claude-automode-doctor ${VERSION}`)}  what classification costs`);
  out.push(`measured  on Claude Code ${m.measured.version}, ${m.measured.platform}, ${m.measured.date}, against a fake API (zero tokens)`);
  out.push("");
  out.push(p.bold("One classified command"));
  for (const s of m.stages) out.push(`  stage ${s.stage}   ${pad(s.model, 16)} max_tokens ${rpad(num(s.maxTokens), 6)}   system prompt ${num(s.systemChars)} characters (about ${num(s.systemTokens)} tokens), whole request about ${num(s.requestTokens)} tokens`);
  for (const l of wrap(m.perCommand.note, 96)) out.push(`  ${l}`);
  out.push(`  So a command costs ${m.perCommand.requestsLow} to ${m.perCommand.requestsHigh} requests, about ${num(m.perCommand.tokensLow)} to ${num(m.perCommand.tokensHigh)} input tokens by characters / 4 (an estimate, not the tokenizer's count). ${m.prompt.cached}.`);
  out.push("");
  out.push(p.bold("Who pays") + p.dim("  (the documentation; this tool cannot see an invoice)"));
  for (const s of m.billing.says) for (const [i, l] of wrap(s, 94).entries()) out.push(`  ${i === 0 ? "- " : "  "}${l}`);
  out.push(`  ${m.billing.url}`);
  if (m.transcripts) {
    const t = m.transcripts;
    out.push("");
    out.push(p.bold(`In your transcripts (${windowWords(t.window)})`));
    out.push(`  ${plural(t.classified, "classifier decision")}: ${t.client} by Claude Code's own requests, ${t.server} by the server's review`);
    if (t.client) out.push(`  the ${t.client} sent ${num(t.requestsLow)} to ${num(t.requestsHigh)} requests: about ${num(t.tokensLow)} to ${num(t.tokensHigh)} input tokens if none were cached or free`);
    else out.push("  none of them used Claude Code's own requests, so there were no separate classifier requests to count");
  }
  return `${out.join("\n")}\n`;
}

// ------------------------------------------------------------------------------------------------------------
// suggest, writes
// ------------------------------------------------------------------------------------------------------------

export function renderSuggest(m, { color = false } = {}) {
  const p = palette(color);
  const out = [];
  out.push(`${p.bold(`claude-automode-doctor ${VERSION}`)}  suggest`);
  out.push(`window    ${windowWords(m.window)}; commands the classifier turned back at least ${m.min} times`);
  out.push("");
  if (!m.proposals.length) out.push("No rule to propose: nothing was turned back that often, or no rule would help.");
  for (const g of m.proposals) {
    out.push(`${p.bold(g.rule)}   ${g.count}x`);
    const said = [];
    if (g.judged) said.push(`the classifier judged it unsafe ${g.judged}x${g.categories.length ? ` (${g.categories.map((c) => `[${c}]`).join(", ")})` : ""}: with this rule it runs unchecked`);
    if (g.asked) said.push(`${g.asked}x Claude Code asked instead, after three refusals in a row${g.judged ? "" : ": with this rule it runs unchecked"}`);
    if (g.noVerdict) said.push(`${g.noVerdict}x the check gave no verdict (${g.causes.map((c) => NO_VERDICT_CAUSES[c] || c).join(", ")})`);
    out.push(`    ${said.join("; ")}`);
    if (g.risk) out.push(p.yellow(`    the rule ${g.risk}`));
    for (const e of g.examples) out.push(p.dim(`    e.g. ${clip(e, 90)}`));
  }
  if (m.skipped.length) {
    out.push("");
    out.push(p.bold("No rule helps these"));
    for (const s of m.skipped.slice(0, 8)) out.push(`  ${rpad(`${s.count}x`, 4)}  ${clip(s.subject, 60)}   ${p.dim(clip(s.reason, 90))}`);
  }
  if (m.write) {
    out.push("");
    out.push(renderWrite(m.write, { color }).trimEnd());
  } else if (m.proposals.length) {
    out.push("");
    out.push(p.dim(`To add them: claude-automode-doctor suggest --write --user   (--dry-run first shows the change; ${m.proposals.some((g) => g.judged || g.asked) ? "--include-judged also adds the ones the classifier judged unsafe or Claude Code asked about instead" : "nothing here was judged unsafe"})`));
  }
  return `${out.join("\n")}\n`;
}

export function renderWrite(r, { color = false } = {}) {
  const p = palette(color);
  const out = [];
  const tag = r.dryRun ? "(dry run) " : "";
  if (r.restored !== undefined) {
    if (r.restored) {
      out.push(`Restored ${r.display || r.path} from ${r.fromDisplay || r.from}.`);
      if (r.savedCurrent) out.push(`The file as it was is saved as ${r.savedCurrentDisplay || r.savedCurrent}; run restore again to switch back.`);
    } else if (r.dryRun) out.push(`${tag}Would restore ${r.display || r.path} from ${r.fromDisplay || r.from}.`);
    else out.push(p.red(`Nothing restored: ${r.reason}`));
    return `${out.join("\n")}\n`;
  }
  if (r.skipped) { out.push(p.red(`${r.display || r.path}: ${r.skipped}.`)); return `${out.join("\n")}\n`; }
  if (!r.added.length) out.push(`${tag}${r.display || r.path}: nothing to add${r.already.length ? ` (${plural(r.already.length, "rule")} already there)` : ""}.`);
  else {
    out.push(`${tag}${r.dryRun ? "Would add" : "Added"} ${plural(r.added.length, "allow rule")} to ${r.display || r.path}:`);
    for (const a of r.added) out.push(`  + ${a}`);
    if (r.backup) out.push(`The old file is saved as ${r.backupDisplay || r.backup}. Undo with: claude-automode-doctor restore --${r.scope}`);
    if (r.dryRun) out.push("Nothing was written (--dry-run).");
  }
  return `${out.join("\n")}\n`;
}

/** A model as JSON: sets and functions are dropped, undefined fields vanish. */
export function strip(model) { return JSON.parse(JSON.stringify(model, (k, v) => (v instanceof Set ? [...v] : v))); }
