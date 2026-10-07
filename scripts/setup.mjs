// Idempotent project-local setup: Python env (Open Babel + FastAPI) in backend/.env, AutoDock Vina in tools/vina, frontend deps.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const win = process.platform === "win32";
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: root, ...opts });
  if (r.status !== 0) { console.error(`\n"${cmd} ${args.join(" ")}" failed`); process.exit(r.status ?? 1); }
};
const out = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" }).stdout?.trim() ?? "";

// ---- frontend dependencies
if (!existsSync(join(root, "frontend", "node_modules"))) {
  console.log("==> Installing frontend dependencies");
  run("npm --prefix frontend ci", [], { shell: true });
} else console.log("==> Frontend dependencies: ok");

// ---- Python environment
const envDir = join(root, "backend", ".env");
const obabel = win ? join(envDir, "Library", "bin", "obabel.exe") : join(envDir, "bin", "obabel");
if (!existsSync(obabel)) {
  console.log("==> Creating the Python environment (conda-forge: python, openbabel, fastapi, uvicorn)");
  const candidates = [process.env.CONDA_EXE, join(homedir(), "miniconda3", "Scripts", "conda.exe"), join(homedir(), "miniconda3", "bin", "conda"),
    join(homedir(), "anaconda3", "Scripts", "conda.exe"), join(homedir(), "anaconda3", "bin", "conda"), out(win ? "where" : "which", ["conda"]).split(/\r?\n/)[0], out(win ? "where" : "which", ["mamba"]).split(/\r?\n/)[0]];
  const conda = candidates.find((c) => c && existsSync(c));
  if (!conda) { console.error("conda not found. Install Miniconda (https://docs.conda.io/en/latest/miniconda.html) and re-run `npm run setup`."); process.exit(1); }
  run(conda, ["create", "-p", envDir, "-c", "conda-forge", "--override-channels", "python=3.12", "openbabel", "fastapi", "uvicorn", "pydantic", "-y"]);
} else console.log("==> Python environment: ok");

// ---- AutoDock Vina (conda-forge has no Windows build, so use the official release binaries)
const vinaDir = join(root, "tools", "vina");
const vina = join(vinaDir, win ? "vina.exe" : "vina");
if (!existsSync(vina)) {
  const arm = process.arch === "arm64";
  const asset = { win32: "vina_1.2.7_win.exe", linux: `vina_1.2.7_linux_${arm ? "aarch64" : "x86_64"}`, darwin: `vina_1.2.7_mac_${arm ? "aarch64" : "x86_64"}` }[process.platform];
  if (!asset) { console.error("No Vina release for this platform; install vina and set VINA_BIN."); process.exit(1); }
  console.log(`==> Downloading AutoDock Vina 1.2.7 (${asset})`);
  const res = await fetch(`https://github.com/ccsb-scripps/AutoDock-Vina/releases/download/v1.2.7/${asset}`);
  if (!res.ok) { console.error(`Download failed: HTTP ${res.status}`); process.exit(1); }
  mkdirSync(vinaDir, { recursive: true });
  writeFileSync(vina, Buffer.from(await res.arrayBuffer()), { mode: 0o755 });
} else console.log("==> AutoDock Vina: ok");

console.log("\n" + out(vina, ["--version"]) + "\n" + out(obabel, ["-V"]));
console.log("\nSetup complete. Start everything with `npm run dev`.");
