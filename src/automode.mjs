// What Claude Code does with the `autoMode` settings block and with allow rules while auto mode is on.
//
// Every statement here was put to the real binary (README "What was verified, and how"); the ones that were
// only read in the documentation or in an issue are named as such in the README's "Not verified".
//
//   * Claude Code reads autoMode from the user's settings.json and from managed settings. The block in a project's
//     .claude/settings.json or .claude/settings.local.json is ignored (`claude auto-mode config` ignores it).
//   * allow, soft_deny, hard_deny and environment are lists of strings. A list without the literal "$defaults"
//     replaces the built-in list of that section; with it, the built-in rules are spliced in at that place.
//     An empty list changes nothing.
//   * A value of the wrong type anywhere in the block makes Claude Code ignore the WHOLE settings file, with
//     everything else in it. A key it does not know inside the block is ignored without a word.
//   * Narrow allow rules still skip the classifier in auto mode; broad ones are dropped when auto mode starts.

export const LISTS = ["allow", "soft_deny", "hard_deny", "environment"];
export const DEFAULTS = "$defaults";
export const BLOCK_KEYS = [...LISTS, "classifyAllShell"];

/** The nearest key of the block for a key that is not one (the typos the issue threads show). */
const NEAR = {
  softdeny: "soft_deny", soft_block: "soft_deny", softblock: "soft_deny", "soft-deny": "soft_deny", soft: "soft_deny",
  harddeny: "hard_deny", hard_block: "hard_deny", hardblock: "hard_deny", "hard-deny": "hard_deny", hard: "hard_deny",
  deny: "soft_deny", block: "soft_deny", blocks: "soft_deny", allowed: "allow", allows: "allow", allowlist: "allow",
  env: "environment", environ: "environment", trusted: "environment",
  classifyallshell: "classifyAllShell", classify_all_shell: "classifyAllShell", classifyall: "classifyAllShell", classifyallbash: "classifyAllShell",
};

export function nearBlockKey(key) {
  const flat = String(key).toLowerCase().replace(/[\s-]/g, "");
  if (BLOCK_KEYS.includes(key)) return key;
  if (NEAR[String(key).toLowerCase()]) return NEAR[String(key).toLowerCase()];
  if (NEAR[flat]) return NEAR[flat];
  for (const k of BLOCK_KEYS) if (k.toLowerCase().replace(/_/g, "") === flat) return k;
  return null;
}

const typeName = (v) => (v === null ? "null" : Array.isArray(v) ? "a list" : typeof v === "string" ? "a string" : typeof v === "number" ? "a number" : typeof v === "boolean" ? "a boolean" : "an object");

/**
 * Check an autoMode value as Claude Code reads it. Returns problems, each { path, kind, message, fatal }:
 *   fatal  true when Claude Code ignores the whole settings file because of it
 * `kind` is wrong-type or unknown-key.
 */
export function checkBlock(value) {
  const problems = [];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    problems.push({ path: ["autoMode"], kind: "wrong-type", fatal: true, message: `autoMode is ${typeName(value)}, and it must be an object with the lists allow, soft_deny, hard_deny and environment, and classifyAllShell` });
    return problems;
  }
  for (const [key, v] of Object.entries(value)) {
    if (LISTS.includes(key)) {
      if (!Array.isArray(v)) {
        problems.push({ path: ["autoMode", key], kind: "wrong-type", fatal: true, message: `autoMode.${key} is ${typeName(v)}, and it must be a list of strings` });
        continue;
      }
      v.forEach((item, i) => {
        if (typeof item !== "string") problems.push({ path: ["autoMode", key, i], kind: "wrong-type", fatal: true, message: `autoMode.${key}[${i}] is ${typeName(item)}, and every entry must be a string` });
      });
    } else if (key === "classifyAllShell") {
      if (typeof v !== "boolean") problems.push({ path: ["autoMode", key], kind: "wrong-type", fatal: true, message: `autoMode.classifyAllShell is ${typeName(v)}, and it must be true or false` });
    } else {
      const near = nearBlockKey(key);
      problems.push({ path: ["autoMode", key], kind: "unknown-key", fatal: false, near, message: `autoMode.${key} is not a key of the block, and Claude Code ignores it without a word${near ? `; did you mean ${near}?` : ""}` });
    }
  }
  return problems;
}

/**
 * Does a list replace the built-in rules? Only a list with something in it and without "$defaults" does; an empty
 * list changes nothing (observed).
 */
export function replacesDefaults(list) {
  return Array.isArray(list) && list.length > 0 && !list.includes(DEFAULTS) && list.every((x) => typeof x === "string");
}

/**
 * The effective list of one section, from the strings of the user's list (managed settings are not modelled here):
 * [{ text, from: "user" }] and one { defaults: true } where the built-in rules go. Without "$defaults" the list
 * is the user's alone; with it, the built-in rules sit at its first place (a second "$defaults" adds nothing).
 */
export function effectiveList(list) {
  if (!Array.isArray(list) || list.length === 0) return [{ defaults: true }];
  const out = [];
  let placed = false;
  for (const text of list) {
    if (text === DEFAULTS) {
      if (!placed) out.push({ defaults: true });
      placed = true;
    } else out.push({ text, from: "settings" });
  }
  return out;
}

// ---- allow rules that auto mode drops ---------------------------------------------------------------------------------
//
// "On entering auto mode, broad allow rules that grant arbitrary code execution are dropped" (docs). The list and the
// test below are what Claude Code 2.1.299 contains (read in the binary and then put to it rule by rule, see
// test/e2e-claude.test.mjs); another version may have a longer or a shorter list.

const SHELLS_AND_RUNNERS = ["python", "python3", "python2", "node", "deno", "tsx", "ruby", "perl", "php", "lua", "npx", "bunx", "npm run", "yarn run", "pnpm run", "bun run", "bash", "sh", "ssh"];
export const BASH_DANGEROUS = [...SHELLS_AND_RUNNERS, "zsh", "fish", "eval", "exec", "env", "xargs", "sudo"];
export const POWERSHELL_DANGEROUS = [...SHELLS_AND_RUNNERS, "pwsh", "powershell", "cmd", "wsl", "iex", "invoke-expression", "icm", "invoke-command", "start-process", "saps", "start", "start-job", "sajb", "start-threadjob", "invoke-wmimethod", "iwmi", "invoke-cimmethod", "icim", "wmic", "register-objectevent", "register-engineevent", "register-wmievent", "register-scheduledjob", "new-pssession", "nsn", "enter-pssession", "etsn", "add-type", "new-object"];

/** Is this Bash rule content one that auto mode drops? `content` is undefined for the bare rule `Bash`. */
export function bashRuleDropped(content) {
  if (content === undefined || content === null || content === "") return true;
  if (/^[\s*]+$/.test(content)) return true;
  const o = String(content).trim().toLowerCase();
  if (o === "*") return true;
  for (const word of BASH_DANGEROUS) {
    const s = word.toLowerCase();
    if (o === s || o === `${s}:*` || o === `${s} *` || o === `${s}*`) return true;
    if (o.startsWith(`${s} `) && o.endsWith("*")) {
      const rest = o.slice(s.length + 1);
      if (rest.startsWith("-")) {
        // `python -m some.module *` is the one narrow form of an option that stays
        const m = rest.slice(0, -1);
        if (!(/^python[\d.]*$/.test(s) && /^-m\s+\w+\.[\w.]+(\s*:|\s+)$/.test(m))) return true;
      }
    }
  }
  return false;
}

/** The same for a PowerShell rule's content. */
export function powershellRuleDropped(content) {
  if (content === undefined || content === null || content === "") return true;
  if (/^[\s*]+$/.test(content)) return true;
  const o = String(content).trim().toLowerCase();
  if (o === "*") return true;
  for (const word of POWERSHELL_DANGEROUS) {
    const s = word.toLowerCase();
    const space = s.indexOf(" ");
    const exe = space === -1 ? `${s}.exe` : `${s.slice(0, space)}.exe${s.slice(space)}`;
    for (const w of [s, exe]) {
      if (o === w || o === `${w}:*` || o === `${w}*` || o === `${w} *`) return true;
      if (o.startsWith(`${w} -`) && o.endsWith("*")) return true;
    }
  }
  return false;
}

/**
 * Does auto mode drop this allow rule? `tool` and `content` are the parts of Tool(content). Only the shell tools'
 * rules are judged here; `Agent` and `Monitor` allow rules are dropped too, and no other tool's rule is.
 */
export function droppedInAutoMode(tool, content) {
  if (tool === "Bash") return bashRuleDropped(content);
  if (tool === "PowerShell") return powershellRuleDropped(content);
  if (tool === "Agent" || tool === "Monitor") return true;
  return false;
}
