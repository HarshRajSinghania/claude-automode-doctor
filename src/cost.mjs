// What classifying a command costs, from the sizes of the requests Claude Code was seen to send (src/measured.mjs, put
// there from a live capture with a fake API, and checked by test/e2e-claude.test.mjs against the binary under test),
// and, when the transcripts are given, how many commands were classified that way in the window.
//
// Tokens here are characters divided by four, an estimate and not a count by Claude's tokenizer. Who is billed is what
// the documentation says; this tool cannot see an invoice.
import { MEASURED, tokensOf } from "./measured.mjs";

export const BILLING_URL = "https://code.claude.com/docs/en/auto-mode-classifier-billing";

/**
 * The cost model. `report` is the result of buildReport() or null.
 * Returns { measured, stages, perCommand, billing, transcripts }.
 */
export function buildCost({ report = null } = {}) {
  const m = MEASURED;
  const stageOne = { stage: 1, model: m.stages.one.model, maxTokens: m.stages.one.maxTokens, systemChars: m.prompt.totalSystemChars, userChars: m.stages.one.userChars, requestChars: m.prompt.totalSystemChars + m.stages.one.userChars };
  const stageTwo = { stage: 2, model: m.stages.two.model, maxTokens: m.stages.two.maxTokens, systemChars: m.prompt.totalSystemChars, userChars: m.stages.two.userChars, requestChars: m.prompt.totalSystemChars + m.stages.two.userChars };
  for (const s of [stageOne, stageTwo]) { s.systemTokens = tokensOf(s.systemChars); s.requestTokens = tokensOf(s.requestChars); }
  const perCommand = {
    requestsLow: 1, requestsHigh: 2,
    tokensLow: stageOne.requestTokens, tokensHigh: stageOne.requestTokens + stageTwo.requestTokens,
    note: `One request when stage one is sure the command is routine (it allowed severities up to ${m.stageOneClears.upTo}); two when it is not (it went on to stage two from ${m.stageOneClears.goesOnFrom}). A classifier that answers something that is not a verdict is asked up to ${m.attempts.stageOne} times at stage one and ${m.attempts.stageTwo} at stage two. A classifier model that answers with an error (overloaded) is asked ${m.attempts.stageOne} times, then your session's own model ${m.fallback.attempts} times (max_tokens ${m.fallback.maxTokens.toLocaleString("en-US")}); the refusal then names your model, not the classifier's.`,
  };
  const transcripts = report ? {
    window: report.window, classified: report.classifier.total, client: report.classifier.client, server: report.classifier.server,
    requestsLow: report.classifier.client * perCommand.requestsLow, requestsHigh: report.classifier.client * perCommand.requestsHigh,
    tokensLow: report.classifier.client * perCommand.tokensLow, tokensHigh: report.classifier.client * perCommand.tokensHigh,
  } : null;
  return {
    measured: { version: m.version, date: m.date, platform: m.platform },
    stages: [stageOne, stageTwo],
    perCommand,
    prompt: { chars: m.prompt.chars, blocks: m.prompt.blocks, cached: "The large block of the system prompt carries cache_control \"ephemeral\", so prompt caching can apply; the fake API cannot show whether it did" },
    billing: {
      notice: "Claude Code prints a notice that classifier requests are no longer charged on a direct connection, and that a session whose requests go through another host is not eligible",
      url: BILLING_URL,
      says: [
        "where the server reviews the actions as part of the session's own model requests (a direct connection to the Anthropic API), there are no separate classifier requests and no charge for them",
        "when the server's checks do not reach the session (a gateway or proxy in the way, a platform that does not have them yet), Claude Code makes its own classifier requests, and on accounts where those are billed they count toward token usage",
      ],
      source: "documentation; this tool cannot see an invoice, and the fake API cannot play a direct connection",
    },
    transcripts,
  };
}
