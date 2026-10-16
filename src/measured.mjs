// Figures measured on the real Claude Code binary against a fake API (zero tokens). The lint and `cost` quote them with
// the version and the date, because the classifier's prompt and its built-in rules change between releases. The
// end-to-end checks (test/e2e-claude.test.mjs) measure the same things live; when the binary under test is the version
// recorded here they must agree exactly, and on another version they only have to agree in shape.

export const MEASURED = {
  version: "2.1.299",
  date: "2026-10-16",
  platform: "Windows 11",

  // `claude auto-mode defaults`: how many built-in rules each section has
  builtin: { allow: 17, soft_deny: 72, hard_deny: 1, environment: 21 },

  // The classifier's system prompt without autoMode settings, and how many characters of it a list without
  // "$defaults" removes (the list's own entry added back is not subtracted: one short line)
  prompt: { chars: 140173, blocks: 3, totalSystemChars: 140489 },
  removedChars: { allow: 8002, soft_deny: 64817, hard_deny: 5268, environment: 3551 },

  // The two requests of a classified command, as the fake API received them
  stages: {
    one: { model: "claude-sonnet-5", maxTokens: 64, stopSequence: "</severity>", userChars: 0 },
    two: { model: "claude-sonnet-5", maxTokens: 8192, userChars: 0 },
  },
  // Severity the fake classifier answered at stage one, and what Claude Code did: 5, 10 and 20 were allowed by stage one
  // alone (one request); 30 and above went on to stage two (two requests).
  stageOneClears: { upTo: 20, goesOnFrom: 30 },
  // A classifier that answers something that is not a verdict: attempts before Claude Code gives up
  attempts: { stageOne: 5, stageTwo: 5 },
};

/** Characters divided by four, the estimate every figure in this tool's reports uses. */
export const tokensOf = (chars) => Math.round(chars / 4);
