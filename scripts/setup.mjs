// Idempotent project-local setup: frontend deps, the Python env in backend/.env (backend/environment.yml)
// and AutoDock Vina in tools/vina (backend/tools.json).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

// ---- Python environment (spec: backend/environment.yml; re-applied whenever that file changes)
const envDir = join(root, "backend", ".env");
const envSpec = join(root, "backend", "environment.yml");
const envStamp = join(envDir, ".environment.sha1");
const obabel = win ? join(envDir, "Library", "bin", "obabel.exe") : join(envDir, "bin", "obabel");
const specHash = createHash("sha1").update(readFileSync(envSpec)).digest("hex");
const haveEnv = existsSync(obabel);
if (!haveEnv || !existsSync(envStamp) || readFileSync(envStamp, "utf8").trim() !== specHash) {
  const candidates = [process.env.CONDA_EXE, join(homedir(), "miniconda3", "Scripts", "conda.exe"), join(homedir(), "miniconda3", "bin", "conda"),
    join(homedir(), "anaconda3", "Scripts", "conda.exe"), join(homedir(), "anaconda3", "bin", "conda"), out(win ? "where" : "which", ["conda"]).split(/\r?\n/)[0], out(win ? "where" : "which", ["mamba"]).split(/\r?\n/)[0]];
  const conda = candidates.find((c) => c && existsSync(c));
  if (!conda) { console.error("conda not found. Install Miniconda (https://docs.conda.io/en/latest/miniconda.html) and re-run `npm run setup`."); process.exit(1); }
  // the package list comes from environment.yml, but is installed with --override-channels so only conda-forge is
  // used (`conda env create` would also pull in Anaconda's default channels, which need a ToS acceptance)
  // some conda-forge packages (e.g. typer) contain ~150-character paths, past Windows' 260-character limit in a deep folder
  if (win && envDir.length > 100) console.warn(`!! The project path is long (${envDir.length} chars). If conda fails with "No such file or directory", move the project to a shorter path or enable Windows long paths.`);
  const yml = readFileSync(envSpec, "utf8");
  const specs = [...yml.slice(yml.indexOf("dependencies:")).matchAll(/^\s+-\s+([^\s#]+)/gm)].map((m) => m[1]);
  const channels = ["--override-channels", "-c", "conda-forge"];
  console.log(`==> ${haveEnv ? "Updating" : "Creating"} the Python environment from backend/environment.yml: ${specs.join(" ")}`);
  run(conda, [haveEnv ? "install" : "create", "-p", envDir, ...channels, ...specs, "-y"]);
  writeFileSync(envStamp, specHash);
} else console.log("==> Python environment: ok");

// ---- AutoDock Vina: official release binary (conda-forge has no Windows build); version and assets in backend/tools.json
const vinaSpec = JSON.parse(readFileSync(join(root, "backend", "tools.json"), "utf8")).vina;
const vinaDir = join(root, "tools", "vina");
const vina = join(vinaDir, win ? "vina.exe" : "vina");
if (!existsSync(vina) || !out(vina, ["--version"]).includes(`v${vinaSpec.version}`)) {
  const fill = (str) => str.replaceAll("{version}", vinaSpec.version);
  const assetTpl = vinaSpec.assets[`${process.platform}-${process.arch}`];
  if (!assetTpl) { console.error("No Vina release for this platform; install vina and set VINA_BIN."); process.exit(1); }
  const asset = fill(assetTpl);
  console.log(`==> Downloading AutoDock Vina ${vinaSpec.version} (${asset})`);
  const res = await fetch(fill(vinaSpec.url).replace("{asset}", asset));
  if (!res.ok) { console.error(`Download failed: HTTP ${res.status}`); process.exit(1); }
  mkdirSync(vinaDir, { recursive: true });
  writeFileSync(vina, Buffer.from(await res.arrayBuffer()), { mode: 0o755 });
} else console.log("==> AutoDock Vina: ok");

console.log("\n" + out(vina, ["--version"]) + "\n" + out(obabel, ["-V"]));
console.log("\nSetup complete. Start everything with `npm run dev`.");
