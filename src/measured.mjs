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

  // The classifier's system prompt without autoMode settings, and how many characters of the built-in rules (line breaks included) a
  // list without "$defaults" takes out of it
  prompt: { chars: 140173, blocks: 3, totalSystemChars: 140489 },
  removedChars: { allow: 8019, soft_deny: 64833, hard_deny: 5284, environment: 3566 },

  // The two requests of a classified command, as the fake API received them. The system prompt is three blocks; the last one
  // (242 characters) names the operating system user, so the total differs by a few characters between machines. userChars is the user
  // message of a session of one prompt ("run it") and one command, which grows with the session.
  stages: {
    one: { model: "claude-sonnet-5", maxTokens: 64, stopSequence: "</severity>", userChars: 299 },
    two: { model: "claude-sonnet-5", maxTokens: 8192, userChars: 530 },
  },
  // Severity the fake classifier answered at stage one, and what Claude Code did: up to 25 was allowed by stage one
  // alone (one request); 26 and above went on to stage two (two requests).
  stageOneClears: { upTo: 25, goesOnFrom: 26 },
  // A classifier that answers something that is not a verdict: attempts before Claude Code gives up
  attempts: { stageOne: 5, stageTwo: 5 },
  // A classifier model that answers with an error (529): the five requests to it are followed by this many to the model of the
  // session itself, with this max_tokens, and the refusal names that model
  fallback: { attempts: 5, maxTokens: 2112 },
};

/** Characters divided by four, the estimate every figure in this tool's reports uses. */
export const tokensOf = (chars) => Math.round(chars / 4);
