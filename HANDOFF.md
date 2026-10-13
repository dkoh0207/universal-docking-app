# Handoff: state after the multi-engine + shadcn/React work

Work happens in place in `/mnt/c/Users/user/pymol-viewer` (WSL, Ubuntu 24.04, RTX 5060 passthrough). The user reviews in a Windows browser at http://localhost:5179/ (Docking: `/#dock`; fallback: WSL IP from `hostname -I`). Preferences: Sonnet 5.5; everything confined to conda envs where possible; do NOT suggest the Claude in Chrome extension; no mobile support; keep replies short, and the user interrupts long tool calls (prefer small steps).

**Package manager: pnpm only (user preference). Never use npm/npx.**

## Done
- **Engines (backend)**: `backend/app/engines.py` registry (vina, smina via conda, GNINA 1.3.3 opt-in download + conda cuDNN), engine-aware `/api/dock/*`, `redock_1hsg.py --engine`. Redock baselines (1HSG/MK1, exh 8, seed 42): Vina -11.51 kcal/mol 0.36 Å; smina -12.96 0.45 Å; GNINA -12.04 0.84 Å (CNN-ranked, runs on the GPU).
- **Two conda envs** (real clash: smina pins boost 1.82 -> ICU 73, Node >= 22.12 needs newer ICU): `backend/.env` (Python, Open Babel 3.1, smina) and `frontend/.env` (Node >= 22.12 only; Vite 8/Rolldown needs it, and npm silently skips the Linux Rolldown binding on older Node). `scripts/setup.mjs` creates both; `server.sh`, `scripts/dev.mjs` and the new `scripts/frontend.mjs` put `frontend/.env` on PATH. Root scripts: `build`, `lint`, `check`, `format` delegate to the frontend through `scripts/frontend.mjs`.
- **Frontend migrated to React 19 + Tailwind v4 + shadcn/ui (radix-nova) + lucide-react**: `src/components/ui/` is shadcn output (CLI-managed), app components in `src/components/{viewer,dock}`, theme tokens in `src/index.css` (old blue palette, `data-theme` light/dark, Pretendard). Framework-free parts kept: `viewer.ts` (Scene), `commands.ts`, `selection.ts`, `core.ts` (scenes, interpreters, `viewerUi`/`appUi` stores), `measure.ts`, `actions.ts`, `dock/controller.ts` (docking logic; React renders from `ctl.store`). i18n: `useT()` hook over the `STRINGS` table.
- **Engine UI**: engine Select at the top of Parameters, per-engine scoring, GNINA CNN scoring / pose sort / CPU-only, status card listing every engine's version or "not installed", CNN columns for GNINA, RMSD bounds hidden for GNINA. "vs crystal" column now uses element-aware nearest-neighbour RMSD (`rmsdNearest` in `dock/pdb.ts`) because Open Babel 3.1 writes bare-element atom names.
- Vite polls for changes when the project is under `/mnt/` (inotify does not work on DrvFs).
- Verified in headless Chromium (Playwright, installed in the session scratchpad, not in the repo): Viewer and Docking render in EN/KO and light/dark without console errors; a UI redock with each engine works (Vina 0.36 Å, GNINA 0.83 Å vs crystal); Cancel kills the engine process.

## Not verified / known gaps (do these first)
1. **`pnpm run check` was NOT run to completion.** The last edits (4 ESLint fixes: literal colors in `viewer/sidebar.tsx` and `viewer/stage.tsx`, regex spaces in `dock/pdb.ts`, an expression statement in `viewer.ts`; `check` script without `format:check`) were applied just before committing. Run `pnpm run check` and fix what remains.
2. `eslint.config.js` and `.prettierrc.json` exist, but Prettier was never run over the repo (`pnpm run format` would reformat legacy files; do it as its own commit if wanted).
3. Not tested in a real browser pass: Viewer behaviors after the port (water hidden by default, ligand-distance surface slider, measure mode, sequence clicks, drag-and-drop, upload, fullscreen), the `#dock` hash on reload, and the "backend offline" / "engine missing" messages. `pnpm start` (production build on :8080) is untested after the migration.
4. The slider in the Docking page and others use shadcn defaults; light-theme contrast was only spot-checked.
5. Tests: the `scripts/setup.mjs` rewrite (two envs) was not re-run from scratch. Try `rm -rf frontend/.env frontend/node_modules && pnpm run setup` to validate. The backend env's stamp changed (nodejs removed from `backend/environment.yml`); setup will re-apply it.
6. README is not updated: engines table, per-engine baseline table, two-env explanation, `pnpm run setup -- --gnina`, WSL notes (use `/mnt` polling), `pnpm run lint/check`, API status shape (`{engines:{vina,smina,gnina}, obabel}`), and a note that shadcn has no official lint command (use the shadcn CLI `add`/`diff` for component sources).
7. TypeScript tooling quirk: `typescript` is aliased to `@typescript/typescript6` (needed by typescript-eslint), while `typescript-native` (TS 7) provides the `tsc` binary. `@vitejs/plugin-react` must be v6 (Vite 8).
8. A zombie `[vina] <defunct>` entry appeared after a cancelled run (dead process, not reaped yet); check `jobs.py` reaps children after cancel.

## Run
- `bash server.sh start dev` (Vite :5179, API :8787), `bash server.sh status|logs|stop`; `pnpm run dev` runs both in the foreground.
- Headless checks: Playwright lives in the session scratchpad only; reinstall with `pnpm add playwright && pnpm exec playwright install chromium` in a scratch dir (set `PLAYWRIGHT_BROWSERS_PATH`).
