# Contributing to claude-automode-doctor

Thanks for helping. claude-automode-doctor is a CLI and a Claude Code plugin with one user-only skill, part of the [Claude Code toolkit](https://github.com/nrzz/claude-code-toolkit). The bar for a change is the bar the code already meets: it works on Windows, macOS and Linux, it is tested, and it never wastes anyone's tokens.

## Start here

- **Good first issues:** [the issues labelled good first issue](https://github.com/nrzz/claude-automode-doctor/issues?q=is%3Aopen+label%3A%22good+first+issue%22), and the ideas in [ROADMAP.md](ROADMAP.md).
- **Questions and ideas:** [Discussions](https://github.com/nrzz/claude-automode-doctor/discussions).
- **Bugs:** [open an issue](https://github.com/nrzz/claude-automode-doctor/issues/new/choose) with the Claude Code version (`claude --version`), your OS, `node --version`, and the exact command and output. For a wrong answer from `why`, add the command and the settings that make it (a few lines) and what Claude Code did with the command; that pair is the test case. For a wrong reading of a transcript, add the transcript lines of the one tool call, with anything private removed.

## Set up

There is nothing to install: the project has no dependencies.

```bash
git clone https://github.com/nrzz/claude-automode-doctor
cd claude-automode-doctor
npm test
```

- `node bin/claude-automode-doctor.mjs why "git push" --project <a project>` says whether a command goes to the classifier, `report` what auto mode decided in your transcripts.
- `E2E_CLAUDE=claude node --test test/e2e-claude.test.mjs test/e2e-automode.test.mjs test/e2e-plugin.test.mjs test/e2e-suggest.test.mjs test/auto-oracle.test.mjs` also puts the tool's claims about Claude Code to the real binary (see below).
- Point `CLAUDE_CONFIG_DIR`, `HOME` and `USERPROFILE` at a temporary folder whenever you run the tool, the tests or `claude` by hand; the tests do it for themselves. Your transcripts hold your commands: never copy one into a test, a fixture or an issue without reading it first.

## Where things are

| Path | What it holds |
| --- | --- |
| `bin/claude-automode-doctor.mjs` | the CLI entry |
| `src/cli.mjs` | the options, the help, the exit codes |
| `src/commands.mjs`, `src/render.mjs` | the commands as plain objects; the text, markdown and JSON reports |
| `src/transcripts.mjs`, `src/decisions.mjs`, `src/aggregate.mjs` | reading the tool decisions from the transcripts; who made each and what came out; counting them |
| `src/settings.mjs`, `src/show.mjs`, `src/rulefiles.mjs` | finding and reading the settings that decide what auto mode does, and where each part came from; path-scoped rule files |
| `src/automode.mjs`, `src/lint.mjs` | what Claude Code does with the `autoMode` block and with allow rules; the lint, with what each finding rests on |
| `src/why.mjs`, `src/engine/` | why a command goes to the classifier or not; the decision engine copied from claude-permission-doctor, with its provenance in each file |
| `src/suggest.mjs`, `src/write.mjs`, `src/jsonedit.mjs` | allow rules for what the classifier turned back; the only code that writes (backups, atomic writes, restore); editing a JSON list by its text |
| `src/cost.mjs`, `src/measured.mjs` | what classifying a command costs; the figures measured on the real binary, with the version and the date |
| `src/jsonc.mjs` | reading JSON with comments by its text (copied from claude-settings-doctor) |
| `skills/check/`, `.claude-plugin/` | the user-only skill; the plugin manifest and icon |
| `test/*.test.mjs` | unit tests; the `e2e-*.test.mjs` files and `auto-oracle.test.mjs` run against the real binary when `E2E_CLAUDE` is set |
| `test/auto-table.mjs` | the commands `why` is held to, each with what the binary did with it (`auto-table.test.mjs` offline, `auto-oracle.test.mjs` against the binary) |
| `test/scenarios.mjs`, `test/fixtures/` | the decision shapes, each run against the binary; the three transcript lines of each, recorded by `test/record-fixtures.mjs` |
| `test/claude-sandbox.mjs` | the fake Messages API and the way the binary is started |

## House rules

1. **No dependencies.** Node built-ins only, Node 18 or newer, ES modules (`.mjs`). A pull request that adds a package to `dependencies` will not be merged. Nothing in `src/` or `bin/` may start a process or open a network connection, and only `src/write.mjs` may write a file; a test fails otherwise.
2. **Every change comes with a test**, and `npm test` passes. CI runs the suite on Windows, macOS and Linux with Node 20, 22 and 24, and on Linux with Node 18, and the real-binary checks on Linux and macOS; a change that only works on one of them is not done.
3. **The binary is right.** `why` and the lint say what Claude Code does because the real binary was put to it. When `why` is wrong, add the command (and the settings) to `test/auto-table.mjs` with what Claude Code does with it, run `E2E_CLAUDE=... node --test test/auto-oracle.test.mjs`, fix the engine or the overlay in `src/why.mjs`, and say so in the README's "What was verified". Do not change a row to make a test pass without running it against the binary. A statement that rests only on the documentation or on an issue thread is marked as such in the lint and listed in "Not verified".
4. **Token cost is a feature.** The tool runs outside Claude; the one skill is user-only and its report is capped. If your change puts anything new in front of Claude, say how many tokens in the pull request and update the README's "What it costs in tokens".
5. **Settings files are the user's.** Whatever writes one backs it up first, next to it; changes only what it is there for (`permissions.allow`); leaves a file that is not valid JSON alone; offers `--dry-run`; and can be undone with `restore`.
6. **Never touch real user data in tests.** Use a temporary folder and point `CLAUDE_CONFIG_DIR`, `HOME` and `USERPROFILE` at it, in the same command, whenever you run the tool, `claude` or anything else that reads them. `test/helpers.mjs` points every way the tool finds a config folder at a throwaway one the moment it loads. The commands in the table never name a real system path that a mistaken approval could damage, and the fake classifier refuses by default, so a command that reaches it does not run.
7. **Keep the README honest.** Its "What was verified, and how" and "Not verified" sections say what was checked and what was not. If your change affects either, update it in the same pull request. `test/repo.test.mjs` checks the numbers the README quotes against the code.

## The real-binary checks

`test/claude-sandbox.mjs` starts a fake Messages API on 127.0.0.1 and runs the real Claude Code binary against it, in a throwaway folder, with a throwaway `HOME`, `USERPROFILE` and `CLAUDE_CONFIG_DIR` and an environment with none of your `CLAUDE_*` and `ANTHROPIC_*` variables. The fake answers the conversation with the tool calls a check names, and the classifier's requests with the verdict a check names. No model is reached and nothing leaves your machine.

```bash
E2E_CLAUDE=/path/to/claude node --test test/e2e-claude.test.mjs test/e2e-automode.test.mjs test/e2e-plugin.test.mjs test/e2e-suggest.test.mjs test/auto-oracle.test.mjs
```

- `e2e-claude.test.mjs` runs every scenario of `test/scenarios.mjs`: what the transcript, the JSON result and the fake API show, and what `report` says about the line.
- `e2e-automode.test.mjs` puts the `autoMode` block to it (`$defaults`, which files are read, wrong types), the request sizes `cost` quotes, and the issue-thread claims the lint repeats.
- `e2e-plugin.test.mjs` checks the plugin: the skill adds nothing to other requests, hands the model the report, and costs what the README says.
- `e2e-suggest.test.mjs` checks `report` over a real session and `suggest` end to end.
- `auto-oracle.test.mjs` puts every row of the table to the binary. On the versions the table was recorded with (the README says which) every row must match; on a newer version the core rows must match and at least 95% of all rows, because Claude Code changes.

To record the fixtures again: `RECORD_FIXTURES=1 E2E_CLAUDE=... node test/record-fixtures.mjs [scenario ...]`. It writes only inside `test/fixtures/`, and the files hold no system prompt, no user text and no path of your machine.

## Pull requests

- One logical change per pull request, with its test. Commit messages in the imperative mood ("Name the service when a refusal was no verdict").
- Fill in the pull request template; CI must be green on every job.
- Signed commits are welcome but not required.
- Plain, specific writing in docs, messages and comments.

## Releases (maintainers)

Bump the version in `src/version.mjs`, `package.json` and `.claude-plugin/plugin.json` (`npm test` fails until every copy agrees), add a section to [CHANGELOG.md](CHANGELOG.md), tag `vX.Y.Z` and publish a GitHub release with the changelog section as its notes.

## Conduct and security

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). Report security problems privately, as [SECURITY.md](SECURITY.md) describes, never in a public issue.
