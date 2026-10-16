// The report: every tool decision in the transcripts of a config folder, with its source, counted per source, per day
// and per session, and the commands the classifier refused and the refusals that were no verdict.
//
// Days are UTC dates (the timestamps in a transcript are UTC). Nothing is written and nothing is sent anywhere.
import { ASKED_INSTEAD, classify } from "./decisions.mjs";
import { readDecisions, transcriptFiles } from "./transcripts.mjs";

const DAY = 86400000;

const blank = () => ({ total: 0, allowed: 0, refused: 0, noVerdict: 0, unknown: 0 });
function count(c, r) {
  c.total++;
  if (r.result === "allowed") c.allowed++;
  else if (r.result === "refused") c.refused++;
  else if (r.result === "no-verdict") c.noVerdict++;
  else c.unknown++;
}

/** A command or path cut for a report: the first line, at most `max` characters. */
export function cut(text, max = 200) {
  if (text === null || text === undefined) return null;
  const one = String(text).split(/\r?\n/);
  const first = one[0];
  const clipped = first.length > max ? `${first.slice(0, max - 3)}...` : first;
  return one.length > 1 && clipped.length <= max - 4 ? `${clipped} ...` : clipped;
}

/**
 * Build the report.
 *   configDir  the folder that holds projects/
 *   project    a folder: only its transcripts (and those of folders below it); null = every project
 *   days       the window (default 30): a number of days, or a date (YYYY-MM-DD) to start on, in UTC (00:00);
 *              a transcript file not touched in that time is not opened
 *   session    a session id or the start of one: only that session
 *   now        the clock (tests)
 *   limit      how many decisions the JSON keeps (default 2000, the latest ones)
 */
export function buildReport({ configDir, project = null, days = 30, session = null, now = Date.now(), limit = 2000 }) {
  // a date counts from the start of that day in UTC; a number of days counts from now, as it always has
  const date = typeof days === "string" ? days : null;
  const sinceMs = date === null ? now - days * DAY : Date.parse(`${date}T00:00:00.000Z`);
  const files = transcriptFiles({ configDir, project, all: !project, sinceMs });
  const seen = new Set();
  const decisions = [];
  for (const t of files) {
    for (const d of readDecisions(t.file, { sinceMs })) {
      if (session && !d.session.startsWith(session)) continue;
      // a resumed session can repeat the lines of the one it continues
      const key = `${d.session}|${d.id}|${d.ts}`;
      if (seen.has(key)) continue;
      seen.add(key);
      decisions.push({ ...d, ...classify(d) });
    }
  }
  decisions.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

  const sources = {};
  const byDay = new Map();
  const bySession = new Map();
  const byMode = {};
  const refused = new Map();
  const noVerdict = new Map();
  const tools = {};
  const classifier = { total: 0, allowed: 0, refused: 0, noVerdict: 0, client: 0, server: 0 };
  for (const d of decisions) {
    const s = (sources[d.source] ||= blank());
    count(s, d);
    const day = (d.ts || "").slice(0, 10) || "unknown";
    const dayRow = byDay.get(day) || { day, ...blank(), classifier: { allowed: 0, refused: 0, noVerdict: 0 } };
    byDay.set(day, dayRow);
    count(dayRow, d);
    const sessRow = bySession.get(d.session) || { id: d.session, project: d.cwd, first: d.ts, last: d.ts, version: d.version, ...blank(), classifier: { allowed: 0, refused: 0, noVerdict: 0 } };
    bySession.set(d.session, sessRow);
    count(sessRow, d);
    if (d.ts && (!sessRow.first || d.ts < sessRow.first)) sessRow.first = d.ts;
    if (d.ts && d.ts > sessRow.last) sessRow.last = d.ts;
    if (d.version) sessRow.version = d.version;
    byMode[d.mode || "unknown"] = (byMode[d.mode || "unknown"] || 0) + 1;
    const tool = (tools[d.tool] ||= blank());
    count(tool, d);
    if (d.source === "classifier") {
      classifier.total++;
      if (d.result === "allowed") { classifier.allowed++; dayRow.classifier.allowed++; sessRow.classifier.allowed++; }
      else if (d.result === "refused") { classifier.refused++; dayRow.classifier.refused++; sessRow.classifier.refused++; }
      else if (d.result === "no-verdict") { classifier.noVerdict++; dayRow.classifier.noVerdict++; sessRow.classifier.noVerdict++; }
      if (d.via === "server") classifier.server++; else classifier.client++;
      const subject = d.subject === null ? `(${d.tool})` : cut(d.subject, 500);
      if (d.result === "refused") {
        const k = `${d.tool}\u0000${subject}`;
        // asked: how many of the refusals were Claude Code asking instead (the third in a row); the category and the reason are
        // the latest judged refusal's, since an asked-instead line carries none
        const r = refused.get(k) || { tool: d.tool, subject, count: 0, asked: 0, category: d.fallback ? null : d.category, reason: d.fallback ? null : d.reason, last: d.ts, judgedLast: d.fallback ? "" : d.ts, sessions: new Set() };
        r.count++;
        if (d.fallback) r.asked++;
        else if (d.ts > r.judgedLast) { r.judgedLast = d.ts; r.category = d.category; r.reason = d.reason; }
        if (d.ts > r.last) r.last = d.ts;
        r.sessions.add(d.session);
        refused.set(k, r);
      } else if (d.result === "no-verdict") {
        const k = `${d.tool}\u0000${subject}`;
        const r = noVerdict.get(k) || { tool: d.tool, subject, count: 0, cause: d.cause, detail: d.detail, service: d.service, serviceCount: 0, last: d.ts, causes: {}, sessions: new Set() };
        r.count++;
        r.causes[d.cause] = (r.causes[d.cause] || 0) + 1;
        if (d.service) r.serviceCount++;
        if (d.ts > r.last) { r.last = d.ts; r.cause = d.cause; r.detail = d.detail; r.service = d.service; }
        r.sessions.add(d.session);
        noVerdict.set(k, r);
      }
    }
  }
  const finish = (m) => [...m.values()].map((r) => ({ ...r, sessions: r.sessions.size })).sort((a, b) => b.count - a.count || (a.last < b.last ? 1 : -1));
  const days_ = [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
  const sessions = [...bySession.values()].sort((a, b) => (a.last < b.last ? 1 : -1));
  const first = decisions.length ? decisions[0].ts : null;
  const last = decisions.length ? decisions[decisions.length - 1].ts : null;
  const notes = [];
  const unrecorded = (sources.unrecorded && sources.unrecorded.total) || 0;
  if (unrecorded) notes.push(`${unrecorded} decisions have no permissionDecision in their transcript line (an older Claude Code, or a tool that records none), so their source is not known`);
  return {
    configDir, project, window: { days: date === null ? days : Math.ceil((now - sinceMs) / DAY), since: new Date(sinceMs).toISOString().slice(0, 10), until: new Date(now).toISOString().slice(0, 10), first, last, date },
    session, files: files.length, total: decisions.length, sources, classifier, tools, modes: byMode, days: days_, sessions,
    refused: finish(refused).map(({ judgedLast, ...r }) => ({ ...r, reason: r.asked === r.count ? ASKED_INSTEAD : r.reason })), noVerdict: finish(noVerdict),
    decisions: (limit > 0 ? decisions.slice(-limit) : []).map((d) => ({ ts: d.ts, day: (d.ts || "").slice(0, 10), session: d.session, project: d.cwd, mode: d.mode, tool: d.tool, subject: cut(d.subject, 500), source: d.source, result: d.result, via: d.via, category: d.category, reason: d.reason, fallback: d.fallback, cause: d.cause, service: d.service, permission: d.decision ? { decision: d.decision, source: d.permSource, reasonType: d.reasonType, kind: d.kind } : null })),
    truncated: limit > 0 && decisions.length > limit, notes,
  };
}
