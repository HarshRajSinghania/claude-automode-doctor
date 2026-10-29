// The command line: parse the arguments, run one command, print, return the exit code.
// Exit codes: 0 ok; 1 findings, or a refusal (a command that would be refused or asked about, a restore with nothing to
// restore); 2 a usage error, or something that went wrong that the tool did not expect.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { buildCostModel, buildLintModel, buildReportModel, buildShowModel, buildSuggestModel, buildWhyModel, runRestore } from "./commands.mjs";
import { markdownLint, markdownReport, palette, renderCost, renderLint, renderReport, renderShow, renderSuggest, renderWhy, renderWrite, strip } from "./render.mjs";
import { VERSION } from "./version.mjs";

const HELP = `claude-automode-doctor ${VERSION}
What Claude Code's auto mode and its classifier decided, from your transcripts.

Usage: claude-automode-doctor <command> [options]

Read (they change nothing):
  report   [--project <dir>] [--since <days|YYYY-MM-DD>] [--session <id>] [--markdown]
           every tool decision in the transcripts, with who made it: static approval, the permission
           mode, a permission rule, the classifier (allowed, refused, or no verdict), a hook, you.
           Counts per day and per session, the commands the classifier refused, and the refusals
           that were no verdict (the check did not run: the service, not your settings). All
           projects, or one with --project; the last 30 days, or --since: a number of days, or a
           date, from the start of that day in UTC. Exit 1 when the classifier refused or gave no
           verdict in that window. --markdown is the short report the /automode-doctor:check skill
           hands to Claude (at most 17 lines); it always exits 0
  why      "<command>"... [--project <dir>] [--tool Bash|PowerShell] [--file <path>]
           whether the command goes to the classifier in auto mode, or is approved without it (read-only,
           an allow rule, a file command the mode approves), or is refused by a deny rule or asked about
           (an ask rule, a critical path, the read block); which rule, from which file. --file reads
           commands from a text file, one per line (blank lines and # comments skipped). Exit 1 when it
           would be refused or asked about
  show     [--project <dir>]
           the merged autoMode and permissions settings with the file and line of each part, which
           file wins, the allow rules auto mode drops, and an autoMode block Claude Code does not read
  lint     [--project <dir>] [--markdown]
           traps in those settings: an autoMode list without "$defaults" (it replaces the built-in
           rules), a wrong type (Claude Code ignores the whole file), an autoMode block in a project
           file (not read), classifyAllShell, permissions.disableAutoMode, and three known bad
           interactions (#95238, #91650, #88565). Exit 1 on an error or a warning. --markdown is the
           short form for the skill; it always exits 0
  cost     [--project <dir>] [--since <days|YYYY-MM-DD>]
           what a classified command costs by the request sizes measured on the binary, who is billed,
           and how many commands your transcripts show were classified

Change settings (a settings file is saved next to itself first; --dry-run shows the change):
  suggest  [--project <dir>] [--since <days|YYYY-MM-DD>] [--min <n>]
           [--write (--user | --local | --project <dir>)] [--include-judged] [--dry-run]
           allow rules for commands the classifier turned back at least <n> times (default 2), each
           checked: it is not a broad rule auto mode drops, and with it the command skips the
           classifier. --write adds the ones the check never judged; --include-judged also adds those
           the classifier called unsafe, or Claude Code asked about instead (the third refusal in a row)
  restore  (--user | --local | --project <dir>) [--dry-run]
           put the newest backup back; the file as it was is saved first, so restore can be undone

--since is a number of days (--since 7) or a date (--since 2026-10-01: from the start of that day, in
UTC); report, cost and suggest take it the same way. A date in the future, or one that is not a date,
is a usage error.

Files: --user is <config folder>/settings.json (CLAUDE_CONFIG_DIR, else ~/.claude); --project <dir>
is <dir>/.claude/settings.json; --local is <dir>/.claude/settings.local.json. <dir> is the folder
--project names, else the folder you are in.

Options for every command:
  --json         one JSON document on stdout
  --no-color     no colour on a terminal (NO_COLOR does the same)
  -h, --help     this text
  -v, --version  the version

Exit codes: 0 ok; 1 findings or a refusal; 2 a usage error or an unexpected error.
Environment: CLAUDE_CONFIG_DIR (Claude's config folder), NO_COLOR, and
CLAUDE_AUTOMODE_DOCTOR_MANAGED_DIR (the folder to read managed-settings.json from, instead of the
system folder; the tests use it).
It reads transcripts and settings files, writes only with suggest --write and restore (a settings file
is saved next to itself first), and never uses the network.
`;

class UsageError extends Error {}

const COMMANDS = new Set(["report", "why", "show", "lint", "cost", "suggest", "restore"]);
const FLAGS_WITH_VALUE = new Set(["--project", "--since", "--session", "--min", "--tool", "--file"]);
const FLAGS = new Set([...FLAGS_WITH_VALUE, "--user", "--local", "--write", "--dry-run", "--include-judged", "--json", "--markdown", "--no-color", "-h", "--help", "-v", "--version"]);

const SINCE_USAGE = "--since needs a number of days, such as --since 7, or a date, such as --since 2026-10-01";
const SINCE_DAYS_USAGE = "--since needs a number of days, 1 or more, such as --since 7";
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** What --since names, if it is a day: the YYYY-MM-DD of a real day in UTC, else null (2026-13-40 is not one). */
function asDay(value) {
  if (!DAY_RE.test(value)) return null;
  const t = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== value ? null : value;
}

/** Parse argv into { command, positional, project, since, session, min, tool, user, local, write, dryRun, ... }. */
export function parseArgs(argv) {
  const o = { command: null, positional: [], project: null, since: null, session: null, min: null, tool: null, file: null, user: false, local: false, write: false, dryRun: false, includeJudged: false, json: false, markdown: false, help: false, version: false, noColor: false };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    let inline = null;
    if (a.startsWith("--") && a.includes("=")) { inline = a.slice(a.indexOf("=") + 1); a = a.slice(0, a.indexOf("=")); }
    if (a.startsWith("-") && a !== "-") {
      if (!FLAGS.has(a)) throw new UsageError(`unknown option ${a}`);
      let value = null;
      if (FLAGS_WITH_VALUE.has(a)) {
        value = inline !== null ? inline : argv[++i];
        if (value === undefined || (inline === null && value.startsWith("-") && value.length > 1)) {
          throw new UsageError(a === "--project" ? "--project needs a folder (use --project . for the current folder)" : `${a} needs a value`);
        }
      } else if (inline !== null) throw new UsageError(`${a} does not take a value`);
      switch (a) {
        case "--project": o.project = value; break;
        case "--since": {
          // a date stays a date until the window is built; a number of days is a number, as it always was
          const day = asDay(value);
          if (day !== null) o.since = day;
          else if (!/^\d+$/.test(value)) throw new UsageError(SINCE_USAGE);
          else if (Number(value) < 1 || Number(value) > 36500) throw new UsageError(SINCE_DAYS_USAGE);
          else o.since = Number(value);
          break;
        }
        case "--session": if (!/^[0-9a-fA-F-]{4,}$/.test(value)) throw new UsageError("--session needs a session id, or the start of one (4 or more characters of 0-9 and a-f)"); o.session = value.toLowerCase(); break;
        case "--min":
          if (!/^\d+$/.test(value) || Number(value) < 1) throw new UsageError("--min needs a number, 1 or more, such as --min 3");
          o.min = Number(value);
          break;
        case "--tool": if (value !== "Bash" && value !== "PowerShell") throw new UsageError("--tool is Bash or PowerShell"); o.tool = value; break;
        case "--file":
          if (o.file !== null) throw new UsageError("--file given twice");
          o.file = value;
          break;
        case "--user": o.user = true; break;
        case "--local": o.local = true; break;
        case "--write": o.write = true; break;
        case "--dry-run": o.dryRun = true; break;
        case "--include-judged": o.includeJudged = true; break;
        case "--json": o.json = true; break;
        case "--markdown": o.markdown = true; break;
        case "--no-color": o.noColor = true; break;
        case "-h": case "--help": o.help = true; break;
        case "-v": case "--version": o.version = true; break;
        default:
      }
      continue;
    }
    if (o.command === null && COMMANDS.has(a)) o.command = a;
    else o.positional.push(a);
  }
  if (o.json && o.markdown) throw new UsageError("--json and --markdown cannot be combined");
  return o;
}

/**
 * Run the tool. `io` lets tests capture output and fake the machine:
 * { stdout, stderr, env, cwd, home, platform, managed, now }.
 */
export async function main(argv, io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  const env = io.env || process.env;
  const home = io.home || os.homedir();
  const cwd = io.cwd || process.cwd();
  const platform = io.platform || process.platform;
  const wantsJson = argv.includes("--json");

  const fail = (message, code) => {
    if (wantsJson) stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    else stderr.write(`claude-automode-doctor: ${message}${code === 2 ? "\nTry: claude-automode-doctor --help" : ""}\n`);
    return code;
  };

  let o;
  try {
    o = parseArgs(argv);
    if (!o.help && !o.version && o.command === null) throw new UsageError(o.positional.length ? `unknown command ${o.positional[0]}` : "a command is needed");
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    return fail(e.message, 2);
  }
  if (o.help) { stdout.write(HELP); return 0; }
  if (o.version) { stdout.write(`${VERSION}\n`); return 0; }

  const color = !!stdout.isTTY && !env.NO_COLOR && !o.noColor;
  const common = { env, home, platform, managed: io.managed, now: io.now, cwd };
  const emit = (model, text) => stdout.write(o.json ? `${JSON.stringify(strip(model), null, 2)}\n` : text);

  try {
    const allowed = {
      report: ["--since", "--session", "--markdown"], why: ["--tool", "--file"], show: [], lint: ["--markdown"], cost: ["--since"],
      suggest: ["--since", "--min", "--write", "--user", "--local", "--include-judged", "--dry-run"], restore: ["--user", "--local", "--dry-run"],
    }[o.command];
    for (const [flag, on] of [["--since", o.since !== null], ["--session", o.session !== null], ["--min", o.min !== null], ["--tool", o.tool !== null], ["--file", o.file !== null], ["--user", o.user], ["--local", o.local], ["--write", o.write], ["--dry-run", o.dryRun], ["--include-judged", o.includeJudged], ["--markdown", o.markdown]]) {
      if (on && !allowed.includes(flag)) throw new UsageError(`${flag} does not belong to ${o.command}`);
    }
    // a date only makes a window if it has already begun; the clock is io.now in tests
    if (typeof o.since === "string" && o.since > new Date(io.now ?? Date.now()).toISOString().slice(0, 10)) throw new UsageError(SINCE_USAGE);
    const projectDir = o.project !== null ? path.resolve(cwd, o.project) : path.resolve(cwd);

    switch (o.command) {
      case "report": {
        if (o.positional.length) throw new UsageError(`report takes no arguments (got "${o.positional[0]}")`);
        const m = buildReportModel({ ...common, project: o.project !== null ? projectDir : null, days: o.since || 30, session: o.session });
        if (o.json) stdout.write(`${JSON.stringify(strip(m), null, 2)}\n`);
        else if (o.markdown) stdout.write(markdownReport(m));
        else stdout.write(renderReport(m, { color }));
        // the skill runs --markdown, and Claude Code drops a skill whose command fails, so it reports and exits 0
        if (o.markdown) return 0;
        return m.classifier.refused + m.classifier.noVerdict > 0 ? 1 : 0;
      }
      case "why": {
        let commands = [];
        if (o.file !== null) {
          try {
            const content = fs.readFileSync(path.resolve(cwd, o.file), "utf8");
            const lines = content.split(/\r?\n/);
            for (let line of lines) {
              line = line.trim();
              if (line === "" || line.startsWith("#")) continue;
              commands.push(line);
            }
          } catch (e) {
            throw new UsageError(`--file: cannot read ${o.file} (${e.message})`);
          }
          if (commands.length === 0 && o.positional.length === 0) throw new UsageError(`--file: no command in ${o.file}`);
        }
        commands = commands.concat(o.positional);
        if (commands.length === 0) throw new UsageError('why needs the command in quotes, as in: why "git push origin main"');
        const models = commands.map((command) =>
          buildWhyModel({ ...common, project: projectDir, command, tool: o.tool || "Bash" })
        );
        if (models.length === 1) {
          emit(models[0], renderWhy(models[0], { color }));
        } else {
          emit({ ok: true, commands: models }, renderWhy(models, { color }));
        }
        return models.some((m) => m.outcome === "refused" || m.outcome === "prompt") ? 1 : 0;
      }
      case "show": {
        if (o.positional.length) throw new UsageError(`show takes no arguments (got "${o.positional[0]}")`);
        const m = buildShowModel({ ...common, project: projectDir });
        emit(m, renderShow(m, { color }));
        return 0;
      }
      case "lint": {
        if (o.positional.length) throw new UsageError(`lint takes no arguments (got "${o.positional[0]}")`);
        const m = buildLintModel({ ...common, project: projectDir });
        if (o.json) stdout.write(`${JSON.stringify(strip(m), null, 2)}\n`);
        else if (o.markdown) stdout.write(markdownLint(m));
        else stdout.write(renderLint(m, { color }));
        if (o.markdown) return 0;
        return m.counts.error + m.counts.warning > 0 ? 1 : 0;
      }
      case "cost": {
        if (o.positional.length) throw new UsageError(`cost takes no arguments (got "${o.positional[0]}")`);
        const m = buildCostModel({ ...common, project: o.project !== null ? projectDir : null, days: o.since || 30 });
        emit(m, renderCost(m, { color }));
        return 0;
      }
      case "suggest": {
        if (o.positional.length) throw new UsageError(`suggest takes no arguments (got "${o.positional[0]}")`);
        if ((o.dryRun || o.includeJudged) && !o.write) throw new UsageError(`${o.dryRun ? "--dry-run" : "--include-judged"} belongs to --write`);
        if (o.write && !o.user && !o.local && o.project === null) throw new UsageError("suggest --write needs the settings file: --user, --local or --project <dir>");
        if (o.user && o.local) throw new UsageError("choose one settings file: --user or --local, not both");
        const m = buildSuggestModel({ ...common, project: projectDir, targetProject: o.project !== null ? o.project : null, days: o.since || 30, min: o.min || 2, write: o.write, user: o.user, local: o.local, dryRun: o.dryRun, includeJudged: o.includeJudged });
        emit(m, renderSuggest(m, { color }));
        return m.ok ? 0 : 1;
      }
      case "restore": {
        if (o.positional.length) throw new UsageError("restore takes no arguments; name the file with --user, --local or --project <dir>");
        if (o.user && o.local) throw new UsageError("choose one settings file: --user or --local, not both");
        if (!o.user && !o.local && o.project === null) throw new UsageError("restore needs the settings file: --user, --local or --project <dir>");
        const r = runRestore({ ...common, user: o.user, local: o.local, project: o.project, dryRun: o.dryRun });
        emit(r, renderWrite(r, { color }));
        return r.ok ? 0 : 1;
      }
      default:
        throw new UsageError(`unknown command ${o.command}`);
    }
  } catch (e) {
    if (e instanceof UsageError) return fail(e.message, 2);
    return fail(e && e.message ? e.message : String(e), 2);
  }
}
