# claude-automode-doctor

[![test](https://github.com/nrzz/claude-automode-doctor/actions/workflows/test.yml/badge.svg)](https://github.com/nrzz/claude-automode-doctor/actions/workflows/test.yml) [![e2e](https://github.com/nrzz/claude-automode-doctor/actions/workflows/e2e.yml/badge.svg)](https://github.com/nrzz/claude-automode-doctor/actions/workflows/e2e.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) ![node >= 18](https://img.shields.io/badge/node-%3E%3D18-339933.svg) ![dependencies: none](https://img.shields.io/badge/dependencies-none-brightgreen.svg) [![part of the Claude Code toolkit](https://img.shields.io/badge/Claude%20Code-toolkit-d97757.svg)](https://github.com/nrzz/claude-code-toolkit)

Auto mode is the permission mode `claude -p` starts in (seen on 2.1.299). A model, the classifier, decides which commands run, and nothing shows you what it decided. On 16 October 2026 there were 303 open issues with "auto mode" in the title and 245 with "classifier". The most-reacted new one of the last 30 days, [#97854](https://github.com/anthropics/claude-code/issues/97854) (41 reactions), is the classifier giving no verdict, which blocks Bash entirely. [#87971](https://github.com/anthropics/claude-code/issues/87971) (98 reactions) says auto mode's instruction to work through Bash makes Claude edit with `sed` and heredocs, and [#89922](https://github.com/anthropics/claude-code/issues/89922) says "Blocked by classifier" comes with no reason. The `autoMode` block of the settings replaces the built-in rules completely unless it holds the literal `"$defaults"`, and nothing warns you.

claude-automode-doctor reads the decisions Claude Code records in its transcripts and says who made each one, what the classifier refused (with the rule it named), and which refusals were no verdict at all: the check did not run, so it is the service or the connection and not your settings. It says why a command goes to the classifier or not, lints the `autoMode` and permission settings for the traps, writes allow rules for the commands the classifier keeps turning back, and measures what a classification costs. It is a plain Node program that runs outside Claude, so it costs no tokens.

## What you get

- `report`: every tool decision in your transcripts with its source: static approval, the permission mode, a permission rule, the classifier (allowed, refused, or no verdict), a hook, a built-in safety check, or you. Counts per source, per day and per session; the commands the classifier refused, with the rule it named; the refusals that were no verdict, with the cause; and the calls where Claude Code asked instead of letting the classifier refuse a third time in a row.
- `why "<command>"`: whether the command goes to the classifier in auto mode, or is approved without it (read-only, an allow rule, a file command the mode approves), or is refused or asked about by a deny rule, an ask rule or a built-in check. It names the rule and the file, and for a command that goes to the classifier it proposes an allow rule that would skip it. It was held to the real binary on a table of 612 commands.
- `show`: the `autoMode` and permission settings as Claude Code merges them, with the file and line of each part, the allow rules auto mode drops when it starts, and an `autoMode` block that Claude Code does not read from the file it is in.
- `lint` finds:
  - an `autoMode` list without `"$defaults"` (it replaces the built-in rules, with what that took out of the classifier's prompt in characters);
  - a value of the wrong type in the block or in `permissions.disableAutoMode` and `permissions.blockReadsOutsideWorkingDirectories` (Claude Code ignores the whole file), and a comment or a trailing comma (the same);
  - an `autoMode` block in a project or local file (not read), and a key of the block that does not exist, with the near name;
  - `autoMode.classifyAllShell`, `permissions.disableAutoMode`, and allow rules that auto mode drops;
  - three known bad interactions, each with what it rests on: the Bash-first instruction with `permissions.blockReadsOutsideWorkingDirectories` ([#95238](https://github.com/anthropics/claude-code/issues/95238)), Read deny rules with `cd` compounds ([#91650](https://github.com/anthropics/claude-code/issues/91650)), and path-scoped rule files that a Bash edit does not load ([#88565](https://github.com/anthropics/claude-code/issues/88565)).
- `cost`: what a classified command costs by the request sizes measured on the binary, who is billed according to the documentation, and how many commands your transcripts show were classified.
- `suggest`, `restore`: allow rules for commands the classifier turned back at least twice, each checked to be a rule auto mode keeps and to make the command skip the classifier. `suggest --write` adds them to a settings file you name after saving it next to itself; `restore` puts the backup back.
- `/automode-doctor:check`, a plugin skill that hands Claude the short form of the `report` for the current project (`report --markdown`).

## What it costs in tokens

| Part | Tokens | |
| --- | --- | --- |
| The tool: every command, `--json`, `--markdown` | 0 | It reads transcripts and settings files. It never calls Claude, opens no network connection and starts no process |
| The skill in the model's request | 0 | `/automode-doctor:check` is user-only (`disable-model-invocation: true`) and its description is `Check auto mode decisions.`: 26 characters, about 7 tokens by characters / 4. With the plugin loaded, the request for a plain prompt had the same size as without it, the same tool list and no occurrence of `automode-doctor`. The sizes were 69,122 characters on Claude Code 2.1.295 and 69,652 on 2.1.299 on Windows, 64,688 on 2.1.301 on Linux and 65,667 on macOS (checked against a fake API, see below). `claude plugin details` still projects about 12 tokens "always-on" for the skill. The capture does not bear that out |
| `/automode-doctor:check` | about 280 tokens once; about 784 at the cap | The model receives the report for the project and a 252-character instruction that asks for a reply of at most 10 lines. For a project with 7 decisions, 3 of them refused and 1 with no verdict, on Windows that was 1,009 characters in the skill block and 109 in the command block: 1,118 in all, about 280 tokens by characters / 4. The skill block holds the project's path (59 characters here) and the plugin's, so it was 1,009 characters on Linux and 1,062 on macOS in CI. The report is at most 17 lines (6 refused commands, 5 without a verdict) of at most 200 characters. A report at that cap, with long commands, was 3,026 characters in the skill block and 109 in the command block, 3,135 in all, about 784 tokens. These are characters divided by 4, an estimate, not a count by Claude's tokenizer. The same report in a terminal costs nothing: `claude-automode-doctor report` |

What auto mode itself costs is a different matter and `cost` shows it: each command that reaches the classifier sends one or two requests of about 35,000 tokens each (a 140,489-character system prompt), see [`cost`](#cost).

For a report with decisions, a date window replaces `last N days` with `since YYYY-MM-DD` on the same line: at most 6 extra characters (about 2 tokens by characters / 4). Numeric windows and the 17-line cap are unchanged.

## Install

**From a terminal**, with Node 18 or newer. There is nothing to install and no dependency:

```bash
npx -y github:nrzz/claude-automode-doctor report
```

```bash
npx -y github:nrzz/claude-automode-doctor lint --project .
```

Or from a clone:

```bash
git clone https://github.com/nrzz/claude-automode-doctor
node claude-automode-doctor/bin/claude-automode-doctor.mjs report --project .
```

**As a Claude Code plugin**, in Claude Code:

```text
/plugin marketplace add nrzz/claude-code-toolkit
/plugin install automode-doctor@claude-code-toolkit
```

Then type `/automode-doctor:check`. It runs `report --markdown` for the current project and asks Claude to answer in at most 10 lines: what the classifier refused, which refusals were no verdict, and the one next step. It also asks Claude to edit nothing until you agree. To try the plugin from a clone before it is in the marketplace: `claude --plugin-dir ./claude-automode-doctor`.

## Use

The examples are real runs in a throwaway folder on Windows 11 with Claude Code 2.1.299, against a fake API on 127.0.0.1 (no model was reached and no token spent). Four `claude -p` sessions in auto mode left the transcripts the commands read. The fake API played the classifier: it refused what held `git push --force` or `curl ... | sh`, allowed the rest, and in two sessions failed on `./scripts/release.sh --publish` (once with a second stage that did not answer, once with a classifier model that answered "overloaded"). The paths are shortened to `/home/me/shop` and `/home/me/.claude`, and the managed file is shown at its Linux place. The folder has a user file and a project file:

```json
{
  "autoMode": {
    "soft_deny": ["Never deploy to production from this machine"],
    "environment": ["$defaults", "The trusted repository is github.com/acme/shop"]
  },
  "permissions": { "allow": ["Bash(make build)", "Bash(python *)"] }
}
```

```json
{
  "autoMode": { "allow": ["Running the test suite is fine"] },
  "permissions": { "deny": ["Read(./.env)"], "allow": ["Bash(git status)"] }
}
```

The first is `~/.claude/settings.json`, the second `.claude/settings.json` in the project. The sessions ran `git status`, a `Write`, `make build`, `./scripts/release.sh --publish`, `git push --force origin main` and a `curl | sh`. Nothing that ran could do harm: `make` and the script do not exist there.

```text
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
```

Every command takes `--json` (one JSON document on stdout, see the end of this section) and `--no-color` (or set `NO_COLOR`); colour is used only on a terminal. The exit codes are 0 for ok, 1 for findings or a refusal, and 2 for a usage error. The options a command does not take are refused by name.

### `report`

`report [--project <dir>] [--since <days|YYYY-MM-DD>] [--session <id>] [--markdown]` reads the transcripts under the config folder (`projects/<project>/<session>.jsonl` and the subagent transcripts below them): every project, or the one `--project` names, for the last 30 days or `--since`. For each tool call it reads who decided and what came out, and counts that per source, per day (UTC) and per session. It lists the commands the classifier refused with the rule it named, and the refusals that were no verdict with the cause. It exits 1 when the classifier refused something or gave no verdict in the window, so it can serve as a check.

`--since` takes a number of days (`--since 7`) or a date (`--since 2026-10-01`, from the start of that day in UTC), so after an incident the window can be named by the day it happened instead of counted back from today, and the window line says what was asked for. `cost` and `suggest` take it the same way.

```text
claude-automode-doctor report --project /home/me/shop
```

```text
claude-automode-doctor 1.2.0  what auto mode decided
config    /home/me/.claude  (from CLAUDE_CONFIG_DIR)
project   /home/me/shop
window    the last 30 days (to 2026-10-16, days are UTC dates); 4 transcripts; 9 tool decisions

Who decided                   allowed  refused  no verdict   total
  permission mode                   1        0           -       1
  permission rule                   2        0           -       2
  classifier                        1        3           2       6
    Claude Code's own requests  6

By day          decisions   classifier: allowed  refused  no verdict
  2026-10-16                 9                     1        3           2

Sessions
  ba5a5f65 2026-10-16 16:53 to 16:53      1 decisions  classifier 1 (0 allowed, 0 refused, 1 no verdict)  /home/me/shop
  ef99b951 2026-10-16 16:53 to 16:53      1 decisions  classifier 1 (0 allowed, 0 refused, 1 no verdict)  /home/me/shop
  78cecc8e 2026-10-16 16:53 to 16:53      2 decisions  classifier 2 (0 allowed, 2 refused, 0 no verdict)  /home/me/shop
  100de338 2026-10-16 16:53 to 16:53      5 decisions  classifier 2 (1 allowed, 1 refused, 0 no verdict)  /home/me/shop

Refused by the classifier: 2 commands, 3 times (it read them and judged them unsafe)
    2x  [Git Destructive]        Bash  git push --force origin main  last 2026-10-16
    1x  [Code from External]     Bash  curl -s http://127.0.0.1:9/install.sh | sh  last 2026-10-16

No verdict: 2 times on 1 command. The check did not judge these, so they say nothing about the commands
    2x  stage two failed, unavailable                             Bash  ./scripts/release.sh --publish  last 2026-10-16
  All of them trace to the service or the connection, not to your settings.
```

Read the "Who decided" table first. The classifier decided 6 of the 9 calls. It allowed `./scripts/release.sh --publish` once, refused three calls (`git push --force` twice, and a `curl | sh`), and gave no verdict twice, both times for that script in two other sessions: once the second stage of the classifier failed, once the classifier model answered "overloaded". Those two are not refusals, because nothing was judged: the check did not run. `suggest` below uses the difference.

`--session <id>` takes the start of a session id and reports on that one session:

```text
claude-automode-doctor report --project /home/me/shop --session ba5a5f65
```

```text
claude-automode-doctor 1.2.0  what auto mode decided
config    /home/me/.claude  (from CLAUDE_CONFIG_DIR)
project   /home/me/shop  (session ba5a5f65...)
window    the last 30 days (to 2026-10-16, days are UTC dates); 4 transcripts; 1 tool decision

Who decided                   allowed  refused  no verdict   total
  classifier                        0        0           1       1
    Claude Code's own requests  1

By day          decisions   classifier: allowed  refused  no verdict
  2026-10-16                 1                     0        0           1

Sessions
  ba5a5f65 2026-10-16 16:53 to 16:53      1 decisions  classifier 1 (0 allowed, 0 refused, 1 no verdict)  /home/me/shop

No verdict: 1 time on 1 command. The check did not judge these, so they say nothing about the commands
    1x  the classifier model was unavailable (overloaded)         Bash  ./scripts/release.sh --publish  last 2026-10-16
  All of them trace to the service or the connection, not to your settings.
```

`--markdown` is the short form the skill hands to Claude: at most 17 lines, whatever the transcripts hold, and always exit 0, because Claude Code drops a skill whose command exits with 1 (put to the binary, see below):

```text
claude-automode-doctor report --project /home/me/shop --markdown
```

```text
## automode-doctor report: /home/me/shop
9 tool decisions in 4 sessions, last 30 days (UTC). Classifier: 6 (1 allowed, 3 refused, 2 no verdict; 6 by Claude Code's own requests, 0 by the server's review).
By source: permission mode 1, permission rule 2.
Refused by the classifier (judged unsafe):
- 2x [Git Destructive] Bash: git push --force origin main
- 1x [Code from External] Bash: curl -s http://127.0.0.1:9/install.sh | sh
No verdict (the check did not run; the service or the connection, not your settings):
- 2x stage two failed, unavailable: Bash: ./scripts/release.sh --publish
Worst day: 2026-10-16 (3 refused, 2 no verdict).
```

**Asked instead.** From the third refusal in a row, Claude Code does not show the classifier's refusal any more. The documentation says that auto mode pauses and Claude Code resumes prompting. In `claude -p` there is nobody to ask, so the call is refused with a sentence about approval, and the transcript line has no `reasonType`, `toolDenialKind` `user-rejected` and the classifier's boundary mark. The classifier was still asked for those calls (two requests each). `report` lists them as "asked instead", not as a refusal with no reason and not as a verdict, because the classifier's answer is not in the transcript. Four `git push --force` calls in one session, all refused by the fake classifier:

```text
claude-automode-doctor report --project /home/me/shop
```

```text
claude-automode-doctor 1.2.0  what auto mode decided
config    /home/me/.claude  (from CLAUDE_CONFIG_DIR)
project   /home/me/shop
window    the last 30 days (to 2026-10-16, days are UTC dates); 1 transcript; 4 tool decisions

Who decided                   allowed  refused  no verdict   total
  classifier                        0        4           0       4
    Claude Code's own requests  4

By day          decisions   classifier: allowed  refused  no verdict
  2026-10-16                 4                     0        4           0

Sessions
  d3907fdc 2026-10-16 16:54 to 16:54      4 decisions  classifier 4 (0 allowed, 4 refused, 0 no verdict)  /home/me/shop

Refused by the classifier: 4 commands, 4 times (it read them and judged them unsafe, except 2 that Claude Code asked about instead)
    1x  (asked instead)          Bash  git push --force origin hotfix  last 2026-10-16
    1x  (asked instead)          Bash  git push --force origin staging  last 2026-10-16
    1x  [Git Destructive]        Bash  git push --force origin release  last 2026-10-16
    1x  [Git Destructive]        Bash  git push --force origin main  last 2026-10-16
  "Asked instead": from the third refusal in a row Claude Code asks you instead of showing the
  classifier's refusal (claude -p, with nobody to ask, refuses the call). The classifier's own
  answer to those is not in the transcript.
```

### `why`

`why "<command>"... [--project <dir>] [--tool Bash|PowerShell] [--file <path>]` runs the command through the order Claude Code follows in auto mode, without running anything: deny and ask rules, the check for a critical path, allow rules (the broad ones are dropped, and `autoMode.classifyAllShell` suspends all shell ones), read-only commands and the file commands the mode approves inside the working folders, and then the classifier. It reads the settings of the project (the current folder, or `--project`). It exits 1 when the command would be refused or asked about.

- Several commands can be given: `why` prints one block per command in the order given, separated by a blank line; `--json` returns one document with a `commands` array; the exit code is the worst of the verdicts.

- `--file <path>` reads the commands from a text file, one per line, each exactly as written (no shell quoting or line continuation): surrounding whitespace is dropped, and blank lines and lines starting with `#` are skipped; LF and CRLF both work, and a relative path is relative to the folder you run it in. The commands of the file come first, in file order, then the ones on the command line. A file that cannot be read, or has no command in it and none on the command line, is a usage error (exit 2); `--file` is for `why` only and can be given once.

```text
claude-automode-doctor why "./scripts/release.sh --publish" --project /home/me/shop
```

```text
claude-automode-doctor 1.2.0  why
command   ./scripts/release.sh --publish
tool      Bash   in /home/me/shop

Goes to the classifier.
  no allow rule covers ./scripts/release.sh --publish (./scripts/release.sh is not a command this
  tool knows Claude Code treats as read-only). No allow rule covers it and it is not read-only, so
  it goes to the classifier.
  A rule that would skip the classifier for it: Bash(./scripts/release.sh *)
  ./scripts/release.sh --publish: ./scripts/release.sh is not one of the file commands the mode approves.
  A PreToolUse hook, or a mod, can decide a call before any of this; hooks are not read.
```

The rule it proposes is a rule that auto mode keeps, and with it `why` says the command skips the classifier (the `suggest` example below writes it and asks again). A rule that auto mode drops is named when it matched:

```text
claude-automode-doctor why "python build.py" --project /home/me/shop
```

```text
claude-automode-doctor 1.2.0  why
command   python build.py
tool      Bash   in /home/me/shop

Goes to the classifier.
  no allow rule covers python build.py (python runs code). No allow rule covers it and it is not
  read-only, so it goes to the classifier.
  Bash(python *) matched, and auto mode drops it (a rule this broad would let anything run)
  A rule that would skip the classifier for it: Bash(python build.py *)
  python build.py: python is not one of the file commands the mode approves.
  A PreToolUse hook, or a mod, can decide a call before any of this; hooks are not read.
```

A compound command is read part by part:

```text
claude-automode-doctor why "git status && ls src" --project /home/me/shop
```

```text
claude-automode-doctor 1.2.0  why
command   git status && ls src
tool      Bash   in /home/me/shop

Approved without the classifier.
  every command is covered by an allow rule or is read-only; auto mode keeps this rule, so the
  command skips the classifier.
  rule: Bash(git status)  (.claude/settings.json)

Parts
  allow      git status   Bash(git status)
  read-only  ls src
  A PreToolUse hook, or a mod, can decide a call before any of this; hooks are not read.
```

A removal of a critical path stops at a built-in check that asks you, whatever the allow rules say:

```text
claude-automode-doctor why "rm -rf ~" --project /home/me/shop
```

```text
claude-automode-doctor 1.2.0  why
command   rm -rf ~
tool      Bash   in /home/me/shop

Asks you; the classifier is not asked. In claude -p, which cannot ask, it is refused.
  rm -rf ~ removes a critical path (~): a safety check stops it whatever allow rules say. Claude
  Code asks you in a terminal session (the documentation) and refuses it in claude -p (seen); the
  classifier is not asked.
  A PreToolUse hook, or a mod, can decide a call before any of this; hooks are not read.
```

`why` does not run the command, and it does not read hooks: a `PreToolUse` hook, or a mod, can decide a call before any of this, and every answer says so. The static analysis is [claude-permission-doctor](https://github.com/nrzz/claude-permission-doctor)'s, and the auto mode layer on top of it is what the table of 612 commands checks.

### `show`

`show [--project <dir>]` prints the settings files from the highest precedence down with their state, then the `autoMode` lists as the classifier is given them, then the permission rules. For each part it names the file and the line. A list without `"$defaults"` is shown as "yours only: the built-in rules are replaced"; with it, the built-in rules are shown where they go. An `autoMode` block in a project or local file is listed as ignored, with the reason.

```text
claude-automode-doctor show --project /home/me/shop
```

```text
claude-automode-doctor 1.2.0  the autoMode and permissions settings, merged
project   /home/me/shop
config    /home/me/.claude

Settings files, highest precedence first
  managed  /etc/claude-code/managed-settings.json  not found
  local    .claude/settings.local.json             not found
  project  .claude/settings.json                   read; autoMode at line 2 (Claude Code does not read it from here)
  user     ~/.claude/settings.json                 read; autoMode at line 2

autoMode  (read from the user's and managed settings; the lists below are what the classifier is given)
  allow        built-in 17 rules
  soft_deny    yours only: the built-in 72 are replaced
      ~/.claude/settings.json:3  1 entry, no "$defaults"
      "Never deploy to production from this machine"  line 4
  hard_deny    built-in 1 rule
  environment  built-in 21 and yours
      ~/.claude/settings.json:6  2 entries, with "$defaults"
      "$defaults"  (the built-in rules go here)  line 7
      "The trusted repository is github.com/acme/shop"  line 8
  classifyAllShell not set (false)
  ignored: .claude/settings.json:2 has an autoMode block (allow); Claude Code reads autoMode from user and managed settings only

permissions
  defaultMode                            not set
  disableAutoMode                        not set
  blockReadsOutsideWorkingDirectories    not set
  deny   1 rule
      Read(./.env)                                          .claude/settings.json:9
  ask    0 rules
  allow  3 rules
      Bash(git status)                                      .claude/settings.json:12
      Bash(make build)                                      ~/.claude/settings.json:13
      Bash(python *)                                        ~/.claude/settings.json:14  dropped when auto mode starts

Not read by this tool:
  - server-managed settings, macOS profiles and the Windows registry (only managed-settings.json and managed-settings.d are read)
  - the --settings flag, which can carry an autoMode block of its own, and the --setting-sources flag
  - hooks and mods, which can decide a call before the permission rules and the classifier
```

### `lint`

`lint [--project <dir>] [--markdown]` reports the traps in those settings. Each finding has a severity (an error when Claude Code drops something the file says, a warning when the file applies but something is probably not what you meant, a note otherwise), the file, the line and the key path. It says what Claude Code does about it, and for the three known interactions the issue number. It exits 1 on an error or a warning.

```text
claude-automode-doctor lint --project /home/me/shop
```

```text
claude-automode-doctor 1.2.0  lint
project   /home/me/shop
config    /home/me/.claude

~/.claude/settings.json
  error   replaces-defaults        line 3  autoMode.soft_deny
      autoMode.soft_deny has 1 entry and no "$defaults", so it replaces the 72 built-in soft block
      rules (force push, curl | bash, production deploys and the rest): the classifier's prompt lost
      about 64,833 characters of them (Claude Code 2.1.299).
      fix: Put "$defaults" in the list to keep the built-in rules and add yours: "soft_deny":
      ["$defaults", ...]. Leave it out only to own the whole list; claude auto-mode defaults prints
      the built-in rules to copy.
  note    dropped-allow-rule       line 14  permissions.allow
      Bash(python *) is dropped when auto mode starts: a rule this broad would let anything run, so
      commands it matched go to the classifier instead (put to Claude Code 2.1.299). A narrower
      rule, such as Bash(npm run test *), stays.
      fix: Narrow the rule if you want it to skip the classifier.

.claude/settings.json
  warning automode-not-read        line 2  autoMode
      Claude Code reads autoMode from the user's settings and from managed settings, not from a
      project's shared .claude/settings.json: this block does nothing (claude auto-mode config
      ignores it, 2.1.299).
      fix: Move the block to ~/.claude/settings.json (or the settings.json in CLAUDE_CONFIG_DIR).
  note    read-deny-cd             line 9  permissions.deny  (issue #91650)
      1 Read deny rule (first: Read(./.env)). While a Read deny rule exists, a compound command with
      a cd followed by a read of a relative path is no longer approved by looking at it: on Claude
      Code 2.1.299 in auto mode it went to the classifier (cd sub && sed -n 1,2p b.txt did, and was
      approved by looking at it without the rule). Issue #91650 reports a prompt for the same
      command on 2.1.257 to 2.1.259.
      fix: Run the command without the cd (sed -n 1,2p sub/b.txt), or accept the classifier call.

1 error, 1 warning, 2 notes in 2 settings files
```

`lint --markdown` is the same findings, one line each, at most 12 of them and cut at 300 characters, and it always exits 0.

### `cost`

`cost [--project <dir>] [--since <days|YYYY-MM-DD>]` says what one classified command costs, from the sizes of the requests the binary sent in the capture behind this version of the tool (the version and the date are in its first line), then what the documentation says about who is billed, and how many commands in your transcripts were classified in the window.

```text
claude-automode-doctor cost --project /home/me/shop
```

```text
claude-automode-doctor 1.2.0  what classification costs
measured  on Claude Code 2.1.299, Windows 11, 2026-10-16, against a fake API (zero tokens)

One classified command
  stage 1   claude-sonnet-5  max_tokens     64   system prompt 140,489 characters (about 35,122 tokens), whole request about 35,197 tokens
  stage 2   claude-sonnet-5  max_tokens  8,192   system prompt 140,489 characters (about 35,122 tokens), whole request about 35,255 tokens
  One request when stage one is sure the command is routine (it allowed severities up to 25); two
  when it is not (it went on to stage two from 26). A classifier that answers something that is
  not a verdict is asked up to 5 times at stage one and 5 at stage two. A classifier model that
  answers with an error (overloaded) is asked 5 times, then your session's own model 5 times
  (max_tokens 2,112); the refusal then names your model, not the classifier's.
  So a command costs 1 to 2 requests, about 35,197 to 70,452 input tokens by characters / 4 (an estimate, not the tokenizer's count). The large block of the system prompt carries cache_control "ephemeral", so prompt caching can apply; the fake API cannot show whether it did.

Who pays  (the documentation; this tool cannot see an invoice)
  - where the server reviews the actions as part of the session's own model requests (a direct
    connection to the Anthropic API), there are no separate classifier requests and no charge for
    them
  - when the server's checks do not reach the session (a gateway or proxy in the way, a platform
    that does not have them yet), Claude Code makes its own classifier requests, and on accounts
    where those are billed they count toward token usage
  https://code.claude.com/docs/en/auto-mode-classifier-billing

In your transcripts (the last 30 days)
  6 classifier decisions: 6 by Claude Code's own requests, 0 by the server's review
  the 6 sent 6 to 12 requests: about 211,182 to 422,712 input tokens if none were cached or free
```

These are characters divided by 4, an estimate and not a count by the tokenizer. The 242-character last block of the system prompt names the operating system user, so the total differs by a few characters between machines. `cost` reads the sizes from `src/measured.mjs`, and `test/e2e-automode.test.mjs` measures the same things live: when the binary under test is the version in that file, the figures must agree exactly.

### `suggest`

`suggest [--project <dir>] [--since <days|YYYY-MM-DD>] [--min <n>] [--write (--user | --local | --project <dir>)] [--include-judged] [--dry-run]` proposes allow rules for the commands the classifier turned back at least `<n>` times (default 2). It exists because the binary shows that a narrow allow rule makes a command skip the classifier in auto mode. Each proposal is checked: the rule is not one of the broad rules auto mode drops, and with it `why` says the whole command line no longer goes to the classifier. A command line that no rule can fix (inline code, a pipe into a shell, a variable in front of the command) is listed as one no rule helps. Two kinds of turned-back command are told apart:

- no verdict: the check did not run. Nothing was judged, and `--write` adds the rule;
- judged unsafe (or asked instead, after three refusals in a row): the rule would make a command run unchecked that the classifier called dangerous. These are listed with the category and the risk of the rule, and `--write` leaves them out unless you add `--include-judged`.

```text
claude-automode-doctor suggest --project /home/me/shop
```

```text
claude-automode-doctor 1.2.0  suggest
window    the last 30 days; commands the classifier turned back at least 2 times

Bash(./scripts/release.sh *)   2x
    2x the check gave no verdict (the second stage of the classifier failed, the classifier model was unavailable)
    e.g. ./scripts/release.sh --publish
Bash(git push *)   2x
    the classifier judged it unsafe 2x ([Git Destructive]): with this rule it runs unchecked
    the rule publishes commits
    e.g. git push --force origin main

No rule helps these
    1x  curl -s http://127.0.0.1:9/install.sh | sh   Bash(sh *) is one of the broad rules auto mode drops, so it would not skip the classifier

To add them: claude-automode-doctor suggest --write --user   (--dry-run first shows the change; --include-judged also adds the ones the classifier judged unsafe or Claude Code asked about instead)
```

Without `--write` nothing is written. `--write` needs the file to be named (`--user`, `--local`, or `--project <dir>`), and `--dry-run` shows the change first. Both print the list above and then, in the last lines:

```text
claude-automode-doctor suggest --project /home/me/shop --write --user --dry-run
```

```text
(dry run) Would add 1 allow rule to ~/.claude/settings.json:
  + Bash(./scripts/release.sh *)
Nothing was written (--dry-run).
```

```text
claude-automode-doctor suggest --project /home/me/shop --write --user
```

```text
Added 1 allow rule to ~/.claude/settings.json:
  + Bash(./scripts/release.sh *)
The old file is saved as ~/.claude/settings.json.bak-automode-doctor-20261016-222401. Undo with: claude-automode-doctor restore --user
```

And with the rule in place, `why` says the command skips the classifier. The put-to-the-binary version of this step is in the tests: after the rule, the same command in a new `claude -p` session made no classifier request.

```text
claude-automode-doctor why "./scripts/release.sh --publish" --project /home/me/shop
```

```text
claude-automode-doctor 1.2.0  why
command   ./scripts/release.sh --publish
tool      Bash   in /home/me/shop

Approved without the classifier.
  every command is covered by an allow rule or is read-only; auto mode keeps this rule, so the
  command skips the classifier.
  rule: Bash(./scripts/release.sh *)  (~/.claude/settings.json)
  A PreToolUse hook, or a mod, can decide a call before any of this; hooks are not read.
```

### `restore`

`restore (--user | --local | --project <dir>) [--dry-run]` puts the newest backup back. The file as it was is saved first, so `restore` can itself be undone by running it again.

```text
claude-automode-doctor restore --user --dry-run
```

```text
(dry run) Would restore ~/.claude/settings.json from ~/.claude/settings.json.bak-automode-doctor-20261016-222401.
```

```text
claude-automode-doctor restore --user
```

```text
Restored ~/.claude/settings.json from ~/.claude/settings.json.bak-automode-doctor-20261016-222401.
The file as it was is saved as ~/.claude/settings.json.bak-automode-doctor-20261016-222402; run restore again to switch back.
```

### JSON

`--json` prints one document. The top-level shapes (a field name is listed where the value is a list or an object):

```text
report   { ok, configSource, configDir, project, window: { days, since, until, first, last, date }, session, files, total,
           sources: { <source>: { total, allowed, refused, noVerdict, unknown } },
           classifier: { total, allowed, refused, noVerdict, client, server },
           tools, modes, days: [ { day, total, ..., classifier } ], sessions: [ { id, project, first, last, version, total, ..., classifier } ],
           refused: [ { tool, subject, count, asked, category, reason, last, sessions } ],
           noVerdict: [ { tool, subject, count, cause, detail, service, serviceCount, causes, last, sessions } ],
           decisions: [ { ts, day, session, project, mode, tool, subject, source, result, via, category, reason, fallback,
                          cause, service, permission: { decision, source, reasonType, kind } } ],
           truncated, notes }
show     { ok, project, configDir, files: [ { scope, label, path, display, rank, exists, state, detail, autoMode, rules } ],
           autoMode: { readFrom, lists: { allow, soft_deny, hard_deny, environment }, classifyAllShell, ignoredCopies, notes },
           permissions: { defaultMode, disableAutoMode, blockReads, additionalDirectories, rules: { allow, ask, deny } },
           notRead }
lint     { ok, project, configDir,
           findings: [ { id, severity, effect, evidence, scope, file, display, line, keyPath, message, fix, issue } ],
           counts: { error, warning, note }, files }
why      { ok, tool, command, outcome, basis, summary, rule, parts: [ { text, status, detail, rule } ], dropped, notes,
           engine, suggestion, project, cwd, configDir } (with several commands: { ok, commands: [ ... ] })
cost     { ok, measured: { version, date, platform }, stages: [ { stage, model, maxTokens, systemChars, userChars, requestChars,
           systemTokens, requestTokens } ], perCommand, prompt, billing, transcripts }
suggest  { ok, project, window, min, includeJudged,
           proposals: [ { rule, tool, key, count, judged, asked, noVerdict, categories, causes, risk, examples, last, lines,
                          skipsClassifier } ],
           skipped: [ { subject, count, reason } ], stats, write }
restore  { ok, scope, display, restored, from, savedCurrent, ... }
```

- `why.outcome` is `static` (approved without the classifier), `classifier`, `refused` (a rule or a built-in check refuses it) or `prompt` (it asks you; `claude -p` refuses it). `basis` says why: `read-only`, `allow-rule`, `mode`, `no-rule`, and so on.
- With several commands, `why` returns `{ ok, commands: [ ... ] }`, one entry per command in the order given, each entry the single-command document.
- `report.window` is the window that was asked for: `days` is the days it covers (`--since 7` is 7; `--since 2026-10-01` is the days from that date to now, rounded up), `since` is its first UTC day, `until` its last, and `date` is the day `--since` named, `null` when a number of days was asked.
- `lint.findings[].evidence` says what a finding rests on: `binary` (put to the real Claude Code binary), `docs` (the documentation, not asked of the binary) or `issue` (an issue thread, with the premise put to the binary). `effect` says what Claude Code does about it: `file` (the whole file is ignored), `list`, `key`, or `none`.
- `report.decisions[].source` is one of `static`, `mode`, `rule`, `classifier`, `hook`, `safety`, `user`, `unrecorded`; `result` is `allowed`, `refused`, `no-verdict` or `unknown`. `via` is `client` (Claude Code's own classifier requests) or `server` (the review done with the model request). `fallback` is `repeated-blocks` for an asked-instead call.

## How it works

It reads, on your machine only:

- the transcripts: `<config folder>/projects/<project>/<session>.jsonl` and `<session>/subagents/*.jsonl`, where the config folder is `$CLAUDE_CONFIG_DIR` or `~/.claude`. A decision is a `tool_use` block and the `tool_result` that answers it. The fields it reads are on the result line: `permissionDecision` (`decision`, `source`, `reasonType`), `toolDenialKind`, `classifierBoundary` and `serverClassifierContext`, then the `tool_result`'s `is_error` and text. Of the call it keeps the tool's name and the command, path or URL that was decided. It reads no prompt of yours and no output of a command. A transcript file that was not written to in the window is not opened.
- the settings files that apply, in the order Claude Code gives them (highest first):
  - `managed-settings.json` and `managed-settings.d/*.json` in the system folder: `C:\Program Files\ClaudeCode` on Windows, `/Library/Application Support/ClaudeCode` on macOS, `/etc/claude-code` on Linux;
  - `<project>/.claude/settings.local.json`;
  - `<project>/.claude/settings.json`;
  - `<config folder>/settings.json`.
- the path-scoped rule files (`.claude/rules/*.md` with `paths:`), for the one finding about them.

How it reads a decision. These are the fields the binary wrote when it was made to take each kind of decision (the scenarios below), and what `report` calls them:

| `permissionDecision` and the result line | `report` says |
| --- | --- |
| `accept`, `reasonType` `subcommandResults` | static approval: the command was approved by looking at it (read-only, or every part covered by an allow rule) |
| `accept`, `reasonType` `mode` | permission mode |
| `accept` or `reject`, `reasonType` `rule`, or `toolDenialKind` `permission-rule` | permission rule |
| `reasonType` `classifier`, or `classifierBoundary`, or `serverClassifierContext`: `accept` | classifier, allowed |
| the same, `reject`, `toolDenialKind` `automode-blocked`, the reason in the text | classifier, refused (the category is the `[Rule Name]` in the text) |
| the same, `automode-unavailable`, `automode-parsing-error`, or a stage-two error, a safety check, a context window that is too small, the server's review skipped | classifier, **no verdict** (with the cause; the service or the connection, except the safety check and the context window) |
| `reject`, `toolDenialKind` `user-rejected`, `classifierBoundary` true, no `reasonType` | classifier, refused, **asked instead** (the third refusal in a row) |
| `reasonType` `hook` | hook |
| `reasonType` `safetyCheck` | built-in safety check |
| `reject`, `toolDenialKind` `user-rejected`, no `classifierBoundary` | you (an ask rule, or `claude -p` with nobody to ask) |
| no `permissionDecision` (an older Claude Code) | not recorded; a refusal is still known by the sentence the classifier's refusals start with |

How `why` decides is the order in `src/why.mjs`: the engine of claude-permission-doctor (the shell reader, the read-only list, rule matching; copied unchanged, each file says from which commit) and, on top of it, what auto mode changes: broad allow rules are dropped (the list is what Claude Code 2.1.299 contains), `classifyAllShell` suspends the shell allow rules, a removal of a critical path is stopped before the classifier, and the commands the mode approves inside the working folders skip it. Every statement of that layer is a row of the table.

It writes only with `suggest --write` and `restore`, and only the file you named with `--user`, `--project` or `--local`:

- **A backup first**, next to the file: `settings.json.bak-automode-doctor-<timestamp>` (local time, `-1`, `-2` when the name is taken). `restore` puts the newest back and saves the file it replaces, so it can itself be undone. The backups are the file byte for byte.
- **Only `permissions.allow` changes.** When the file has that list, it is edited in the file's text and the rest keeps its bytes. When it has none, the file is written again with the list added, in its own indentation and line endings. A file that is not valid JSON, or whose `permissions` is not an object, is left alone and the command says so.
- **A temporary file and a rename**, so nobody sees half a file. The mode of the file is kept, and a symlink to the file stays a link.
- **Nothing else**: never managed settings, never `~/.claude.json`, never a transcript.
- **`--dry-run`** shows the change and writes nothing.

### Privacy

It reads transcripts and settings files on your machine and sends nothing anywhere. It never uses the network, starts no process, has no telemetry, no account and no cache. It writes only what is described above, on the two commands that write. A test fails if any file under `src/` or `bin/` imports anything but `node:fs`, `node:os` or `node:path`, opens a socket or starts a process, or if any file other than `src/write.mjs` calls a function that changes a file. A transcript holds your prompts, your commands and what they printed; the tool keeps only the tool's name, the command or path that was decided, the reason the classifier gave, the time and the session id. It never prints a prompt or the output of a command, and it never has the classifier's own prompt: Claude Code does not record that. A command can still contain a secret you typed into it, and `report` prints the commands that were refused, so read a report before you paste it into an issue. The plugin's skill runs the same program and puts its report in front of Claude when you invoke it: counts, the commands that were refused or had no verdict (cut at 200 characters), and the project's path.

## What was verified, and how

Checked on 2026-10-16 on Windows 11 with Node 24.19.0, git 2.55.0 and Claude Code 2.1.295 and 2.1.299 (every real-binary check passed on both). CI runs the unit tests on Linux, macOS and Windows with Node 20, 22 and 24 and on Linux with Node 18. It runs the real-binary checks on Linux and macOS against the npm release of Claude Code (2.1.301). All 12 jobs (10 of the unit tests, 2 of the real-binary checks) were green for the first time on commit 4e3512e, on 2026-10-16. The badges at the top show the latest runs.

- **207 automated tests** (`npm test`, Node's own runner, no dependencies, about 7 seconds). `node --test` also reports each of the 7 helper files under `test/` as a passing test, on Node 20 and newer; those are not counted here. Without a Claude Code binary 153 pass on Windows and 152 on Linux and macOS, where one test of the PowerShell tool is skipped; the 54 real-binary checks below are skipped everywhere. The tests cover:
  - the transcript reader and the classification of every shape the binary wrote (the 24 fixtures in `test/fixtures/`, recorded from the binary), older transcripts, resumed sessions, lines that are not JSON, folders that only share a prefix;
  - the report: counts per source, per day and per session, the window, `--session`, the refused commands, the no-verdict causes, the asked-instead calls, the requested date or day count in the Markdown summary, the 17-line cap of the markdown form;
  - the settings loader (precedence, managed drop-ins, a file that is not JSON, wrong types, paths with spaces), `show` and the lint (every finding, with the numbers measured);
  - `why`: the order of the checks, deny and ask rules, allow rules and the ones auto mode drops (every rule shape that was put to the binary, kept or dropped as the binary did), `classifyAllShell`, critical and protected paths, additional directories, `cd` beside a Read deny rule, PowerShell on Windows, and the table of 612 commands: what `why` says for each row, without a binary;
  - `suggest` (the check that a proposed rule makes the command skip the classifier, `--write` with its backups, the held-back judged commands) and `restore`;
  - the command line (every usage error and exit code), the package files, the workflows and the README: its sections, commands, flags and usage block, and the numbers it quotes from the code.
- **54 checks against the real binary** (`test/e2e-*.test.mjs` and `test/auto-oracle.test.mjs`, run when `E2E_CLAUDE` names a Claude Code binary). Each starts a fake Messages API on 127.0.0.1, so no model is reached and no token is spent. Each has its own throwaway `HOME`, `USERPROFILE` and `CLAUDE_CONFIG_DIR` and a project folder that Claude Code already trusts. All 54 passed on 2.1.295 and on 2.1.299 on Windows. In CI on Linux and macOS with 2.1.301, 52 of them ran (two are for the Windows PowerShell tool) and passed. The findings below were the same on both versions unless a bullet says otherwise:
  - **The decisions** (`e2e-claude.test.mjs`, 24 scenarios, each one `claude -p` run). The fields the transcript carries for a read-only command, an exact allow rule from the user's file (`source` `user_permanent`), the same rule from the project's file (`config`), a prefix rule (still `subcommandResults`: it skips the classifier), a deny rule, an ask rule (`claude -p` refuses it as user-rejected), a file write and a `touch` approved by the mode, a hook that allows and one that denies, a removal of a critical path (`safetyCheck`), `dontAsk` mode, and the classifier: allowed after one request (stage one is sure) and after two, refused with a category and without one, a severity of 50 (refused: 50 is on the block side), the third refusal in a row, a classifier that answers text that is not a verdict (ten requests, then "could not evaluate"), a model that answers 529 (ten requests, then "temporarily unavailable"), a second stage that fails. The JSON result lists a refused call under `permission_denials` and an approved one does not. The server's review (not flagged, flagged, skipped) is played by the fake API; see "Not verified". `report` said the source and result of each line that the scenario says.
  - **The sizes and the thresholds.** The classifier's requests are ordinary Messages API requests to `ANTHROPIC_BASE_URL`, with no tools and no `stream` field. Stage one goes to `claude-sonnet-5` with `max_tokens` 64 and the stop sequence `</severity>`; stage two to `claude-sonnet-5` with `max_tokens` 8,192. Both carry the same system prompt, three blocks of 74, 140,173 and 242 characters on 2.1.299 (140,489 in all; 140,387 on 2.1.295), the big one marked for caching, and the transcript as the user message. Stage one answered severities of 5 and 25: one request, and the command ran. 26, 40 and 95: two requests, the second stage decided. A classifier that answers something that is not a verdict is asked five times at each stage. A classifier model that answers 529 is asked five times, and then the session's own model five times (`max_tokens` 2,112); the refusal names the session's model, not the classifier's. So a "temporarily unavailable" message can name your model while the model that failed first was the classifier's.
  - **The `autoMode` block.** `claude auto-mode defaults` prints 17 allow, 72 soft_deny, 1 hard_deny and 21 environment rules. A list without `"$defaults"` replaces the built-in rules of its section in the classifier's prompt: the prompt lost 8,019, 64,833, 5,284 and 3,566 characters (allow, soft_deny, hard_deny, environment) on 2.1.299 and 8,019, 64,731, 5,284 and 3,566 on 2.1.295, and with `"$defaults"` in the list they stayed (the prompt grew by 11 characters, the marker line). An empty list changes nothing, and a second `"$defaults"` adds nothing. The block is read from the user's `settings.json` and from the `--settings` flag, and not from the project's or the local file; two sources add their entries. `claude auto-mode config` agreed with `show --json` on the effective lists in 12 variants of the user file (`"$defaults"` first, in the middle, last, twice, in one list and not in another).
  - **Wrong types.** 47 values (33 for `autoMode`, 8 for `permissions.disableAutoMode`, 6 for `permissions.blockReadsOutsideWorkingDirectories`), each in the user, project and local file: 141 files, each with a `model` in it as the probe. Claude Code applied the `model` of 36 of them and ignored the other 105 whole. It ignored the whole file for a value of the wrong type anywhere in the block (a string, a number, `true`, `null` or a list where an object belongs; a string, a number, `null`, an object or a list where a list or a boolean belongs; an entry that is not a string), for any `disableAutoMode` but the string `"disable"` (`true`, `false`, `"enable"` and `"Disable"` included), and for a `blockReadsOutsideWorkingDirectories` that is not `true` or `false`. The loader of this tool said the same for all 141. A key the block does not have (`softDeny`, `deny`, `unknownKey`) does not cost the file: it is read and the entry reaches nothing. A comment or a trailing comma makes Claude Code ignore the file too, the `autoMode` block in it with it (`//`, `/* */` and a trailing comma were tried); strict JSON is read.
  - **The traps.** `permissions.disableAutoMode` set to `"disable"` in the user, project or local file turned auto mode off: the classifier was not asked, and a command that needs approval was refused for want of someone to ask, as in the default mode. `classifyAllShell` and the broad allow rules, the Bash-first instruction and the cases of #95238 and #91650 are rows of the table below. For #88565, in one session with a Bash redirection into a text file and then a `Write` of another, the `InstructionsLoaded` hook saw the path-scoped rule file load once, triggered by the file `Write` made (`load_reason` `path_glob_match`) and not by the redirection; a `Read` of a text file loads it too. On 2.1.301 in CI the hook was seen on Linux and not on macOS in the same run, and in another run the other way round, so on a version that is not recorded the check only requires that the redirection did not load the rule. The Bash-first instruction itself is in the request when auto mode is on, and the transcript records an `auto_mode` attachment with `bashFirst` true.
  - **The table for `why`** (`auto-oracle.test.mjs`): 612 rows, each a command under one of four sets of settings, put to `claude -p --permission-mode auto` with a fake classifier that refuses whatever it is asked about, so that nothing that reaches it runs. A row is `static` (approved without the classifier), `classifier`, `prompt` (asked about; `claude -p` refuses) or `refused`. They fall in 36 groups: read-only commands, file commands, rule shapes, dropped rules, `classifyAllShell`, `blockReadsOutsideWorkingDirectories`, Read deny rules with `cd`, critical paths, and the PowerShell tool (82 rows, which run only on Windows). Seven rows are not run by the oracle: their commands name something outside the throwaway folders (`rmdir` of `/`, `/usr`, `/etc` and `/tmp`, `Remove-Item` of `C:\Windows`) or install packages (an exact allow rule for `npm install`). They were put to both binaries once, while the table was made, and `why` is still held to them. Every row gave the recorded answer on 2.1.299 and on 2.1.295. One row has a different answer on 2.1.295, recorded as `v295`: an `rm -rf` of the home folder in its Git Bash spelling went to the classifier there, where 2.1.299 stops it at the critical-path check. Before the table was fixed, a second set, the 755 Bash rows of claude-permission-doctor's own oracle table, was put to `why` and to the binary in auto mode: 21 differed at first, each one was fixed in the overlay, and then all 755 agreed on both versions. That second check is not in this repository. On a newer Claude Code the `core` rows (63 of them) must agree and 95% of all. In CI with 2.1.301, on Linux and on macOS, every row that runs there gave the recorded answer but two: the two `xargs echo` rows. 2.1.301 approves `xargs echo` without the classifier, and 2.1.299 sent it there. Four rows that name an additional directory in the Git Bash spelling (`/c/Users/...`) have answers for Linux and macOS (`posix`), where that spelling is the directory itself; the first CI run showed them and the second confirmed them.
  - **The report on a real session** (`e2e-suggest.test.mjs`). A session of six calls (a read-only command, a `Write`, an allowed classifier call, two refused ones and an allow-rule one) was counted by source, the refused command was one entry with a count of two, and `why` agreed with what the binary did with each command.
  - **`suggest`.** Two sessions in which the second stage failed, so the check gave no verdict: `suggest` proposed `Bash(mytool *)`, `--dry-run` wrote nothing, `--write --user` added it after a backup, a third session ran the same command with no classifier request, and `restore` put the file back.
  - **A skill whose command fails.** The model never received a copy of the skill whose command is `report` without `--markdown`, on a project with a refused command (it exits 1): no request carried the skill's text. The same copy with `--markdown` reached the model.
  - **The plugin** (`e2e-plugin.test.mjs`). `claude plugin validate` and `--strict` pass. With the plugin loaded, a plain prompt's request was the same size with and without it, and it had the same tool list. The word `automode-doctor` did not occur in it. The sizes were 69,122 characters on 2.1.295 and 69,652 on 2.1.299, 64,688 on 2.1.301 on Linux and 65,667 on macOS. `/automode-doctor:check` reached the model with the report for the project in it and the instruction after it, also when the classifier had refused something. The figures in "What it costs in tokens" are from that capture. The model could run the command from the skill's `allowed-tools` with no prompt in the default permission mode, with the Bash tool and, on Windows, the PowerShell tool. Claude Code runs the command line of a skill and pastes its output when the shell tool is allowed for it (what `allowed-tools` does here). Otherwise it hands the model `[run this first, exactly as written, ...]` with the command filled in. I saw both, and the skill's text reads right in both. `claude plugin details` for the installed plugin: `Always-on: ~12 tok`, `check < 20` always-on and about 90 when used.
- **From GitHub.** `npx -y github:nrzz/claude-automode-doctor report` ran from the published repository (commit 4e3512e) with a throwaway npm cache and home folder, against a copy of the config folder of the example above. It took 11 seconds, printed the same report and exited 1, because the classifier had refused commands.

## Not verified

- **The server's review.** The documentation describes a review that the server does as part of the model request (a `safeguards` field in the request, a `safeguard_results` field in the answer, `serverClassifierContext` on the transcript line). The shapes were read from the binary and played by the fake API; they were not seen from the real service. The three server fixtures (not flagged, flagged, skipped) are those emulations. A direct connection that the review reaches was not tried.
- **Billing.** Who pays for the classifier requests is the documentation's account (the page is linked from `cost`). The binary printed a notice about it, saying the session was not eligible because its requests went through another host; the fake API cannot play a direct connection, and this tool cannot see an invoice.
- **Interactive sessions.** I did not drive the terminal interface or the desktop app, the VS Code extension or JetBrains. What a person is asked after three refusals in a row, what the transcript line says when they answer, the limit of 20 refusals in total that the documentation names, and the "Recently denied" list were not seen. The "asked instead" line is what a `claude -p` run wrote.
- **Managed settings.** Their place and precedence come from the documentation. They are read, but the binary was not put to them: that needs a system folder these checks do not write to. How a managed `autoMode` list combines with the user's was not tried (two sources, the user file and `--settings`, were: the entries add). Server-managed settings, macOS profiles and the Windows registry are not read.
- **Flags and hooks.** `show` and `why` do not read the `--settings` and `--setting-sources` flags, hooks or mods. A `PreToolUse` hook that allows a call decides before everything `why` looks at.
- **Agent and MCP tools.** The report counts any tool whose result line carries a decision. Only Bash, PowerShell, Write and Read calls were run against the binary; what the lines of an MCP tool or a subagent's call look like was not checked.
- **Other versions.** The local runs are Claude Code 2.1.295 and 2.1.299, the CI runs 2.1.301 on Linux and macOS. Transcripts of versions before 2.1.295 were not read. A line with no `permissionDecision` is read by the sentences of the refusals, or counted as "not recorded"; that was tested with written transcripts, not recorded ones. The classifier's prompt, its built-in rules, the thresholds and the list of dropped allow rules change between releases; the figures are those of 2.1.299 and the lint quotes the version.
- **Linux and macOS** are covered by CI only; nothing was run on either by hand. Table rows that differ there are recorded in the table as `posix` rows.
- **The PowerShell tool.** The 82 PowerShell rows ran on one Windows 11 machine with the tool switched on. The tool offers PowerShell rules and PowerShell commands the same way, but it is not as well covered as Bash.
- **Providers.** Claude Code through Bedrock or Vertex, or behind a gateway, may route the classifier differently. Only `ANTHROPIC_BASE_URL` with an API key was tried.
- **The skill with a model.** It was run through the real binary at zero tokens, as above; what Claude then says about the report was not checked.
- **The marketplace line.** `/plugin install automode-doctor@claude-code-toolkit` has not been tried: the toolkit's marketplace lists the plugin only after the hub is updated. The plugin installs and validates from a local marketplace folder.

## Files

| Path | What it is |
| --- | --- |
| `bin/claude-automode-doctor.mjs` | The command |
| `src/cli.mjs`, `src/commands.mjs` | The options, the help and the exit codes; the commands as plain objects |
| `src/render.mjs` | The text, markdown and JSON reports |
| `src/transcripts.mjs`, `src/decisions.mjs`, `src/aggregate.mjs` | Reading the tool decisions; who made each one and what came out; counting them |
| `src/settings.mjs`, `src/show.mjs`, `src/rulefiles.mjs` | Finding and reading the settings that decide what auto mode does; the merged view; path-scoped rule files |
| `src/automode.mjs`, `src/lint.mjs` | What Claude Code does with the `autoMode` block and with allow rules; the checks |
| `src/why.mjs`, `src/engine/` | Why a command goes to the classifier or not; the decision engine copied from claude-permission-doctor |
| `src/suggest.mjs`, `src/write.mjs`, `src/jsonedit.mjs` | Allow rules for what the classifier turned back; the only code that writes; editing a JSON list by its text |
| `src/cost.mjs`, `src/measured.mjs` | What classifying a command costs; the figures measured on the binary, with the version and the date |
| `src/jsonc.mjs`, `src/version.mjs` | Reading JSON with comments by its text; the version number, which `package.json` and `plugin.json` must agree with |
| `skills/check/` | `/automode-doctor:check`, the user-only skill |
| `.claude-plugin/` | The plugin manifest and its icon |
| `test/` | `npm test`; `auto-table.mjs` is the commands `why` is held to, `scenarios.mjs` and `fixtures/` the decision shapes recorded from the binary, `claude-sandbox.mjs` the fake API, and the `e2e-*.test.mjs` files and `auto-oracle.test.mjs` put it all to the binary |

Related: [claude-permission-doctor](https://github.com/nrzz/claude-permission-doctor) explains why a permission prompt appeared and finds dead rules, [claude-settings-doctor](https://github.com/nrzz/claude-settings-doctor) checks the settings files against the schema, and [claude-hook-bench](https://github.com/nrzz/claude-hook-bench) runs every hook with the JSON Claude Code sends.

## Contributing

Issues and pull requests are welcome: start with [CONTRIBUTING.md](CONTRIBUTING.md) and the [good first issues](https://github.com/nrzz/claude-automode-doctor/issues?q=is%3Aopen+label%3A%22good+first+issue%22). For a wrong answer from `why`, send the command, the settings and what Claude Code did; that becomes a row of the table. Questions go to [Discussions](https://github.com/nrzz/claude-automode-doctor/discussions); security reports go through [SECURITY.md](SECURITY.md).

## Part of the Claude Code toolkit

Small, dependency-free tools that make Claude Code cheaper, safer and easier to share, all in the [Claude Code toolkit](https://github.com/nrzz/claude-code-toolkit):

- [claude-code-handover](https://github.com/nrzz/claude-code-handover): short sessions with a handover file every new session loads by itself
- [claude-code-team-sync](https://github.com/nrzz/claude-code-team-sync): share sessions, notes and team context with coworkers
- [claude-code-glow](https://github.com/nrzz/claude-code-glow): themes for the whole interface, a status line and a live HUD
- [claude-code-guardrails](https://github.com/nrzz/claude-code-guardrails): safety presets that stop risky commands and edits
- [claude-code-notify](https://github.com/nrzz/claude-code-notify): a ping when Claude needs you or finishes
- [claude-cost-guard](https://github.com/nrzz/claude-cost-guard): daily and weekly token budgets with zero-token warnings
- [claude-md-doctor](https://github.com/nrzz/claude-md-doctor): what your CLAUDE.md costs every session, and how to slim it
- [claude-code-starter-kits](https://github.com/nrzz/claude-code-starter-kits): a lean, safe .claude/ for your stack in one command
- [claude-session-replay](https://github.com/nrzz/claude-session-replay): search past sessions and export one as an HTML replay
- [claude-chat-ferry](https://github.com/nrzz/claude-chat-ferry): continue a Cursor or Antigravity chat in Claude Code, or hand a session to them
- [claude-permission-doctor](https://github.com/nrzz/claude-permission-doctor): why a permission prompt appeared, dead rules, rules from your history
- [claude-session-tidy](https://github.com/nrzz/claude-session-tidy): list, delete, keep and restore your sessions before the 30-day sweep
- [claude-hook-bench](https://github.com/nrzz/claude-hook-bench): run every hook with the JSON Claude Code sends, and see what each one does
- [claude-relocate](https://github.com/nrzz/claude-relocate): move Claude Code's config folder to another drive or the XDG folders, safely, with undo
- [claude-settings-doctor](https://github.com/nrzz/claude-settings-doctor): a commented settings.jsonc that builds settings.json, the merged settings with their source, a lint against the schema
- [claude-mcp-check](https://github.com/nrzz/claude-mcp-check): every MCP server Claude Code would load, from which file, whether it starts, and what its tools cost
- [claude-sandbox-doctor](https://github.com/nrzz/claude-sandbox-doctor): whether Claude Code's Bash sandbox works on this machine, and why a command ran inside it, outside it, or not at all
- [claude-windows-doctor](https://github.com/nrzz/claude-windows-doctor): which shell the Bash tool gets on Windows and why, every claude on PATH, and the setup problems behind common Windows issues

Set up any of them, or all of them, from one page: `npx -y github:nrzz/claude-code-toolkit` opens it with the recommended tools switched on.

If one of them saves you tokens, a star on its repository helps other people find it, and following [@nrzz](https://github.com/nrzz) on GitHub shows you new tools and releases.

## License

MIT
