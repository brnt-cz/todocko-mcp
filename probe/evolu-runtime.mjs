/**
 * Runtime probe: does the built server actually boot, write and read?
 *
 * `tsc` never starts the dbWorker or the stored worker, and an Evolu upgrade
 * lands exactly there: 8.28 replaced the deps' `sharedWorker` with
 * `createStoredWorker`. A green build says nothing about any of it, so this
 * speaks JSON-RPC to `dist/`, creates a project and a task, and reads the task
 * back.
 *
 * It also counts the mutation callbacks, which is the part a build cannot
 * check at all: an option name Evolu does not know is ignored at runtime, the
 * write still lands and the tool still reports success, so only the count
 * tells a wired-up callback from a dead one. Run `npm run build` first.
 *
 * Isolated on purpose: HOME points into /var/tmp, so it opens its own database
 * instead of the user's ~/.todocko, and the relay URL is a dead port, so
 * nothing reaches the real relay. The mnemonic is generated here and only ever
 * lives in the child's env.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, rmSync } from "node:fs";
import { createOwnerSecret, ownerSecretToMnemonic } from "@evolu/common/local-first";
import { createRandomBytes } from "@evolu/common";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
// /var/tmp, not /tmp: a reboot clears /tmp and takes the evidence with it.
const HOME = "/var/tmp/todocko-mcp-probe-home";
rmSync(HOME, { recursive: true, force: true });
mkdirSync(HOME, { recursive: true });

const child = spawn(process.execPath, [join(repo, "dist", "index.js")], {
  cwd: repo,
  env: {
    ...process.env,
    HOME,
    TODOCKO_MNEMONIC: ownerSecretToMnemonic(createOwnerSecret({ randomBytes: createRandomBytes() })),
    TODOCKO_RELAY_URL: "ws://127.0.0.1:9",
  },
  stdio: ["pipe", "pipe", "pipe"],
});

let buffer = "";
const waiters = new Map();
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let i;
  while ((i = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      const waiter = waiters.get(msg.id);
      if (waiter) { waiters.delete(msg.id); waiter(msg); }
    } catch { /* not JSON-RPC, ignore */ }
  }
});
const stderr = [];
child.stderr.on("data", (c) => stderr.push(c.toString()));

let nextId = 1;
const call = (method, params) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    waiters.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => { waiters.delete(id); reject(new Error(`${method} timed out`)); }, 90000);
  });

const text = (res) => res?.result?.content?.[0]?.text ?? JSON.stringify(res);

const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok, detail }); };

try {
  const init = await call("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "probe", version: "1" },
  });
  check("initialize answers", !!init.result, init.result?.serverInfo?.version);

  const list = await call("tools/list", {});
  check("tools/list returns tools", (list.result?.tools?.length ?? 0) > 50, `${list.result?.tools?.length} tools`);

  const project = await call("tools/call", {
    name: "td_create_project",
    arguments: { name: "Probe project", code: "PRB" },
  });
  const projectText = text(project);
  check("td_create_project stores a row", !project.result?.isError, projectText.slice(0, 200));
  const projectId = JSON.parse(projectText)?.projectId ?? JSON.parse(projectText)?.id;

  const created = await call("tools/call", {
    name: "td_create_task",
    arguments: { name: "Probe task for the 8.28 upgrade", projectId },
  });
  const createdText = text(created);
  check("td_create_task stores a row", /TODO-\d+|success|created/i.test(createdText) && !created.result?.isError, createdText.slice(0, 200));

  const listed = await call("tools/call", { name: "td_list_tasks", arguments: {} });
  const listedText = text(listed);
  check("the task reads back", listedText.includes("Probe task for the 8.28 upgrade"), listedText.slice(0, 200));

  const health = await call("tools/call", { name: "td_sync_status", arguments: {} });
  const healthText = text(health);
  let parsed = null;
  try { parsed = JSON.parse(healthText); } catch { /* text form */ }
  const onSuccess = parsed?.onSuccessCount ?? (healthText.match(/"onSuccessCount":\s*(\d+)/)?.[1]);
  const onError = parsed?.onErrorCount ?? (healthText.match(/"onErrorCount":\s*(\d+)/)?.[1]);
  // Exactly two, one per mutation: a wrong option name is ignored at runtime,
  // the write still lands and the tool still reports success, so only the
  // count tells the two apart.
  check("onSuccess fires once per mutation (Evolu 8.28 name)", Number(onSuccess) === 2, `onSuccessCount=${onSuccess}, expected 2`);
  check("no mutation was refused", Number(onError) === 0, `onErrorCount=${onError}`);
} catch (e) {
  check("probe ran to the end", false, String(e));
} finally {
  child.kill();
}

for (const c of checks) console.log(`${c.ok ? "OK  " : "FAIL"} ${c.name}${c.detail ? ` :: ${c.detail}` : ""}`);
const bad = checks.filter((c) => !c.ok);
if (bad.length) {
  console.log("\n--- stderr ---\n" + stderr.join("").slice(-3000));
}
console.log(bad.length ? `\nVERDICT: FAIL (${bad.length}/${checks.length})` : `\nVERDICT: OK (${checks.length}/${checks.length})`);
process.exit(bad.length ? 1 : 0);
