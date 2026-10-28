# Changelog

All notable changes to claude-automode-doctor are written here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

- `why`: accept several commands; print one block each separated by a blank line, return `{ ok, commands }` with `--json`, and exit with the worst of the verdicts.

## [1.1.1] - 2026-10-17

- `report --markdown --since YYYY-MM-DD` names the requested date in its summary (`since 2026-10-12 (UTC)`) instead of converting it to a day count, as the text report has since 1.1.0. Numeric windows keep their wording, and the report still has at most 17 lines and exits 0.
- Contributed by [@slophisticated](https://github.com/slophisticated) in [#4](https://github.com/nrzz/claude-automode-doctor/pull/4), for the good first issue [#3](https://github.com/nrzz/claude-automode-doctor/issues/3).

## [1.1.0] - 2026-10-16

- `--since` takes a date as well as a number of days: `--since 2026-10-01` is from the start of that day in UTC, the way the report counts days, and `report`, `cost` and `suggest` take it the same way. The window line says what was asked for (`the last 7 days`, or `since 2026-10-01`), and the JSON `window` carries the date and the number of days it covers. The number form is unchanged. A date in the future, or one that is not a date (`--since 2026-13-40`), is a usage error (exit 2) that names both forms.
- Contributed by [@ElectLive](https://github.com/ElectLive) in [#2](https://github.com/nrzz/claude-automode-doctor/pull/2), the first outside pull request, for the good first issue [#1](https://github.com/nrzz/claude-automode-doctor/issues/1).

## [1.0.0] - 2026-10-16

- First release. A CLI and a Claude Code plugin with one user-only skill, `/automode-doctor:check`.
- `report` reads the tool decisions in your transcripts and says who made each: static approval, the permission mode, a permission rule, the classifier (allowed, refused, or no verdict), a hook, or you. It counts them per day and per session and lists the commands the classifier refused, with the rule it named, apart from the refusals that were no verdict (the check did not run: the service or the connection, not your settings). `--markdown` is the short form the skill hands to Claude; it always exits 0.
- `why "<command>"` says whether a command goes to the classifier in auto mode, or is approved without it (read-only, an allow rule, a file command the mode approves), or is refused or asked about, and names the rule and the file. It rests on the decision engine of claude-permission-doctor and on the changes auto mode makes: broad allow rules are dropped, `classifyAllShell` suspends the shell allow rules, a critical path is stopped before the classifier.
- `show` and `lint` read the settings that decide what auto mode does: the `autoMode` block (read from user and managed settings, not from a project or local file), the allow, ask and deny rules, `permissions.disableAutoMode` and `blockReadsOutsideWorkingDirectories`. The lint finds an `autoMode` list without `"$defaults"` (it replaces the built-in rules), a value of the wrong type (Claude Code ignores the whole file), a block in a file that is not read, allow rules that auto mode drops, `classifyAllShell`, and three known bad interactions, each with what it rests on.
- `cost` says what a classified command costs from the request sizes measured on the binary, who is billed, and how many commands your transcripts show were classified. `suggest` proposes allow rules for the commands the classifier turned back, each checked to skip the classifier, and `--write` adds them to the settings file you name after saving it (`restore` undoes it).
- What Claude Code does is what the real binary did: `test/auto-oracle.test.mjs` puts 612 commands to Claude Code 2.1.295 and 2.1.299, 24 scenarios record the decision shapes the transcripts hold, and the same checks run in CI on Linux and macOS with the newest npm release (README "What was verified, and how").
- From the third refusal in a row Claude Code asks instead of letting the classifier refuse, and `claude -p` then refuses with a sentence about approval. `report` lists those calls as "asked instead", not as refusals with no reason, and `suggest --write` holds them back like the commands the classifier judged unsafe.
- When the classifier's model answers "overloaded", Claude Code asks it five times and then your session's own model five times, and the refusal names the session's model. `cost` says so.
- Zero tokens for the tool. The skill is user-only, adds nothing to a request that does not use it, and hands the model a report of at most 17 lines.

[1.1.1]: https://github.com/nrzz/claude-automode-doctor/releases/tag/v1.1.1
[1.1.0]: https://github.com/nrzz/claude-automode-doctor/releases/tag/v1.1.0
[1.0.0]: https://github.com/nrzz/claude-automode-doctor/releases/tag/v1.0.0
