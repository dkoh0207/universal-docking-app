// Starts the FastAPI backend and the Vite dev server together, with prefixed output; Ctrl+C stops both.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const win = process.platform === "win32";
const port = process.env.BACKEND_PORT || "8787";
const python = join(root, "backend", ".env", win ? "python.exe" : "bin/python");
const vite = join(root, "frontend", "node_modules", "vite", "bin", "vite.js");
const envNode = join(root, "frontend", ".env", win ? "node.exe" : "bin/node"); // Vite 8 needs Node 22.12+ (frontend/environment.yml)

const procs = [];
function start(label, color, cmd, args, opts) {
  const p = spawn(cmd, args, { ...opts, env: { ...process.env, PATH: [join(root, "backend", ".env", win ? "Library/bin" : "bin"), process.env.PATH].join(win ? ";" : ":"), BACKEND_PORT: port }, stdio: ["ignore", "pipe", "pipe"], });
  const tag = `\x1b[${color}m[${label}]\x1b[0m `;
  for (const s of [p.stdout, p.stderr]) {
    let buf = "";
    s.on("data", (d) => {
      buf += d;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const l of lines) if (l.trim()) console.log(tag + l);
    });
  }
  p.on("exit", (code) => { console.log(tag + `exited (${code})`); stop(code ?? 0); });
  procs.push(p);
}

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const p of procs) {
    if (p.exitCode !== null) continue;
    if (win) spawnSync("taskkill", ["/PID", String(p.pid), "/T", "/F"]);
    else p.kill();
  }
  process.exit(code);
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());

if (existsSync(python)) {
  start("api", "35", python, ["-m", "uvicorn", "app.main:app", "--port", port], { cwd: join(root, "backend") });
} else {
  console.log("\x1b[33m[dev]\x1b[0m backend/.env not found - starting the frontend only. Run `pnpm run setup` to enable docking.");
}
if (existsSync(vite)) start("web", "36", existsSync(envNode) ? envNode : process.execPath, [vite], { cwd: join(root, "frontend") });
else { console.log("[31m[dev][0m frontend dependencies missing - run `pnpm run setup`."); stop(1); }
