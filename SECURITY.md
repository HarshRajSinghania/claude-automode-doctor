# Security policy

## Supported versions

Security fixes go into the latest release on `main`.

## Reporting a vulnerability

Please do not report a vulnerability in a public issue. Use GitHub's private reporting: [https://github.com/nrzz/claude-automode-doctor/security/advisories/new](https://github.com/nrzz/claude-automode-doctor/security/advisories/new), or the contact in the [nrzz security policy](https://github.com/nrzz/.github/blob/master/SECURITY.md). You can expect a first answer within 72 hours, and credit in the release notes if you want it.

## What this tool does, and does not do

It reads the transcripts Claude Code keeps under its config folder (`projects/<project>/<session>.jsonl`, and the subagent transcripts below each session), the Claude Code settings files that apply to a project (`managed-settings.json` and `managed-settings.d/*.json` in the system folder, the user `settings.json` in `$CLAUDE_CONFIG_DIR` or `~/.claude`, the project's `.claude/settings.json` and `.claude/settings.local.json`) and the path-scoped rule files (`.claude/rules/*.md`) that the lint speaks of. It opens no network connection, starts no process and has no telemetry or account.

A transcript holds your prompts, your commands and what they printed. The tool keeps from it what a decision is about: the tool's name, the command or path, the reason the classifier gave, the time and the session. It prints no prompt and no tool output, and it never has the classifier's own prompt: Claude Code does not record that. A command can still hold a secret you typed into it, and `report` prints the commands the classifier refused (and the skill hands that report to Claude when you invoke it), so read a report before you paste it into an issue.

It writes only with `suggest --write` and `restore`: the `permissions.allow` list of the settings file you named with `--user`, `--local` or `--project`. The file is saved next to itself first (`<file>.bak-automode-doctor-<timestamp>`), the rest of it keeps its bytes, a file that is not valid JSON is left alone, and the new file replaces the old one through a temporary file and a rename. `--dry-run` shows the change. `restore` puts the newest backup back and saves the file it replaces first. It never edits managed settings, never edits `~/.claude.json` and never touches a transcript.

`why` and the lint are a reading of what Claude Code did when the real binary was put to it (the README's "What was verified, and how" says which versions, and "Not verified" what rests only on the documentation or an issue thread). They are not a guard. An allow rule that `suggest` proposes makes a command skip the classifier; the tool proposes only rules that auto mode keeps, leaves out the commands the classifier judged unsafe unless you ask with `--include-judged`, and shows each rule before it writes. You decide whether to accept it. A wrong verdict from `why` is a bug and not a vulnerability: report it as an issue.
