// The settings that decide what auto mode does, merged the way Claude Code merges them, with the file each part came
// from. Two places, and they work differently:
//
//   autoMode      read from the user's settings and from managed settings only. A block in a project or local file is
//                 ignored; it is listed here with the file and line so that nobody wonders. How the lists of two sources
//                 combine is the documentation's account (additive); the binary was put to the user file alone.
//   permissions   allow, ask and deny rules are joined over all the files that apply; a single value (defaultMode,
//                 disableAutoMode, blockReadsOutsideWorkingDirectories) comes from the highest file that sets it.
import { splitRule } from "./engine/rule.mjs";
import { AUTOMODE_SCOPES } from "./settings.mjs";
import { DEFAULTS, LISTS, droppedInAutoMode, effectiveList, replacesDefaults } from "./automode.mjs";
import { MEASURED } from "./measured.mjs";

function fileState(f) {
  if (!f.exists) return { state: "not found", detail: "" };
  if (f.error && /^cannot be read/.test(f.error)) return { state: "unreadable", detail: f.error };
  if (f.ignored) return { state: "ignored", detail: f.ignored.reason === "not-json" ? `Claude Code ignores the whole file: it has ${f.ignored.detail}${f.ignored.line ? ` (line ${f.ignored.line})` : ""}` : `Claude Code ignores the whole file: ${f.ignored.detail}${f.ignored.line ? ` (line ${f.ignored.line})` : ""}` };
  if (f.analysis && f.analysis.empty) return { state: "empty", detail: "" };
  return { state: "read", detail: "" };
}

/** The merged view. `settings` is the result of loadSettings(). */
export function buildShow(settings) {
  const files = settings.files.map((f) => {
    const st = fileState(f);
    const am = f.view && f.view.autoMode;
    return {
      scope: f.scope, label: f.label, path: f.path, display: f.display, rank: f.rank, exists: f.exists, ...st,
      autoMode: am ? { line: am.line, read: AUTOMODE_SCOPES.has(f.scope) && !f.ignored } : null,
      rules: f.view && f.view.permissions ? { allow: f.view.permissions.allow.length, ask: f.view.permissions.ask.length, deny: f.view.permissions.deny.length } : { allow: 0, ask: 0, deny: 0 },
    };
  });
  const live = settings.files.filter((f) => !f.ignored && f.exists && f.data);

  // ---- autoMode ------------------------------------------------------------------------------------------------------
  const sources = live.filter((f) => AUTOMODE_SCOPES.has(f.scope) && f.view.autoMode);
  const managedInvolved = sources.some((f) => f.scope === "managed");
  const lists = {};
  for (const key of LISTS) {
    const contributions = [];
    for (const f of sources) {
      const l = f.view.autoMode.lists[key];
      if (!l) continue;
      const texts = l.items.map((i) => i.text);
      contributions.push({ scope: f.scope, display: f.display, path: f.path, line: l.line, items: l.items, hasDefaults: texts.includes(DEFAULTS), replaces: replacesDefaults(texts), empty: texts.length === 0 });
    }
    const userOnly = contributions.length === 0 || (contributions.length === 1 && contributions[0].scope === "user");
    const mine = contributions.find((c) => c.scope === "user");
    const builtin = MEASURED.builtin[key];
    const effective = userOnly ? effectiveList(mine ? mine.items.map((i) => i.text) : []) : null;
    const replaced = effective ? !effective.some((e) => e.defaults) : null;
    lists[key] = {
      contributions, replacesDefaults: contributions.some((c) => c.replaces),
      effective: effective ? effective.map((e) => (e.defaults ? { defaults: true, count: builtin, version: MEASURED.version } : { text: e.text, from: mine.display })) : null,
      builtinReplaced: replaced, builtinCount: builtin,
    };
  }
  const cas = sources.map((f) => ({ f, c: f.view.autoMode.classifyAllShell })).filter((x) => x.c && x.c.value === true).sort((a, b) => b.f.rank - a.f.rank)[0];
  const casAny = sources.map((f) => ({ f, c: f.view.autoMode.classifyAllShell })).filter((x) => x.c).sort((a, b) => b.f.rank - a.f.rank)[0];
  const classifyAllShell = casAny ? { value: casAny.c.value, scope: casAny.f.scope, display: casAny.f.display, line: casAny.c.line, anotherSets: Boolean(cas && cas !== casAny) } : null;
  const ignoredCopies = live.filter((f) => !AUTOMODE_SCOPES.has(f.scope) && f.view.autoMode).map((f) => ({ scope: f.scope, display: f.display, path: f.path, line: f.view.autoMode.line, keys: Object.keys(f.view.autoMode.value && typeof f.view.autoMode.value === "object" ? f.view.autoMode.value : {}) }));
  const notes = [];
  if (managedInvolved) notes.push("managed settings set autoMode: Claude Code combines their entries with the user's (the documentation says they are added; the binary was not put to a managed file), so the lists below are shown by file and no combined list is computed");

  // ---- permissions ---------------------------------------------------------------------------------------------------
  const rules = { allow: [], ask: [], deny: [] };
  for (const behavior of ["allow", "ask", "deny"]) {
    const byRaw = new Map();
    for (const f of live) {
      if (!f.view.permissions) continue;
      for (const item of f.view.permissions[behavior]) {
        const sp = splitRule(item.raw);
        const where = { scope: f.scope, display: f.display, path: f.path, line: item.line };
        const have = byRaw.get(item.raw);
        if (have) { have.also.push(where); continue; }
        const entry = { raw: item.raw, tool: sp.tool, content: sp.content, ...where, also: [], droppedInAutoMode: behavior === "allow" ? droppedInAutoMode(sp.tool, sp.content) : false };
        byRaw.set(item.raw, entry);
        rules[behavior].push(entry);
      }
    }
  }
  const single = (pick) => {
    const found = live.map((f) => ({ f, v: f.view.permissions && f.view.permissions[pick] })).filter((x) => x.v);
    if (!found.length) return null;
    const win = found[0];
    return { value: win.v.value, scope: win.f.scope, display: win.f.display, line: win.v.line, shadowed: found.slice(1).map((x) => ({ value: x.v.value, scope: x.f.scope, display: x.f.display, line: x.v.line })) };
  };
  const permissions = {
    defaultMode: single("defaultMode"), disableAutoMode: single("disableAutoMode"), blockReads: single("blockReads"),
    additionalDirectories: live.flatMap((f) => (f.view.permissions ? f.view.permissions.additionalDirectories.map((d) => ({ value: d.value, display: f.display, line: d.line })) : [])),
    rules,
  };
  return {
    project: settings.project, configDir: settings.configDir, files,
    autoMode: { readFrom: ["user", "managed"], lists, classifyAllShell, ignoredCopies, notes },
    permissions,
    notRead: [
      "server-managed settings, macOS profiles and the Windows registry (only managed-settings.json and managed-settings.d are read)",
      "the --settings flag, which can carry an autoMode block of its own, and the --setting-sources flag",
      "hooks and mods, which can decide a call before the permission rules and the classifier",
    ],
  };
}
