// Idempotent project-local setup: frontend deps, the conda envs backend/.env (Python, engines) and frontend/.env (Node)
// and the downloaded docking engines in tools/ (Vina; optionally GNINA; backend/tools.json).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const win = process.platform === "win32";
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: root, ...opts });
  if (r.status !== 0) { console.error(`\n"${cmd} ${args.join(" ")}" failed`); process.exit(r.status ?? 1); }
};
const out = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" }).stdout?.trim() ?? "";

const findConda = () => {
  const candidates = [process.env.CONDA_EXE, join(homedir(), "miniconda3", "Scripts", "conda.exe"), join(homedir(), "miniconda3", "bin", "conda"),
    join(homedir(), "miniforge3", "bin", "conda"), join(homedir(), "anaconda3", "Scripts", "conda.exe"), join(homedir(), "anaconda3", "bin", "conda"),
    out(win ? "where" : "which", ["conda"]).split(/\r?\n/)[0], out(win ? "where" : "which", ["mamba"]).split(/\r?\n/)[0]];
  return candidates.find((c) => c && existsSync(c));
};

// ---- conda environments. Specs live in backend/environment.yml (Python, Open Babel, smina) and
// frontend/environment.yml (Node); each is re-applied whenever its file changes.
const envBinDir = (dir) => (win ? join(dir, "Library", "bin") : join(dir, "bin"));
function ensureEnv({ dir, spec, probe, label }) {
  const stamp = join(dir, ".environment.sha1");
  const hash = createHash("sha1").update(readFileSync(spec)).digest("hex");
  const have = existsSync(probe);
  if (have && existsSync(stamp) && readFileSync(stamp, "utf8").trim() === hash) { console.log(`==> ${label} environment: ok`); return; }
  const conda = findConda();
  if (!conda) { console.error("conda not found. Install Miniconda (https://docs.conda.io/en/latest/miniconda.html) and re-run `npm run setup`."); process.exit(1); }
  // the package list comes from the yml, but is installed with --override-channels so only conda-forge is
  // used (`conda env create` would also pull in Anaconda's default channels, which need a ToS acceptance)
  // some conda-forge packages (e.g. typer) contain ~150-character paths, past Windows' 260-character limit in a deep folder
  if (win && dir.length > 100) console.warn(`!! The project path is long (${dir.length} chars). If conda fails with "No such file or directory", move the project to a shorter path or enable Windows long paths.`);
  const yml = readFileSync(spec, "utf8");
  const specs = [...yml.slice(yml.indexOf("dependencies:")).matchAll(/^\s+-\s+([^\s#]+)/gm)].map((m) => m[1]);
  console.log(`==> ${have ? "Updating" : "Creating"} the ${label} environment from ${spec.slice(root.length + 1)}: ${specs.join(" ")}`);
  run(conda, [have ? "install" : "create", "-p", dir, "--override-channels", "-c", "conda-forge", ...specs, "-y"]);
  writeFileSync(stamp, hash);
}

const envDir = join(root, "backend", ".env");
ensureEnv({ dir: envDir, spec: join(root, "backend", "environment.yml"), label: "Python", probe: win ? join(envDir, "Library", "bin", "obabel.exe") : join(envDir, "bin", "obabel") });
const nodeDir = join(root, "frontend", ".env");
ensureEnv({ dir: nodeDir, spec: join(root, "frontend", "environment.yml"), label: "Node", probe: win ? join(nodeDir, "node.exe") : join(nodeDir, "bin", "node") });

// ---- frontend dependencies (npm comes from the Node env)
const envPath = { ...process.env, PATH: [envBinDir(nodeDir), win ? nodeDir : "", process.env.PATH].filter(Boolean).join(win ? ";" : ":") };
if (!existsSync(join(root, "frontend", "node_modules"))) {
  console.log("==> Installing frontend dependencies");
  run("npm --prefix frontend ci", [], { shell: true, env: envPath });
} else console.log("==> Frontend dependencies: ok");

// ---- downloaded docking engines (backend/tools.json). smina comes from conda (environment.yml). Optional ones, such as
// GNINA (~2 GB), are installed only with `npm run setup -- --gnina` (or `--all`).
const toolSpecs = JSON.parse(readFileSync(join(root, "backend", "tools.json"), "utf8"));
const wanted = (id) => !toolSpecs[id].optional || process.argv.includes(`--${id}`) || process.argv.includes("--all");
const binPath = {};
for (const [id, spec] of Object.entries(toolSpecs)) {
  const bin = join(root, "tools", id, win && id === "vina" ? "vina.exe" : id);
  binPath[id] = bin;
  if (!wanted(id)) { console.log(`==> ${id}: skipped (optional, pass --${id})`); continue; }
  const assetTpl = spec.assets[`${process.platform}-${process.arch}`];
  if (!assetTpl) {
    if (spec.optional) { console.log(`==> ${id}: not available for ${process.platform}-${process.arch}, skipped`); continue; }
    console.error(`No ${id} release for this platform; install it and set ${id.toUpperCase()}_BIN.`); process.exit(1);
  }
  if (id === "gnina") {
    // GNINA's static build still loads cuDNN 9 dynamically: take it from conda-forge into the same env (libcublas etc. come with it)
    const conda = findConda();
    if (!conda) { console.error("conda not found (needed for cuDNN)."); process.exit(1); }
    if (!existsSync(join(envDir, "lib", "libcudnn.so.9"))) {
      console.log("==> Installing cuDNN into backend/.env (for GNINA)");
      run(conda, ["install", "-p", envDir, "--override-channels", "-c", "conda-forge", "cudnn=9", "cuda-version=12.8", "-y"]);
    }
  }
  const marker = join(root, "tools", id, ".version");
  if (existsSync(bin) && existsSync(marker) && readFileSync(marker, "utf8").trim() === spec.version) { console.log(`==> ${id}: ok`); continue; }
  const fill = (str) => str.replaceAll("{version}", spec.version);
  const asset = fill(assetTpl);
  console.log(`==> Downloading ${id} ${spec.version} (${asset})${spec.note ? ` - ${spec.note}` : ""}`);
  const res = await fetch(fill(spec.url).replace("{asset}", asset));
  if (!res.ok) { console.error(`Download failed: HTTP ${res.status}`); process.exit(1); }
  mkdirSync(dirname(bin), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(bin, { mode: 0o755 }));
  writeFileSync(marker, spec.version);
}
const smina = join(envDir, win ? "Library/bin/smina.exe" : "bin/smina");

process.env.LD_LIBRARY_PATH = `${join(envDir, "lib")}:${process.env.LD_LIBRARY_PATH ?? ""}`;
for (const bin of [binPath.vina, smina, binPath.gnina, obabel]) if (existsSync(bin)) console.log(out(bin, [bin === obabel ? "-V" : "--version"]).split("\n")[0]);
console.log("\nSetup complete. Start everything with `npm run dev`.");
