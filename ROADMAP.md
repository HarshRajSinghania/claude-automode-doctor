# Roadmap

What could come next. None of it is promised; all of it is open to contributors. Comment on an issue or start a [discussion](https://github.com/nrzz/claude-automode-doctor/discussions) before a large change.

- `why` takes several commands and prints one verdict each, for the list of commands a project runs all day, with the exit code of the worst verdict. This is [issue #5](https://github.com/nrzz/claude-automode-doctor/issues/5), the open good first issue.
- Hooks in `why`: a `PreToolUse` hook can allow, refuse or ask about a call before anything `why` looks at, and `why` only says that hooks are not read. Read the `hooks` of the settings files, say which hook matches the command, and leave the verdict to the hook's own output, which `why` cannot know.
- The PowerShell rows on more machines: 82 of the 606 rows of `test/auto-table.mjs` are for the PowerShell tool, which Claude Code offers on Windows. They run only there, and they were put to the binary on one Windows 11 machine; CI runs the real-binary checks on Linux and macOS. Run `E2E_CLAUDE=... node --test test/auto-oracle.test.mjs` on a Windows machine of yours and open an issue with any row that differs.
- Fixtures of the server-side review: its answer (`safeguard_results`) was read from the binary and played by the fake API; it was not recorded from the service. Someone whose account has the review switched on can record the three outcomes (not flagged, flagged, skipped) with `test/record-fixtures.mjs` and send the scrubbed transcript lines.
- Managed settings from a macOS profile and from the Windows registry. They are not files, so reading them means starting `defaults` or `reg`, which the tool does not do; it would be an option that is off by default.
