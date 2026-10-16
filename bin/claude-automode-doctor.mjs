#!/usr/bin/env node
// claude-automode-doctor: what Claude Code's auto mode and its classifier decided, from your transcripts.
// All the work lives in src/cli.mjs; run `claude-automode-doctor --help` for the commands.
import { main } from "../src/cli.mjs";

// `claude-automode-doctor report | head` closes the pipe early: that is not an error.
process.stdout.on("error", (err) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});

process.exitCode = await main(process.argv.slice(2));
