// Runs a frontend npm script (build, lint, check, ...) with Node and npm taken from frontend/.env, so it works
// without a system-wide Node. Usage: node scripts/frontend.mjs <script> [args...]
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const win = process.platform === "win32";
const env = join(root, "frontend", ".env");
if (!existsSync(env)) { console.error("frontend/.env is missing - run `npm run setup` first."); process.exit(1); }
const PATH = [win ? env : join(env, "bin"), process.env.PATH].join(win ? ";" : ":");
const r = spawnSync("npm", ["--prefix", "frontend", "run", ...process.argv.slice(2)], { cwd: root, stdio: "inherit", shell: win, env: { ...process.env, PATH } });
process.exit(r.status ?? 1);
