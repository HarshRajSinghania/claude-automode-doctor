// The table behind two tests:
//
//   test/auto-table.test.mjs   no binary needed: what `why` says for each row must equal `expect`;
//   test/auto-oracle.test.mjs  with E2E_CLAUDE set: what the real Claude Code binary does with the same row (a fake API that
//                              refuses whatever the classifier is asked about, `claude -p --permission-mode auto`) must equal
//                              `expect` too.
//
// A row is one command under one set of settings files. `expect` is what Claude Code does with it in auto mode:
//   "static"      approved without asking the classifier (reasonType says how: subcommandResults, rule or mode)
//   "classifier"  sent to the classifier
//   "prompt"      someone has to approve it (claude -p cannot ask, so it is refused)
//   "refused"     a rule, or a built-in check that asks nothing, refuses it
// Every row was run against Claude Code 2.1.299 on Windows 11 and, with the one exception named in `v295`, gave the same
// answer on 2.1.295. A row with `v295` says what 2.1.295 did instead. A row with `platform: "win32"` is for the PowerShell
// tool, which Claude Code offers on Windows; the oracle and the table test skip it elsewhere. A row with `posix` says what
// Linux and macOS are expected to do where that differs from Windows (the other rows were recorded on Windows only; the
// real-binary job in CI runs the table on Linux and macOS and shows where a row differs).
//
// Placeholders in strings: {WORK} the folder Claude starts in, {HOME} the home folder, {ROOT} the folder that holds both,
// {CFG} Claude's config folder; add _POSIX for the form a Git Bash command uses (/c/Users/... on Windows).
// Commands that these rows can run, because the permission mode or an allow rule approves them, only touch the throwaway
// folders; the fake classifier refuses everything it is asked about, so nothing that reaches it runs.

export const DEFAULT_FILES = {
  "a.txt": "hello\n",
  "b.txt": "world\n",
  "README.md": "readme\n",
  "sub/b.txt": "b\n",
  "sub/deeper/c.txt": "c\n",
  "src/a.ts": "hello\n"
};

export const rows = [];

let count = 0;
function add(group, settings, command, expect, extra = {}) {
  const { files, ...rest } = extra;
  rows.push({ id: `${group}-${String(++count).padStart(3, "0")}`, group, settings, command, expect, files: { ...DEFAULT_FILES, ...(files || {}) }, ...rest });
}
// list: [command, expect, reasonType?, v295?, "core"?, posix?]  (posix: what Linux and macOS are expected to do where it differs from Windows)
const each = (group, settings, list, extra) => { for (const [command, expect, reasonType, v295, core, posix] of list) add(group, settings, command, expect, { ...(reasonType ? { reasonType } : {}), ...(v295 ? { v295 } : {}), ...(core ? { core: true } : {}), ...(posix ? { posix } : {}), ...extra }); };
const NONE = {};


// ---- read-only commands: approved by looking at them, no classifier ------------------------------------------------
each("readonly", NONE, [
  ["ls", "static", "subcommandResults", null, "core"],
  ["ls -la", "static", "subcommandResults"],
  ["ls sub", "static", "subcommandResults"],
  ["pwd", "static", "subcommandResults", null, "core"],
  ["echo hi", "static", "subcommandResults", null, "core"],
  ["echo a && echo b", "static", "subcommandResults"],
  ["cat a.txt", "static", "subcommandResults", null, "core"],
  ["cat a.txt b.txt", "static", "subcommandResults"],
  ["head -n 2 a.txt", "static", "subcommandResults", null, "core"],
  ["tail a.txt", "static", "subcommandResults"],
  ["wc -l a.txt", "static", "subcommandResults"],
  ["grep -rn hello .", "static", "subcommandResults", null, "core"],
  ["grep hello a.txt", "static", "subcommandResults"],
  ["find . -name '*.txt'", "static", "subcommandResults"],
  ["git status", "static", "subcommandResults", null, "core"],
  ["git log --oneline", "static", "subcommandResults"],
  ["git diff", "static", "subcommandResults"],
  ["git branch", "static", "subcommandResults"],
  ["git --version", "classifier"],
  ["sed -n 1p a.txt", "static", "subcommandResults"],
  ["cd sub", "static", "subcommandResults"],
  ["cd sub && ls", "static", "subcommandResults", null, "core"],
  ["ls | wc -l", "static", "subcommandResults"],
  ["cat a.txt | head -1", "static", "subcommandResults"],
  ["which node", "static", "subcommandResults"],
  ["date", "static", "subcommandResults"],
  ["whoami", "static", "subcommandResults"],
  ["node --version", "static", "subcommandResults"],
  ["npm --version", "classifier"],
  ["stat a.txt", "static", "subcommandResults"],
  ["file a.txt", "static", "subcommandResults"],
  ["du -sh .", "static", "subcommandResults"],
  ["df -h", "static", "subcommandResults"],
  ["env", "classifier"],
  ["printenv HOME", "classifier"],
  ["uname -a", "static", "subcommandResults"],
  ["basename a.txt", "static", "subcommandResults"],
  ["dirname sub/b.txt", "static", "subcommandResults"],
  ["sort a.txt", "static", "subcommandResults"],
  ["uniq a.txt", "classifier"],
  ["diff a.txt b.txt", "static", "subcommandResults"],
  ["tree", "static", "subcommandResults"],
  ["jq . a.txt", "static", "subcommandResults"],
  ["true", "static", "subcommandResults"],
  ["false", "static", "subcommandResults"],
  ["test -f a.txt", "static", "subcommandResults"],
  ["[ -f a.txt ]", "static", "subcommandResults"],
  ["echo $HOME", "static", "subcommandResults"],
  ["echo \"$PWD\"", "classifier"],
  ["ls ..", "classifier"],
  ["cat ../x.txt", "classifier"],
  ["cat /etc/hostname", "classifier"],
  ["ls /tmp", "classifier"],
  ["cat ~/.bashrc", "classifier"],
  ["find / -name nothing -maxdepth 1", "classifier"],
]);

// ---- the file commands the permission mode approves (mkdir touch rm rmdir mv cp sed, and a redirection) inside the working folder, and what stops that ---
each("edit", NONE, [
  ["mkdir newdir", "static", "mode", null, "core"],
  ["mkdir -p x/y/z", "static", "mode"],
  ["touch t.txt", "static", "mode", null, "core"],
  ["touch a.txt b.txt c.txt", "static", "mode"],
  ["rm a.txt", "static", "mode", null, "core"],
  ["rm -f a.txt", "static", "mode"],
  ["rm -r sub/deeper", "static", "mode"],
  ["rm -rf sub", "static", "mode"],
  ["rm -rf ./sub", "static", "mode"],
  ["rmdir sub/deeper", "static", "mode"],
  ["mv a.txt c.txt", "static", "mode", null, "core"],
  ["mv a.txt sub/", "static", "mode"],
  ["cp a.txt c.txt", "static", "mode", null, "core"],
  ["cp -r sub sub2", "classifier"],
  ["sed -i s/hello/hullo/ a.txt", "static", "mode"],
  ["sed -i.bak s/hello/hullo/ a.txt", "classifier"],
  ["sed s/hello/hullo/ a.txt", "static", "mode"],
  ["echo hi > out.txt", "static", "mode", null, "core"],
  ["echo hi >> out.txt", "static", "mode"],
  ["cat a.txt > c.txt", "static", "mode"],
  ["echo hi > sub/o.txt", "static", "mode"],
  ["LANG=C touch t.txt", "static", "mode"],
  ["NO_COLOR=1 mkdir d1", "static", "mode"],
  ["timeout 5 touch t.txt", "static", "mode"],
  ["nice touch t.txt", "static", "mode"],
  ["nohup touch t.txt", "static", "mode"],
  ["touch t.txt && touch u.txt", "static", "mode"],
  ["touch t.txt && echo done", "static", "mode"],
  ["mkdir d && cd d", "classifier"],
  ["touch t.txt; ls", "static", "mode"],
  ["mkdir /tmp/cad-x1", "classifier", null, null, "core"],
  ["touch /tmp/cad-t1", "classifier"],
  ["mv a.txt /tmp/cad-a.txt", "classifier"],
  ["cp a.txt ../cad-a.txt", "classifier"],
  ["sed -i s/a/b/ /etc/cad-nothing", "classifier"],
  ["echo hi > /tmp/cad-o.txt", "classifier"],
  ["rm -rf /tmp/cad-x2", "classifier"],
  ["touch $(echo x)", "classifier"],
  ["touch \"$HOME/x\"", "classifier"],
  ["touch ~/x", "classifier"],
  ["touch *.nothing", "classifier"],
  ["rm *.nothing", "classifier"],
  ["touch $VAR", "classifier"],
  ["mkdir {a,b}", "classifier"],
  ["ln -s a.txt l", "classifier"],
  ["chmod +x a.txt", "classifier"],
  ["tee out.txt", "classifier"],
  ["echo hi | tee out.txt", "classifier"],
  ["git add .", "classifier", null, null, "core"],
  ["git commit -m x", "classifier"],
  ["git checkout -b nb", "classifier"],
  ["git stash", "classifier"],
  ["git restore a.txt", "classifier"],
]);

// ---- everything else goes to the classifier ------------------------------------------------------------------------
each("classifier", NONE, [
  ["npm test", "classifier", null, null, "core"],
  ["npm install", "classifier"],
  ["npm run build", "classifier"],
  ["python -c \"print(1)\"", "classifier"],
  ["python3 script.py", "classifier", null, null, "core"],
  ["node -e \"1\"", "classifier"],
  ["node server.js", "classifier"],
  ["git push origin main", "classifier", null, null, "core"],
  ["git push --force", "classifier"],
  ["git pull", "classifier"],
  ["git fetch", "classifier"],
  ["git reset --hard", "classifier"],
  ["git clean -fd", "classifier"],
  ["docker ps", "static", "subcommandResults", null, "core"],
  ["make", "classifier"],
  ["mytool deploy", "classifier", null, null, "core"],
  ["bash -c 'echo hi'", "classifier"],
  ["sh -c 'echo hi'", "classifier"],
  ["echo $(whoami)", "classifier", null, null, "core"],
  ["cat $(echo a.txt)", "classifier"],
  ["eval echo hi", "classifier"],
  ["sudo ls", "classifier"],
  ["ssh -o BatchMode=yes -o ConnectTimeout=2 cad-nonexistent-host ls", "classifier"],
  ["ls &", "classifier"],
  ["echo `date`", "classifier"],
  ["xargs echo", "classifier"],
  ["echo a | xargs rm", "classifier"],
  ["find . -name x -delete", "classifier"],
  ["find . -exec echo {} \\;", "classifier"],
  ["awk '{print}' a.txt", "classifier"],
  ["perl -e 1", "classifier"],
  ["ruby -e 1", "classifier"],
  ["cargo build", "classifier"],
  ["go build", "classifier"],
  ["gh pr list", "classifier"],
  ["kubectl get pods", "classifier"],
  ["terraform plan", "classifier"],
  ["aws s3 ls", "classifier"],
  ["open a.txt", "classifier"],
  ["export X=1", "classifier"],
  ["X=1", "static", "subcommandResults"],
  ["source a.txt", "classifier"],
  [". a.txt", "classifier"],
  ["cat a.txt; rm b.txt", "static", "mode"],
  ["cat a.txt && python3 x.py", "classifier"],
  ["for i in 1 2; do echo $i; done", "classifier"],
  ["while true; do break; done", "classifier"],
  ["if true; then echo x; fi", "static", "subcommandResults"],
  ["(echo a)", "classifier"],
  ["{ echo a; }", "classifier"],
  ["echo a > /dev/null", "static", "subcommandResults"],
  ["echo hi | sh", "classifier"],
  ["cat a.txt | bash", "classifier"],
  ["ls -la | grep foo | wc -l", "static", "subcommandResults"],
  ["cd .. && ls", "classifier"],
  ["cd / && ls", "classifier"],
  ["cd sub && git status", "classifier"],
  ["cd sub; ls", "static", "subcommandResults"],
]);

// ---- rm and rmdir of a critical path: a built-in safety check asks you (claude -p cannot ask, so it refuses); a target that is not critical is judged like any other ---
each("critical", NONE, [
  ["rm -rf ~", "prompt", null, null, "core"],
  ["rm -rf .", "prompt", null, null, "core"],
  ["rm -rf ..", "prompt"],
  ["rm -rf ./", "prompt"],
  ["rm -rf $HOME", "prompt"],
  ["rm -rf \"$HOME\"", "prompt"],
  ["rmdir .", "prompt"],
  ["rm -rf *", "prompt", null, null, "core"],
  ["rm -rf ~/*", "prompt"],
  ["rm -rf {WORK_POSIX}", "prompt"],
  ["rm -rf {WORK_POSIX}/..", "prompt"],
  ["rm -rf {HOME_POSIX}", "prompt", null, "classifier"],
  ["rm -rf sub/*", "classifier"],
  ["rm -rf sub/", "static", "mode"],
  ["rm -rf ../x", "classifier"],
  ["cd sub && rm -rf ..", "prompt"],
  ["rm -rf \"$(pwd)\"", "prompt"],
  ["rm -rf $(pwd)", "prompt"],
  ["bash -c 'rm -rf ~'", "prompt"],
  ["echo x && rm -rf ~", "prompt"],
  ["rmdir /", "prompt"],
  ["rmdir /usr", "prompt"],
  ["rmdir /etc", "prompt"],
  ["rmdir /tmp", "prompt"],
  ["DIR=sub; rm -rf \"$DIR\"/*", "classifier"],
  ["rm -rf sub/deeper", "static", "mode", null, "core"],
  // a glob straight in a working folder or in the home folder, with the folder's path written out
  ["rm -rf {WORK_POSIX}/*", "prompt"],
  ["rm -rf {WORK_POSIX}/*/", "prompt"],
  ["rm -rf {WORK_POSIX}/sub/*", "classifier"],
  ["rm -rf {HOME_POSIX}/*", "prompt", null, "classifier"],
  ["rm -rf {WORK_POSIX}/b.txt", "static", "mode"],
  ["rmdir {WORK_POSIX}/sub", "static", "mode"],
]);

// ---- an allow rule with a wildcard: every part of the line needs a rule or must be read-only -----------------------
each("allow-wild", {"user":{"permissions":{"allow":["Bash(mytool *)"]}}}, [
  ["mytool deploy", "static", "subcommandResults", null, "core"],
  ["mytool", "static", "subcommandResults"],
  ["mytool a && mytool b", "static", "subcommandResults", null, "core"],
  ["mytool a && othertool b", "classifier", null, null, "core"],
  ["mytool a | wc -l", "static", "subcommandResults"],
  ["mytool a | sh", "classifier"],
  ["mytoolx a", "classifier"],
  ["othertool a", "classifier", null, null, "core"],
  ["mytool a > out.txt", "static", "mode"],
  ["mytool a > /tmp/cad-o.txt", "classifier"],
  ["mytool $(echo x)", "classifier"],
  ["mytool a; rm b.txt", "static", "mode"],
  ["FOO=1 mytool a", "classifier"],
  ["LANG=C mytool a", "static", "subcommandResults"],
  ["timeout 5 mytool a", "static", "subcommandResults"],
  ["sudo mytool a", "classifier"],
  ["echo hi && mytool a", "static", "subcommandResults"],
]);

// ---- an allow rule that spells out the whole command ---------------------------------------------------------------
each("allow-exact", {"user":{"permissions":{"allow":["Bash(mytool deploy)"]}}}, [
  ["mytool deploy", "static", "rule", null, "core"],
  ["mytool deploy --prod", "classifier", null, null, "core"],
  ["mytool", "classifier"],
  ["mytool deploy && mytool deploy", "static", "subcommandResults"],
]);

// ---- a prefix allow rule -------------------------------------------------------------------------------------------
each("allow-prefix", {"user":{"permissions":{"allow":["Bash(mytool:*)"]}}}, [
  ["mytool a b", "static", "subcommandResults"],
  ["mytool", "static", "rule"],
  ["mytoolx a", "classifier"],
]);

// ---- an allow rule in the project's shared settings ----------------------------------------------------------------
each("allow-project", {"project":{"permissions":{"allow":["Bash(mytool *)"]}}}, [
  ["mytool a", "static", "subcommandResults"],
]);

// ---- an allow rule in the local settings ---------------------------------------------------------------------------
each("allow-local", {"local":{"permissions":{"allow":["Bash(mytool *)"]}}}, [
  ["mytool a", "static", "subcommandResults"],
]);

// ---- an ask rule makes the matching command prompt, and the classifier cannot approve it ---------------------------
each("ask", {"user":{"permissions":{"allow":["Bash(mytool *)"],"ask":["Bash(mytool danger *)"]}}}, [
  ["mytool danger x", "prompt", null, null, "core"],
  ["mytool safe x", "static", "subcommandResults", null, "core"],
  ["mytool a && mytool danger x", "prompt"],
]);

// ---- ask rules on git push -----------------------------------------------------------------------------------------
each("ask-git", {"user":{"permissions":{"ask":["Bash(git push *)"]}}}, [
  ["git push origin main", "prompt", null, null, "core"],
  ["git push", "prompt"],
  ["git status", "static", "subcommandResults", null, "core"],
  ["git -C . push", "classifier"],
  ["echo hi && git push origin", "prompt"],
  ["git commit -m x", "classifier"],
]);

// ---- an ask rule on a command that is read-only --------------------------------------------------------------------
each("ask-readonly", {"user":{"permissions":{"ask":["Bash(ls *)"]}}}, [
  ["ls -la", "prompt"],
  ["ls", "prompt"],
  ["cat a.txt", "static", "subcommandResults"],
]);

// ---- a deny rule refuses the command, also as a part of a longer one, before the classifier ------------------------
each("deny", {"user":{"permissions":{"deny":["Bash(curl *)"]}}}, [
  ["echo hi && curl x", "refused", null, null, "core"],
  ["ls", "static", "subcommandResults", null, "core"],
  ["sudo curl x", "refused"],
  ["bash -c 'curl x'", "classifier"],
]);

// ---- a deny rule beside an allow rule ------------------------------------------------------------------------------
each("deny-allow", {"user":{"permissions":{"allow":["Bash(mytool *)"],"deny":["Bash(mytool danger *)"]}}}, [
  ["mytool danger x", "refused"],
  ["mytool safe x", "static", "subcommandResults"],
]);

// ---- Read deny rules and the Bash commands that name those files ---------------------------------------------------
each("deny-read", {"user":{"permissions":{"deny":["Read(./secret.txt)","Read(**/*.pem)"]}}}, [
  ["cat secret.txt", "refused"],
  ["cat a.txt", "static", "subcommandResults"],
  ["head secret.txt", "refused"],
  ["grep x secret.txt", "refused"],
  ["cat sub/x.pem", "refused"],
  ["ls", "static", "subcommandResults"],
], {"files":{"secret.txt":"s\n","sub/x.pem":"k\n"}});

// ---- an Edit deny rule and the Bash commands that write the file ---------------------------------------------------
each("deny-edit", {"user":{"permissions":{"deny":["Edit(./secret.txt)"]}}}, [
  ["echo x > secret.txt", "refused"],
  ["sed -i s/s/t/ secret.txt", "refused"],
  ["touch secret.txt", "refused"],
  ["rm secret.txt", "refused"],
  ["cp a.txt secret.txt", "refused"],
  ["mv a.txt secret.txt", "refused"],
  ["tee secret.txt", "refused"],
  ["python3 -c \"open('secret.txt','w')\"", "classifier"],
  ["echo x > a.txt", "static", "mode"],
], {"files":{"secret.txt":"s\n"}});

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(*)"]}}}, [
  ["mytool a", "classifier", null, null, "core"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash"]}}}, [
  ["mytool a", "classifier"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(**)"]}}}, [
  ["mytool a", "classifier"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash( * )"]}}}, [
  ["mytool a", "classifier"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(python *)"]}}}, [
  ["python -c \"print(1)\"", "classifier", null, null, "core"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(python:*)"]}}}, [
  ["python -c \"print(1)\"", "classifier"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(python*)"]}}}, [
  ["python -c \"print(1)\"", "classifier"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(python3 *)"]}}}, [
  ["python3 x.py", "classifier"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(python3 script.py *)"]}}}, [
  ["python3 script.py a", "static", "subcommandResults", null, "core"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(python -m pytest *)"]}}}, [
  ["python -m pytest tests", "classifier"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(python -m foo.bar *)"]}}}, [
  ["python -m foo.bar x", "static", "subcommandResults"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(python3 -c *)"]}}}, [
  ["python3 -c \"print(1)\"", "classifier"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(node *)"]}}}, [
  ["node server.js", "classifier"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(node:*)"]}}}, [
  ["node server.js", "classifier"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(node server.js)"]}}}, [
  ["node server.js", "static", "rule"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(node server.js *)"]}}}, [
  ["node server.js a", "static", "subcommandResults"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(nodemon *)"]}}}, [
  ["nodemon x", "static", "subcommandResults"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(npm run *)"]}}}, [
  ["npm run build", "classifier", null, null, "core"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(npm run build)"]}}}, [
  ["npm run build", "static", "rule"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(npm run build *)"]}}}, [
  ["npm run build x", "static", "subcommandResults", null, "core"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(npm *)"]}}}, [
  ["npm test", "static", "subcommandResults"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(npm test)"]}}}, [
  ["npm test", "static", "rule", null, "core"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(npm test *)"]}}}, [
  ["npm test x", "static", "subcommandResults"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(npm install)"]}}}, [
  ["npm install", "static", "rule"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(npx *)"]}}}, [
  ["npx --version", "classifier"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(yarn run *)"]}}}, [
  ["yarn run build", "classifier"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(pnpm run *)"]}}}, [
  ["pnpm run build", "classifier"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(bun run *)"]}}}, [
  ["bun run build", "classifier"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(bash *)"]}}}, [
  ["bash x.sh", "classifier"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(bash x.sh)"]}}}, [
  ["bash x.sh", "static", "rule"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(sh *)"]}}}, [
  ["sh x.sh", "classifier"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(zsh *)"]}}}, [
  ["zsh x.sh", "classifier"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(ssh *)"]}}}, [
  ["ssh -o BatchMode=yes -o ConnectTimeout=2 cad-nonexistent-host ls", "classifier"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(sudo *)"]}}}, [
  ["sudo ls", "classifier", null, null, "core"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(env *)"]}}}, [
  ["env FOO=1 ls", "classifier"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(xargs *)"]}}}, [
  ["xargs echo", "classifier"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(eval *)"]}}}, [
  ["eval echo hi", "classifier"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(exec *)"]}}}, [
  ["exec echo hi", "classifier"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(ruby *)"]}}}, [
  ["ruby x.rb", "classifier"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(perl *)"]}}}, [
  ["perl x.pl", "classifier"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(php *)"]}}}, [
  ["php x.php", "classifier"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(deno *)"]}}}, [
  ["deno run x.ts", "classifier"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(tsx *)"]}}}, [
  ["tsx x.ts", "classifier"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(lua *)"]}}}, [
  ["lua x.lua", "classifier"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(git *)"]}}}, [
  ["git push origin main", "static", "subcommandResults"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(git push *)"]}}}, [
  ["git push origin main", "static", "subcommandResults", null, "core"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(docker *)"]}}}, [
  ["docker ps", "static", "subcommandResults"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(make *)"]}}}, [
  ["make build", "static", "subcommandResults"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(make)"]}}}, [
  ["make", "static", "rule"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(cargo *)"]}}}, [
  ["cargo build", "static", "subcommandResults"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(go test *)"]}}}, [
  ["go test ./...", "static", "subcommandResults"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(kubectl *)"]}}}, [
  ["kubectl get pods", "static", "subcommandResults"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(rm *)"]}}}, [
  ["rm nothing.txt", "static", "subcommandResults"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(* --version)"]}}}, [
  ["mytool --version", "static", "subcommandResults"],
]);

// ---- allow rules auto mode drops when it starts (broad ones: a command that runs any code) and the narrow ones it keeps ---
each("dropped", {"user":{"permissions":{"allow":["Bash(mytool *)"]}}}, [
  ["mytool a", "static", "subcommandResults", null, "core"],
]);

// ---- autoMode.classifyAllShell: every Bash and PowerShell allow rule is suspended; read-only commands are not ------
each("cas", {"user":{"permissions":{"allow":["Bash(mytool *)","Bash(git status)"]},"autoMode":{"classifyAllShell":true}}}, [
  ["mytool a", "classifier", null, null, "core"],
  ["git status", "static", "subcommandResults"],
  ["ls", "static", "subcommandResults", null, "core"],
  ["echo hi", "static", "subcommandResults"],
  ["touch t.txt", "static", "mode"],
  ["cat a.txt", "static", "subcommandResults"],
  ["mytool a && ls", "classifier"],
]);

// ---- classifyAllShell false changes nothing ------------------------------------------------------------------------
each("cas-off", {"user":{"permissions":{"allow":["Bash(mytool *)"]},"autoMode":{"classifyAllShell":false}}}, [
  ["mytool a", "static", "subcommandResults"],
]);

// ---- classifyAllShell in a project file is not read ----------------------------------------------------------------
each("cas-project", {"project":{"autoMode":{"classifyAllShell":true},"permissions":{"allow":["Bash(mytool *)"]}}}, [
  ["mytool a", "static", "subcommandResults"],
]);

// ---- permissions.blockReadsOutsideWorkingDirectories: a command that cannot be shown to stay inside the working folders is asked about ---
each("blockreads", {"user":{"permissions":{"blockReadsOutsideWorkingDirectories":true}}}, [
  ["cat a.txt", "static", "subcommandResults", null, "core"],
  ["cat $(echo a.txt)", "prompt", null, null, "core"],
  ["cat *.txt", "static", "subcommandResults"],
  ["grep -rn hello .", "static", "subcommandResults"],
  ["cat ../outside.txt", "prompt", null, null, "core"],
  ["cd sub", "prompt"],
  ["cd sub && ls", "prompt", null, null, "core"],
  ["cd sub ; sed -n 1,2p b.txt", "prompt"],
  ["cd sub && sed -n 1,2p b.txt", "prompt"],
  ["sed -n 1,2p README.md", "static", "subcommandResults"],
  ["ls ..", "prompt"],
  ["cat /etc/hostname", "prompt"],
  ["echo hi", "static", "subcommandResults"],
  ["touch t.txt", "static", "mode"],
  ["mytool a", "classifier"],
  ["ls /tmp", "prompt"],
  ["cat ~/.bashrc", "prompt"],
  ["echo $(date)", "prompt"],
]);

// ---- allow rules do not help against the read block ----------------------------------------------------------------
each("blockreads-allow", {"user":{"permissions":{"blockReadsOutsideWorkingDirectories":true,"allow":["Bash(cat:*)","Bash(sed *)","Bash(cd *)"]}}}, [
  ["cat $(echo a.txt)", "prompt"],
  ["cd sub && sed -n 1,2p b.txt", "prompt"],
  ["cat ../outside.txt", "prompt"],
]);

// ---- the read block set to false -----------------------------------------------------------------------------------
each("blockreads-false", {"user":{"permissions":{"blockReadsOutsideWorkingDirectories":false}}}, [
  ["cat $(echo a.txt)", "classifier"],
  ["cd sub && ls", "static", "subcommandResults"],
]);

// ---- a Read deny rule and a cd: a command that reads files after the cd goes to the classifier (issue 91650) -------
each("readdeny-cd", {"user":{"permissions":{"deny":["Read(**/*.pem)"]}}}, [
  ["cd sub", "static", "subcommandResults", null, "core"],
  ["cd sub && ls", "classifier", null, null, "core"],
  ["cd sub && cat b.txt", "classifier"],
  ["cd sub && sed -n 1,2p b.txt", "classifier"],
  ["cd sub ; sed -n 1,2p b.txt", "classifier"],
  ["cd sub && sed -n 1,2p b.txt; echo ===", "classifier"],
  ["cat sub/b.txt", "static", "subcommandResults", null, "core"],
  ["sed -n 1,2p README.md", "static", "subcommandResults"],
  ["cd sub && echo hi", "static", "subcommandResults"],
  ["cd sub && grep -rn b .", "classifier"],
]);

// ---- permissions.additionalDirectories are working folders too -----------------------------------------------------
each("dirs", {"user":{"permissions":{"additionalDirectories":["{ROOT_POSIX}/other"]}}}, [
  // On Windows the Git Bash spelling (/c/Users/...) of an additional directory is not the folder the setting names, so the
  // commands are outside every working folder; on Linux and macOS the two spellings are one, so they are inside.
  ["touch {ROOT_POSIX}/other/t.txt", "classifier", null, null, null, "static"],
  ["touch {ROOT_POSIX}/elsewhere/t.txt", "classifier"],
  ["cat {ROOT_POSIX}/other/x.txt", "classifier", null, null, null, "static"],
  ["rm -rf {ROOT_POSIX}/other/*", "classifier", null, null, null, "prompt"],
  ["rm -rf {ROOT_POSIX}/other", "classifier", null, null, null, "static"],
], {"files":{"{ROOT_POSIX}/other/x.txt":"x\n"}});

// ---- flags of the file commands the mode approves: any option on cp or mv, and most forms of sed, send the command to the classifier ---
each("editflags", NONE, [
  ["cp -R sub sub2", "classifier"],
  ["cp -a sub sub2", "classifier"],
  ["cp -p a.txt c.txt", "classifier"],
  ["cp -f a.txt c.txt", "classifier"],
  ["cp -v a.txt c.txt", "classifier"],
  ["cp -n a.txt c.txt", "classifier"],
  ["cp -i a.txt c.txt", "classifier"],
  ["cp -u a.txt c.txt", "classifier"],
  ["cp -- a.txt c.txt", "classifier"],
  ["cp -r a.txt c.txt", "classifier"],
  ["cp a.txt b.txt sub/", "static", "mode", null, "core"],
  ["cp -t sub a.txt", "classifier"],
  ["cp --recursive sub sub2", "classifier"],
  ["cp -rf sub sub2", "classifier"],
  ["cp -l a.txt c.txt", "classifier"],
  ["cp -s a.txt c.txt", "classifier"],
  ["mv -f a.txt c.txt", "classifier"],
  ["mv -v a.txt c.txt", "classifier"],
  ["mv -n a.txt c.txt", "classifier"],
  ["mv -i a.txt c.txt", "classifier"],
  ["mv -t sub a.txt", "classifier"],
  ["mv a.txt b.txt sub/", "static", "mode"],
  ["mv sub sub3", "static", "mode"],
  ["mv -- a.txt c.txt", "classifier"],
  ["rm -i a.txt", "static", "mode"],
  ["rm -v a.txt", "static", "mode"],
  ["rm -d sub/deeper", "static", "mode"],
  ["rm -R sub", "static", "mode"],
  ["rm --force a.txt", "static", "mode"],
  ["rm --recursive sub", "static", "mode"],
  ["rm -rf a.txt b.txt", "static", "mode"],
  ["rm -- a.txt", "static", "mode"],
  ["rm -I a.txt", "static", "mode"],
  ["rm --one-file-system a.txt", "static", "mode"],
  ["rm -rfv sub", "static", "mode"],
  ["mkdir -m 755 nd", "static", "mode"],
  ["mkdir -v nd", "static", "mode"],
  ["mkdir -pv a/b", "static", "mode"],
  ["mkdir --parents a/b", "static", "mode"],
  ["mkdir -p sub/x/y", "static", "mode"],
  ["mkdir -- nd", "static", "mode"],
  ["mkdir -Z nd", "static", "mode"],
  ["touch -c a.txt", "static", "mode"],
  ["touch -a a.txt", "static", "mode"],
  ["touch -t 202001010000 a.txt", "static", "mode"],
  ["touch -d yesterday a.txt", "static", "mode"],
  ["touch -r b.txt a.txt", "static", "mode"],
  ["touch -- a.txt", "static", "mode"],
  ["touch --no-create a.txt", "static", "mode"],
  ["sed -i s/a/b/ a.txt", "static", "mode", null, "core"],
  ["sed -i.bak s/a/b/ a.txt", "classifier", null, null, "core"],
  ["sed -i'' s/a/b/ a.txt", "static", "mode"],
  ["sed -i -e s/a/b/ a.txt", "classifier"],
  ["sed -E -i s/a/b/ a.txt", "static", "mode"],
  ["sed -n -i p a.txt", "classifier"],
  ["sed --in-place s/a/b/ a.txt", "static", "mode"],
  ["sed --in-place=.bak s/a/b/ a.txt", "classifier"],
  ["sed -i -f script.sed a.txt", "classifier"],
  ["sed -i '1d' a.txt", "classifier"],
  ["sed -i 's/a/b/g' a.txt b.txt", "static", "mode"],
  ["sed -e s/a/b/ a.txt", "classifier"],
  ["sed -n '1p;2p' a.txt", "static", "subcommandResults"],
  ["sed s/a/b/w out.txt a.txt", "classifier"],
  ["sed -i 'w out.txt' a.txt", "classifier"],
  ["sed -i 'e echo hi' a.txt", "classifier"],
  ["sed 's/a/b/e' a.txt", "classifier"],
  ["sed -s -n 1p a.txt", "classifier"],
  ["sed -z s/a/b/ a.txt", "classifier"],
  ["rmdir -p sub/deeper", "static", "mode"],
  ["rmdir -v sub/deeper", "static", "mode"],
  ["rmdir --ignore-fail-on-non-empty sub", "static", "mode"],
]);

// ---- forms around those commands: wrappers, variables in front, redirections, a cd beside an edit, protected paths ---
each("editforms", NONE, [
  ["time touch t.txt", "static", "mode"],
  ["stdbuf -oL touch t.txt", "static", "mode"],
  ["command touch t.txt", "static", "mode"],
  ["env touch t.txt", "classifier"],
  ["xargs touch", "classifier"],
  ["nohup touch t.txt &", "classifier"],
  ["timeout 5 rm a.txt", "static", "mode"],
  ["timeout -s KILL 5 touch t.txt", "static", "mode"],
  ["nice -n 5 touch t.txt", "static", "mode"],
  ["FOO=1 touch t.txt", "classifier", null, null, "core"],
  ["NODE_ENV=x touch t.txt", "static", "mode"],
  ["LC_ALL=C sed -i s/a/b/ a.txt", "static", "mode"],
  ["PATH=x touch t.txt", "classifier"],
  ["\touch t.txt", "classifier"],
  ["'touch' t.txt", "static", "mode"],
  ["/bin/touch t.txt", "classifier"],
  ["touch t.txt 2>/dev/null", "static", "mode"],
  ["touch t.txt 2>&1", "static", "mode"],
  ["touch t.txt > out.txt", "static", "mode"],
  ["touch t.txt < a.txt", "static", "mode"],
  ["cd sub && touch t.txt", "classifier", null, null, "core"],
  ["cd sub && mkdir d && cd d", "classifier"],
  ["mkdir d; cd d", "classifier"],
  ["mkdir d && ls d", "static", "mode"],
  ["touch t.txt | cat", "static", "mode"],
  ["cat a.txt | touch t.txt", "static", "mode"],
  ["echo hi > a.txt", "static", "mode"],
  ["echo hi > ./a.txt", "static", "mode"],
  ["echo hi > sub/../o.txt", "classifier"],
  ["echo hi > ../o.txt", "classifier"],
  ["echo hi > $HOME/o.txt", "classifier"],
  ["echo hi > ~/o.txt", "classifier"],
  ["echo hi > $OUT", "classifier"],
  ["echo hi > *.txt", "classifier"],
  ["echo hi > \"o file.txt\"", "static", "mode"],
  ["echo hi 2> err.txt", "static", "mode"],
  ["echo hi &> all.txt", "static", "mode"],
  ["echo hi >| out.txt", "static", "mode"],
  ["cat <<EOF > o.txt\nhi\nEOF", "classifier"],
  ["cat << 'EOF' > o.txt\nhi\nEOF", "classifier"],
  ["cat > o.txt <<'EOF'\nhi\nEOF", "static", "mode"],
  ["printf hi > o.txt", "static", "mode"],
  ["ls > o.txt", "static", "mode"],
  ["echo hi >out.txt", "static", "mode"],
  ["echo hi > /dev/null", "static", "subcommandResults"],
  ["echo hi > /dev/stdout", "classifier"],
  ["mkdir d && cd sub", "classifier"],
  ["cd sub && mkdir d", "classifier"],
  ["cd sub && touch a.txt && cd ..", "classifier"],
  ["pwd && touch t.txt", "static", "mode"],
  ["touch t.txt && rm t.txt", "static", "mode"],
  ["rm a.txt && touch a.txt", "static", "mode"],
  ["mkdir d && touch d/t.txt", "static", "mode"],
  ["mkdir d && mv a.txt d/", "static", "mode"],
  ["touch ../t.txt", "classifier"],
  ["touch ./t.txt", "static", "mode"],
  ["touch sub/../t.txt", "classifier"],
  ["touch \"o file.txt\"", "static", "mode"],
  ["touch -- -weird", "static", "mode"],
  ["touch .hidden", "static", "mode"],
  ["touch .claude/x", "classifier"],
  ["touch .git/x", "classifier", null, null, "core"],
  ["touch .env", "static", "mode", null, "core"],
  ["touch .vscode/x", "classifier"],
  ["touch node_modules/x", "static", "mode"],
  ["touch .claude/settings.json", "classifier"],
  ["touch a.txt .claude/x", "classifier"],
]);

// ---- which commands count as reading files after a cd --------------------------------------------------------------
each("readdeny-cd2", {"user":{"permissions":{"deny":["Read(**/*.pem)"]}}}, [
  ["cd sub && pwd", "static", "subcommandResults"],
  ["cd sub && date", "static", "subcommandResults"],
  ["cd sub && whoami", "static", "subcommandResults"],
  ["cd sub && true", "static", "subcommandResults"],
  ["cd sub && ls -la", "classifier"],
  ["cd sub && head b.txt", "classifier"],
  ["cd sub && wc -l b.txt", "classifier"],
  ["cd sub && git status", "classifier"],
  ["cd sub && git log --oneline", "classifier"],
  ["cd sub && find .", "classifier"],
  ["cd sub && tree", "static", "subcommandResults"],
  ["cd sub && du -sh .", "static", "subcommandResults"],
  ["cd sub && stat b.txt", "classifier"],
  ["cd sub && file b.txt", "classifier"],
  ["cd sub && diff b.txt b.txt", "classifier"],
  ["cd sub && grep -rn x .", "classifier"],
  ["cd sub && which node", "static", "subcommandResults"],
  ["cd sub && node --version", "static", "subcommandResults"],
  ["cd sub && test -f b.txt", "static", "subcommandResults"],
  ["cd sub && ls /tmp", "classifier"],
  ["cd sub && echo $HOME", "static", "subcommandResults"],
  ["cd sub && cat /etc/hostname", "classifier"],
  ["cd sub && sort b.txt", "classifier"],
  ["cd sub && jq . b.txt", "classifier"],
  ["echo hi && cd sub", "static", "subcommandResults"],
  ["cd sub && cd deeper", "classifier"],
  ["cd sub && cd deeper && ls", "classifier"],
  ["ls && cd sub && ls", "classifier"],
  ["cd sub; echo hi; ls", "classifier"],
]);

// ---- a Read and an Edit deny rule ----------------------------------------------------------------------------------
each("readdeny-cd3", {"user":{"permissions":{"deny":["Read(**/*.pem)","Edit(**/*.key)"]}}}, [
  ["cd sub && touch t.txt", "classifier"],
  ["cd sub && cat b.txt", "classifier"],
]);

// ---- an allow rule does not help -----------------------------------------------------------------------------------
each("readdeny-allow-cd", {"user":{"permissions":{"deny":["Read(**/*.pem)"],"allow":["Bash(ls *)"]}}}, [
  ["cd sub && ls", "classifier"],
  ["cd sub && ls -la", "classifier"],
]);

// ---- the PowerShell tool (Windows) ---------------------------------------------------------------------------------
each("ps", NONE, [
  ["Get-ChildItem", "static", "other"],
  ["Get-ChildItem -Recurse", "static", "other"],
  ["ls", "static", "other"],
  ["dir", "static", "other"],
  ["Get-Content a.txt", "static", "other"],
  ["cat a.txt", "static", "other"],
  ["Write-Output hi", "static", "other"],
  ["echo hi", "static", "other"],
  ["Get-Location", "static", "other"],
  ["pwd", "static", "other"],
  ["Get-Date", "static", "other"],
  ["Test-Path a.txt", "static", "other"],
  ["Select-String hello a.txt", "static", "other"],
  ["Get-Process", "classifier"],
  ["New-Item t.txt", "classifier"],
  ["New-Item -ItemType Directory d", "classifier"],
  ["Set-Content o.txt hi", "static", "mode"],
  ["Add-Content o.txt hi", "static", "mode"],
  ["Remove-Item a.txt", "static", "mode"],
  ["Remove-Item -Recurse -Force sub", "static", "mode"],
  ["Copy-Item a.txt c.txt", "classifier"],
  ["Move-Item a.txt c.txt", "classifier"],
  ["Out-File o.txt", "classifier"],
  ["echo hi > o.txt", "classifier"],
  ["mkdir d", "classifier"],
  ["touch t.txt", "classifier"],
  ["rm a.txt", "static", "mode"],
  ["Start-Process notepad", "classifier"],
  ["Invoke-Expression 'echo hi'", "classifier"],
  ["git status", "static", "other"],
  ["git push origin main", "classifier"],
  ["npm test", "classifier"],
  ["python -c 1", "classifier"],
  ["Get-Date; Get-Location", "static", "other"],
  ["Get-Content a.txt | Measure-Object", "static", "other"],
  ["Remove-Item *", "refused"],
  ["Remove-Item -Recurse -Force .", "classifier"],
  ["Remove-Item ~ -Recurse", "refused"],
], {"tool":"PowerShell","platform":"win32"});

// ---- PowerShell rules (Windows) ------------------------------------------------------------------------------------
each("ps-rules", {"user":{"permissions":{"allow":["PowerShell(Get-Date *)","PowerShell(mytool *)"],"deny":["PowerShell(Remove-Item *)"],"ask":["PowerShell(git push *)"]}}}, [
  ["Get-Date -Format o", "static", "other"],
  ["mytool a", "static", "other"],
  ["mytool", "static", "other"],
  ["Remove-Item a.txt", "refused"],
  ["git push origin", "prompt"],
  ["git status", "static", "other"],
  ["Get-Date; mytool a", "static", "other"],
  ["Get-Date; npm test", "classifier"],
], {"tool":"PowerShell","platform":"win32"});

// ---- PowerShell(*) is dropped (Windows) ----------------------------------------------------------------------------
each("ps-dropped", {"user":{"permissions":{"allow":["PowerShell(*)"]}}}, [
  ["mytool a", "classifier"],
], {"tool":"PowerShell","platform":"win32"});

// ---- PowerShell allow rules for shells and runners are dropped (Windows) -------------------------------------------
each("ps-dropped2", {"user":{"permissions":{"allow":["PowerShell(powershell *)","PowerShell(Invoke-Expression *)","PowerShell(python *)","PowerShell(Start-Process *)"]}}}, [
  ["powershell -c 1", "classifier"],
  ["Invoke-Expression 'echo hi'", "classifier"],
  ["python -c 1", "classifier"],
  ["Start-Process notepad", "classifier"],
], {"tool":"PowerShell","platform":"win32"});

// ---- the PowerShell cmdlets and aliases the mode approves, and Remove-Item on wildcards and system paths (Windows) ---
each("ps-mode", NONE, [
  ["sc o.txt hi", "classifier"],
  ["ac o.txt hi", "static", "mode"],
  ["del a.txt", "static", "mode"],
  ["erase a.txt", "static", "mode"],
  ["ri a.txt", "static", "mode"],
  ["rd sub", "static", "mode"],
  ["rmdir sub", "static", "mode"],
  ["Remove-Item sub -Recurse", "static", "mode"],
  ["Remove-Item a.txt -Force", "static", "mode"],
  ["Remove-Item a.txt, b.txt", "classifier"],
  ["Set-Content -Path o.txt -Value hi", "static", "mode"],
  ["Clear-Content a.txt", "static", "mode"],
  ["Set-Content ..\\o.txt hi", "classifier"],
  ["Set-Content C:\\Windows\\cad-nothing hi", "classifier"],
  ["Remove-Item C:\\Users\\cad-nothing", "classifier"],
  ["Remove-Item .\\sub\\*", "refused"],
  ["Remove-Item -Recurse -Force .\\sub\\deeper", "static", "mode"],
  ["Remove-Item $HOME\\cad-nothing", "classifier"],
  ["Set-Content .claude\\x hi", "classifier"],
  ["Remove-Item .git\\x", "classifier"],
  ["Set-Content o.txt hi; Get-Date", "static", "mode"],
  ["New-Item -Force o.txt", "classifier"],
  ["Rename-Item a.txt c.txt", "classifier"],
  ["Remove-Item *.nothing", "classifier"],
  ["Remove-Item .", "static", "mode"],
  ["Remove-Item .. -Recurse", "classifier"],
  ["Remove-Item C:\\ -Recurse", "refused"],
  ["Remove-Item \\ -Recurse", "refused"],
], {"tool":"PowerShell","platform":"win32"});

// ---- PowerShell paths with backslashes (Windows) -------------------------------------------------------------------
each("ps-raw", NONE, [
  ["Remove-Item .\\*", "refused"],
  ["Remove-Item C:\\Windows\\cad-nothing", "classifier"],
  ["Remove-Item C:\\Windows", "refused"],
], {"tool":"PowerShell","platform":"win32"});

// ---- the allow rules that were put to the binary, kept or dropped: derived from the "dropped" rows ----------------------
/** [{ rule, command, dropped }]: the rule is dropped when auto mode starts exactly when the command it covers goes to the classifier. */
export const RULE_SHAPES = rows
  .filter((r) => (r.group === "dropped" || r.group === "ps-dropped" || r.group === "ps-dropped2") && r.settings.user && r.settings.user.permissions && r.settings.user.permissions.allow.length === 1)
  .map((r) => ({ rule: r.settings.user.permissions.allow[0], command: r.command, dropped: r.expect === "classifier" }));

