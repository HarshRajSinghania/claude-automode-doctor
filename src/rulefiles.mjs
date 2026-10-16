// Path-scoped rule files: <project>/.claude/rules/*.md and <config folder>/rules/*.md whose front matter has `paths:`.
// Claude Code loads such a file when Claude uses Read, Write or Edit on a file that matches one of the globs (the
// InstructionsLoaded hook sees load_reason "path_glob_match"). Reading only; nothing here writes.
import fs from "node:fs";
import path from "node:path";

const MAX_FILES = 300;
const MAX_DEPTH = 6;

function walk(dir, depth, out) {
  if (out.length >= MAX_FILES || depth > MAX_DEPTH) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, depth + 1, out);
    else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) out.push(p);
    if (out.length >= MAX_FILES) return;
  }
}

/** The globs a rule file's front matter names under `paths`, or [] when it has none. */
export function pathsOf(text) {
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(t);
  if (!m) return [];
  const lines = m[1].split(/\r?\n/);
  const unquote = (s) => s.trim().replace(/^(['"])(.*)\1$/, "$2");
  for (let i = 0; i < lines.length; i++) {
    const k = /^paths[ \t]*:[ \t]*(.*)$/.exec(lines[i]);
    if (!k) continue;
    const rest = k[1].trim();
    if (rest.startsWith("[")) return rest.replace(/^\[|\]$/g, "").split(",").map(unquote).filter(Boolean);
    if (rest) return rest.split(",").map(unquote).filter(Boolean);
    const globs = [];
    for (let j = i + 1; j < lines.length; j++) {
      const item = /^[ \t]*-[ \t]+(.*)$/.exec(lines[j]);
      if (item) globs.push(unquote(item[1]));
      else if (lines[j].trim() !== "" && !/^[ \t]*#/.test(lines[j])) break;
    }
    return globs.filter(Boolean);
  }
  return [];
}

/** Rule files with `paths:` front matter: [{ scope, path, globs }]. */
export function pathScopedRuleFiles({ project, configDir }) {
  const found = [];
  for (const [scope, dir] of [["project", path.join(project, ".claude", "rules")], ["user", path.join(configDir, "rules")]]) {
    const files = [];
    walk(dir, 0, files);
    for (const file of files) {
      let text = "";
      try { text = fs.readFileSync(file, "utf8").slice(0, 8192); } catch { continue; }
      const globs = pathsOf(text);
      if (globs.length) found.push({ scope, path: file, globs });
    }
  }
  return found;
}
