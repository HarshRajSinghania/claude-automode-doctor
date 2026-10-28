# Changelog

All notable changes to claude-automode-doctor are written here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

- `why`: accept `--file <path>` to read commands from a text file (one per line, comments and blanks skipped). File commands come first, then any on the command line. Usage errors for missing, empty, or repeated `--file`.
- Contributed by Harsh Raj Singhania in a pull request for the good first issue #7.

## [1.2.0] - 2026-10-28

- `why`: accept several commands; print one block each separated by a blank line, return `{ ok, commands }` with `--json`, and exit with the worst of the verdicts.
- Contributed by [@yoreva-01](https://github.com/yoreva-01) in [#6](https://github.com/nrzz/claude-automode-doctor/pull/6), for the good first issue [#5](https://github.com/nrzz/claude-automode-doctor/issues/5).
- The README's test count is the runner's again: 205 automated tests (212 with the 7 helper files), 151 passing on Windows and 150 on Linux and macOS without a binary. It had said 204 before the pull request's new test.

## [1.1.1] - 2026-10-17

- `report --markdown --since YYYY-MM-DD` names the requested date in its summary (`since 2026-10-12 (UTC)`) instead of converting it to a day count, as the text report has since 1.1.0. Numeric windows keep their wording, and the report still has at most 17 lines and exits 0.
- Contributed by [@slophisticated](https://github.com/slophisticated) in [#4](https://github.com/nrzz/claude-automode-doctor/pull/4), for the good first issue [#3](https://github.com/nrzz/claude-automode-doctor/issues/3).

## [1.1.0] - 2026-10-16

- `--since` takes a date as well as a number of days: `--since 2026-10-01` is from the start of that day in UTC.
- The report, cost and suggest name the window they used.
- A date in the future, or one that is not a date, is a usage error.
