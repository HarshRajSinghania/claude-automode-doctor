// What a recorded decision means: who made it and what came out. The mapping is what the real binary wrote when it was
// made to take each kind of decision (README "What was verified, and how"), plus the texts the documentation and the
// issue threads show for the cases a fake API cannot reach (the server's review, a context window that is too small).
//
//   source   static      the command was approved by looking at it: read-only, or covered by an allow rule (reasonType subcommandResults)
//            mode        the permission mode approved it (file edits and reads in the working folder; refused in dontAsk)
//            rule        a permission rule matched (allow, ask or deny)
//            classifier  auto mode's classifier decided
//            hook        a PreToolUse hook decided
//            user        a person answered a prompt, or nobody could (claude -p cannot ask)
//            unrecorded  the transcript has no permissionDecision (older Claude Code, or a tool that records none)
//   result   allowed | refused | no-verdict   (no-verdict only for the classifier: it did not judge the action)

export const SOURCES = ["static", "mode", "rule", "classifier", "hook", "user", "unrecorded"];

// The texts of a classifier that gave no verdict. Each is a sentence Claude Code puts in front of the model; the first
// five were seen on 2.1.299 by making a fake API fail in each way, the last two are quoted from the documentation.
const NO_VERDICT = [
  { re: /is temporarily unavailable(?: \(([^)]+)\))?, so auto mode cannot determine the safety of/, cause: "unavailable", service: true },
  { re: /The server-side auto mode classifier gave no verdict(?: \(([^)]+)\))?/, cause: "server-no-verdict", service: true },
  { re: /Stage 2 classifier error - blocking based on stage 1 assessment/, cause: "stage-two-error", service: true },
  { re: /Auto mode could not evaluate this action and is blocking it for safety — a safety check separate from auto mode/, cause: "safety-check", service: false },
  { re: /Auto mode could not evaluate this action and is blocking it for safety/, cause: "unparseable", service: true },
  { re: /Classifier unavailable - blocking for safety/, cause: "unavailable", service: true },
  { re: /classifier transcript (?:exceeded|too long)|exceeded its context window/, cause: "context-window", service: false },
];

export const NO_VERDICT_CAUSES = {
  unavailable: "the classifier model was unavailable",
  "server-no-verdict": "the server's review gave no verdict",
  "stage-two-error": "the second stage of the classifier failed",
  "safety-check": "a safety check refused the classifier's request because of earlier conversation content",
  unparseable: "the classifier's answer could not be read",
  "context-window": "the conversation was too long for the classifier",
};

const BLOCKED = /denied by the Claude Code auto mode classifier\. Reason: /;

/** The reason a classifier refusal gives: { category, reason } where category is the [Rule Name] when there is one. */
export function refusalReason(text) {
  const i = text.search(BLOCKED);
  if (i < 0) return { category: null, reason: null };
  const after = text.slice(i).replace(BLOCKED, "");
  const m = /^\[([^\]]{1,80})\]/.exec(after);
  if (m) return { category: m[1], reason: `[${m[1]}]` };
  const cut = after.search(/\. (?:If you have other tasks|You \*may\*)|\.$/);
  const reason = (cut >= 0 ? after.slice(0, cut) : after.slice(0, 120)).trim();
  return { category: null, reason: reason || null };
}

/** Is this refusal text one of a classifier that did not judge? { cause, service, detail } or null. */
export function noVerdict(text) {
  for (const n of NO_VERDICT) {
    const m = n.re.exec(text);
    if (m) return { cause: n.cause, service: n.service, detail: m[1] || null };
  }
  return null;
}

/**
 * Classify a decision from readDecisions().
 * Returns { source, result, via, category, reason, cause, service, detail }:
 *   via  for the classifier "client" (Claude Code's own requests) or "server" (the review done with the model request)
 */
export function classify(d) {
  const out = { source: "unrecorded", result: d.decision === "accept" ? "allowed" : d.decision === "reject" ? "refused" : "unknown", via: null, category: null, reason: null, cause: null, service: null, detail: null };
  const text = d.text || "";
  const kind = d.kind || "";
  const rt = d.reasonType || "";
  const src = d.permSource || "";

  const classifierDecision = rt === "classifier" || d.classifierBoundary || d.serverReview || /^automode-/.test(kind);
  if (classifierDecision) {
    out.source = "classifier";
    out.via = d.serverReview ? "server" : "client";
    if (d.decision === "accept") { out.result = "allowed"; return out; }
    const nv = noVerdict(text) || (kind === "automode-unavailable" || kind === "automode-parsing-error" ? { cause: kind === "automode-unavailable" ? "unavailable" : "unparseable", service: true, detail: null } : null);
    if (nv) { out.result = "no-verdict"; Object.assign(out, nv); return out; }
    out.result = "refused";
    Object.assign(out, refusalReason(text));
    return out;
  }
  if (!d.decision && !kind) {
    // older Claude Code: no decision recorded; a refusal still starts with the same sentences
    if (d.isError && BLOCKED.test(text)) {
      out.source = "classifier"; out.via = "client";
      const nv = noVerdict(text);
      if (nv) { out.result = "no-verdict"; Object.assign(out, nv); } else { out.result = "refused"; Object.assign(out, refusalReason(text)); }
      return out;
    }
    if (d.isError && noVerdict(text)) { out.source = "classifier"; out.via = "client"; out.result = "no-verdict"; Object.assign(out, noVerdict(text)); return out; }
    out.result = "unknown";
    return out;
  }
  if (rt === "hook" || src === "hook") { out.source = "hook"; return out; }
  if (rt === "rule") { out.source = "rule"; return out; }
  if (rt === "mode") { out.source = "mode"; return out; }
  if (rt === "subcommandResults") {
    // accepted: looked at and approved; refused with a permission-rule denial: a deny rule matched a part
    if (d.decision === "reject") { out.source = "rule"; return out; }
    out.source = "static";
    return out;
  }
  if (src.startsWith("user") || kind === "user-rejected") { out.source = "user"; return out; }
  if (kind === "permission-rule") { out.source = "rule"; return out; }
  out.source = d.decision ? "static" : "unrecorded";
  return out;
}

/** Short words for a source and result, for the tables. */
export const SOURCE_TEXT = {
  static: "static approval",
  mode: "permission mode",
  rule: "permission rule",
  classifier: "classifier",
  hook: "hook",
  user: "you",
  unrecorded: "not recorded",
};
