// The autoMode block and the allow rules auto mode drops: what src/automode.mjs says, against the cases the real binary was
// put to (test/e2e-claude.test.mjs runs the same shapes against it).
import test from "node:test";
import assert from "node:assert/strict";
import { BASH_DANGEROUS, POWERSHELL_DANGEROUS, bashRuleDropped, checkBlock, droppedInAutoMode, effectiveList, nearBlockKey, powershellRuleDropped, replacesDefaults } from "../src/automode.mjs";
import { RULE_SHAPES } from "./auto-table.mjs";

test("a block of the right shape has no problem; a key it does not know is a warning, not a loss of the file", () => {
  assert.deepEqual(checkBlock({ allow: ["$defaults", "x"], soft_deny: [], hard_deny: ["y"], environment: ["Org: z"], classifyAllShell: true }), []);
  const p = checkBlock({ softDeny: ["x"], deny: [] });
  assert.deepEqual(p.map((x) => [x.kind, x.fatal, x.near]), [["unknown-key", false, "soft_deny"], ["unknown-key", false, "soft_deny"]]);
});

test("a value of the wrong type anywhere in the block makes Claude Code ignore the whole file", () => {
  for (const bad of ["x", 5, true, null, ["x"]]) assert.equal(checkBlock(bad)[0].fatal, true, JSON.stringify(bad));
  for (const bad of [{ allow: "x" }, { allow: [1] }, { allow: ["ok", 3] }, { allow: [{ a: 1 }] }, { soft_deny: "x" }, { hard_deny: null }, { environment: 5 }, { classifyAllShell: "true" }, { classifyAllShell: 1 }, { allow: ["$defaults", 5] }]) {
    const p = checkBlock(bad);
    assert.ok(p.some((x) => x.fatal && x.kind === "wrong-type"), JSON.stringify(bad));
  }
});

test("only a list with entries and no $defaults replaces the built-in rules; an empty list changes nothing", () => {
  assert.equal(replacesDefaults(["x"]), true);
  assert.equal(replacesDefaults(["x", "y"]), true);
  assert.equal(replacesDefaults(["$defaults", "x"]), false);
  assert.equal(replacesDefaults(["x", "$defaults"]), false);
  assert.equal(replacesDefaults([]), false);
  assert.equal(replacesDefaults(undefined), false);
});

test("the effective list puts the built-in rules at the place of $defaults, once", () => {
  assert.deepEqual(effectiveList(undefined), [{ defaults: true }]);
  assert.deepEqual(effectiveList([]), [{ defaults: true }]);
  assert.deepEqual(effectiveList(["A"]), [{ text: "A", from: "settings" }]);
  assert.deepEqual(effectiveList(["A", "$defaults"]), [{ text: "A", from: "settings" }, { defaults: true }]);
  assert.deepEqual(effectiveList(["$defaults", "A"]), [{ defaults: true }, { text: "A", from: "settings" }]);
  assert.deepEqual(effectiveList(["$defaults", "H1", "$defaults"]), [{ defaults: true }, { text: "H1", from: "settings" }]);
});

test("the near names of the keys people mistype", () => {
  assert.equal(nearBlockKey("softDeny"), "soft_deny");
  assert.equal(nearBlockKey("hardDeny"), "hard_deny");
  assert.equal(nearBlockKey("deny"), "soft_deny");
  assert.equal(nearBlockKey("env"), "environment");
  assert.equal(nearBlockKey("classifyAll"), "classifyAllShell");
  assert.equal(nearBlockKey("nonsense"), null);
});

test("the rules auto mode drops: every rule shape that was put to the binary, kept or dropped as the binary did", () => {
  assert.ok(RULE_SHAPES.length >= 50, `${RULE_SHAPES.length} shapes`);
  for (const { rule, command, dropped } of RULE_SHAPES) {
    const m = /^(Bash|PowerShell)(?:\((.*)\))?$/s.exec(rule);
    assert.ok(m, rule);
    assert.equal(droppedInAutoMode(m[1], m[2]), dropped, `${rule} (for ${command}): ${dropped ? "dropped" : "kept"}`);
  }
});

test("the dropped-rule predicate: the exact forms of the list, with and without a colon, a space, a star", () => {
  for (const w of ["python", "python3", "node", "deno", "tsx", "ruby", "perl", "php", "lua", "npx", "bunx", "npm run", "yarn run", "pnpm run", "bun run", "bash", "sh", "ssh", "zsh", "fish", "eval", "exec", "env", "xargs", "sudo"]) {
    for (const form of [w, `${w}:*`, `${w} *`, `${w}*`, `${w} -c *`]) assert.equal(bashRuleDropped(form), true, form);
    assert.equal(bashRuleDropped(`${w} script *`), false, `${w} script *`);
  }
  assert.equal(bashRuleDropped(undefined), true);
  assert.equal(bashRuleDropped(""), true);
  assert.equal(bashRuleDropped("*"), true);
  assert.equal(bashRuleDropped(" ** "), true);
  assert.equal(bashRuleDropped("git push *"), false);
  assert.equal(bashRuleDropped("nodemon *"), false, "node is a whole word");
  assert.equal(bashRuleDropped("python -m pytest *"), true);
  assert.equal(bashRuleDropped("python -m foo.bar *"), false, "the one narrow form of an option that stays");
  assert.equal(bashRuleDropped("npm run test *"), false);
  assert.equal(bashRuleDropped("npm run *"), true);
  assert.ok(BASH_DANGEROUS.includes("sudo") && !BASH_DANGEROUS.includes("curl"));
});

test("PowerShell: the longer list, the .exe spelling, and the same shapes", () => {
  for (const w of ["pwsh", "powershell", "cmd", "wsl", "iex", "Invoke-Expression", "Start-Process", "Add-Type", "New-Object", "python", "bash"]) {
    for (const form of [w, `${w}:*`, `${w} *`, `${w}*`, `${w} -c *`]) assert.equal(powershellRuleDropped(form), true, form);
  }
  assert.equal(powershellRuleDropped("powershell.exe *"), true);
  assert.equal(powershellRuleDropped("Get-Date *"), false);
  assert.equal(powershellRuleDropped(undefined), true);
  assert.equal(powershellRuleDropped("*"), true);
  assert.ok(POWERSHELL_DANGEROUS.length > BASH_DANGEROUS.length - 8);
});

test("Agent and Monitor allow rules are dropped, and no other tool's", () => {
  assert.equal(droppedInAutoMode("Agent", undefined), true);
  assert.equal(droppedInAutoMode("Agent", "Explore"), true);
  assert.equal(droppedInAutoMode("Monitor", undefined), true);
  assert.equal(droppedInAutoMode("Read", "./src/**"), false);
  assert.equal(droppedInAutoMode("WebFetch", "domain:example.com"), false);
});
