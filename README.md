# PyMOL Web

A PyMOL-style viewer for RCSB PDB structures in the browser (TypeScript), plus a Docking page backed by a small FastAPI service that runs AutoDock Vina.
Rendering is done by [3Dmol.js](https://3dmol.org). On top of it the app keeps PyMOL's model: every atom has its own representations and color, and there are named selections and a PyMOL selection language. Every button in the UI runs a PyMOL-syntax command through a built-in interpreter (`frontend/src/commands.ts`); there is no console in the UI, and command errors show as toasts.

The UI is available in English and Korean, in light and dark themes (switches at the top right; both choices are remembered).

Built with Vite, 3Dmol.js, Lucide icons and the Pretendard font.


> **Agents: use pnpm, never npm/npx.** Run JS commands as `pnpm run <script>`, install with `pnpm add <pkg>`, run binaries with `pnpm exec <bin>` / `pnpm dlx <pkg>`. Do not create or commit `package-lock.json`.

## Layout

```
frontend/   Vite + TypeScript app (3Dmol.js viewer + Docking page)
backend/    FastAPI app (docking API); Python env in backend/.env (conda, git-ignored)
tools/      downloaded binaries, e.g. tools/vina/vina.exe (git-ignored)
scripts/    dev.mjs (foreground dev launcher), setup.mjs (one-time setup)
server.sh   background dev/prod server manager
```

## Installation

**Prerequisites**

| Tool | Version | Notes |
|------|---------|-------|
| [Git](https://git-scm.com/) | any | on Windows, Git for Windows also provides **Git Bash**, which `server.sh` needs |
| [Node.js](https://nodejs.org/) | 20+ (tested on 24) | Node ships with the conda env; pnpm 10 also comes from the conda env; use pnpm (not npm) for all JS commands |
| [Miniconda](https://docs.conda.io/en/latest/miniconda.html) or Anaconda | any | used to create the backend's Python env; does not need to be on `PATH` (setup also looks in `~/miniconda3` and `~/anaconda3`, or set `CONDA_EXE`) |

Tested on Windows 11. The Linux/macOS code paths exist but have not been tested.

**Steps**

```bash
git clone <repo-url> pymol-web
cd pymol-web
pnpm run setup
```

`pnpm run setup` installs everything inside the project folder and is safe to re-run. It does three things:

1. Installs the frontend packages (`pnpm install --frozen-lockfile` in `frontend/`, lockfile `frontend/pnpm-lock.yaml`; `frontend/.npmrc` sets `node-linker=hoisted` so `node_modules` has no symlinks and works on `/mnt` and Windows).
2. Creates the Python env `backend/.env` from `backend/environment.yml`, using conda-forge only. This takes a few minutes the first time.
3. Downloads AutoDock Vina from the [official releases](https://github.com/ccsb-scripps/AutoDock-Vina/releases) to `tools/vina/`, using the version in `backend/tools.json`.

It finishes by printing the Vina and Open Babel versions.

On Windows, keep the project in a short path such as `C:\Users\you\pymol-web`. A few conda-forge packages contain deeply nested files, and a deep folder can exceed Windows' 260-character path limit, which makes conda fail with "No such file or directory". Enabling Windows long paths also fixes it.

### Backend requirements

Everything the backend needs is declared in the repo. Nothing is installed globally.

| What | Version | Where it is declared | Installed to |
|------|---------|----------------------|--------------|
| Python | 3.12 | `backend/environment.yml` | `backend/.env` |
| Open Babel (`obabel`) | 3.2 | `backend/environment.yml` | `backend/.env` (`Library/bin/obabel.exe` on Windows, `bin/obabel` elsewhere) |
| FastAPI, uvicorn, pydantic | 0.142 / 0.54 / 2.13 | `backend/environment.yml` | `backend/.env` |
| AutoDock Vina | 1.2.7 | `backend/tools.json` (version and per-platform release assets) | `tools/vina/vina(.exe)` |

- **Changing a version:** edit `environment.yml` or `tools.json` and re-run `pnpm run setup`.
  - Setup keeps a hash of `environment.yml` in `backend/.env/.environment.sha1` and re-applies the file when it changes.
  - It downloads Vina again if `vina --version` doesn't match `tools.json`.
  - To start the env from scratch, delete `backend/.env`.
- **conda channels:** packages come from **conda-forge only**. Setup installs with `--override-channels -c conda-forge`, so it never touches Anaconda's default channels or their terms-of-service prompt. Vina isn't installed through conda because conda-forge has no Windows build.
- **Without conda:** `backend/requirements.txt` has the pip equivalents. Install Open Babel and Vina yourself and point the backend at them with `OBABEL_BIN` and `VINA_BIN`. Tools are looked up in this order: environment variable, project-local path, then `PATH`.
- **Checking what the backend found:** `GET /api/dock/status` (also shown on the Docking page) reports the Vina and Open Babel versions in use, or `null` for a missing tool.

The Viewer page works without the backend. Only the Docking page needs it.

## Launch

| | Command | Open |
|---|---|---|
| **Dev**, foreground (Ctrl+C stops both) | `pnpm run dev` | http://127.0.0.1:5179 |
| **Dev**, background | `./server.sh start dev` | http://127.0.0.1:5179 |
| **Prod**, background | `./server.sh start prod` (or `pnpm start`) | http://127.0.0.1:8080 |
| Status | `./server.sh status` (or `pnpm run status`) | |
| Stop | `./server.sh stop` (or `pnpm stop`) | |

On Windows, run `server.sh` from Git Bash. The `pnpm` scripts work from any shell as long as `bash` is on `PATH`.

- **Dev** runs Vite with hot reload on :5179 and uvicorn with `--reload` on :8787. Vite forwards `/api` to uvicorn.
- **Prod** builds `frontend/dist`, then runs one uvicorn process on :8080 that serves the API under `/api` and the built app at `/`. Add `--no-build` to reuse the last build. `pnpm run build` only type-checks and builds.

The backend serves `frontend/dist` when `PYMOL_WEB_STATIC` points to it. The script sets this in prod; dev mode does not. Change ports with `WEB_PORT`, `BACKEND_PORT` and `PROD_PORT`. Port 8000 is deliberately not used because other local tools often take it. Both servers listen on 127.0.0.1 only and have no authentication, so don't expose them to a network as they are.

### `server.sh`

```
./server.sh start [dev|prod] [--no-build]   start in the background (default dev); refuses if already running or the port is taken
./server.sh stop [dev|prod|all]             stop the processes and their children (default all); cleans stale pid files
./server.sh restart [dev|prod]
./server.sh status                          state, PID, port, URL and /api/health result of each process
./server.sh logs [dev|prod] [-f]
```

PIDs are kept in `.run/<mode>-<name>.pid` and logs in `.run/logs/<mode>-<name>.log`. It works in Git Bash on Windows (it uses `taskkill //T //F` to stop whole process trees) and on Linux/macOS. `pnpm start` / `pnpm stop` / `pnpm run status` call it too.

Open `?pdb=4hhb` to load a specific entry at startup. The default is 1HSG.

## Docking page (AutoDock Vina)

The **Docking** tab (top bar; remembered in the URL hash `#dock`) has its own 3D view and sidebar:

1. **Receptor**: pick a protein loaded in the Viewer; water is removed by default, metals and cofactors can be kept.
2. **Ligand**: a ligand from the receptor structure (for re-docking), an uploaded `.sdf` / `.mol2` / `.pdb`, or a SMILES string (a 3D structure is generated).
3. **Search box**: center and size, or "Center on ligand" / "Viewer selection" with a padding slider (size = extent + padding). The box is drawn live.
4. **Parameters**: exhaustiveness, number of poses, energy range, scoring (Vina / Vinardo), seed, CPU threads.
5. **Run**: the backend prepares the receptor and ligand with Open Babel (`-p 7.4`), runs Vina and streams progress. **Cancel** kills the Vina process tree.
6. **Results**: affinity table (click a row to show that pose; for ligands taken from the structure there is an RMSD column against the crystal pose), show all poses, polar contacts, **Send to Viewer**, and download of `out.pdbqt`.

Redocking check (1HSG + indinavir MK1, exhaustiveness 8, seed 42, box = ligand extent + 8 Å): the top pose scores about -11.5 kcal/mol at 0.37 Å heavy-atom RMSD from the crystal ligand. Reproduce it against a running backend:

```bash
backend/.env/python backend/tests/redock_1hsg.py --base http://127.0.0.1:8787
```

### API

| Endpoint | |
|----------|---|
| `GET /api/health` | liveness and tool versions |
| `GET /api/dock/status` | `{ vina, obabel }` versions, or `null` for a missing tool |
| `POST /api/dock/jobs` | start a job (`receptor_pdb`, `ligand {text, format: pdb\|sdf\|mol2\|smiles}`, `center`, `size`, `exhaustiveness`, `num_modes`, `energy_range`, `seed`, `cpu`, `scoring`) -> `{ id }` |
| `GET /api/dock/jobs/{id}/events` | server-sent events: `stage`, `progress` (0-100), `log`, `done` (`poses` PDBQT + `modes`), `error` |
| `DELETE /api/dock/jobs/{id}` | cancel |

Interactive docs: `/docs` on the backend port.

## MD page (OpenMM + ProLIF)

A third tab runs a short explicit-solvent simulation of the receptor shared with the Viewer and Docking pages (the active structure) plus the crystal ligand or a docked pose. Backend: `backend/app/routers/md.py` starts `app/md/simulate.py` (PDBFixer, Amber14 + OpenFF 2.1 ligand parameters, TIP3P, PME, minimise, NVT, NPT with restraints released, production) and then `app/md/analysis.py` (MDAnalysis metrics and the ProLIF interaction history).

- Settings in the sidebar: production time, frame interval (granularity), time step / HMR, temperature, pressure, friction, box padding, salt, water model and force fields, minimisation and equilibration lengths, restraints, platform, wall-time cap and seed.
- Results: 3D trajectory player; ProLIF residue x frame contact map (click a row to show the residue); stability plots (backbone and ligand RMSD, RMSF, radius of gyration, ligand-pocket distance, contacts); run-quality plots and checks (temperature, density, potential-energy drift, RMSD plateau).
- Ligand charges: `gasteiger` (default, instant), `mmff94`, or `nagl` (AM1-BCC quality, but importing PyTorch from a Windows-mounted disk adds 1-3 minutes). AM1-BCC through `sqm` is not offered: it ran for 190 CPU-minutes on a 92-atom ligand.
- Tested: `backend/.env/python backend/tests/md_1hsg.py` redocks 1HSG/MK1 (Vina, 0.36 A) and simulates the top pose for 0.1 ns on an RTX 5060 (CUDA, ~196 ns/day): 238 s in total, all quality checks pass, ProLIF finds Ile50 / Asp25 / Arg8 contacts.
- The position restraints use `periodicdistance()`; a plain squared distance breaks on the GPU, where atoms are wrapped into the periodic box (symptom: NaN right after minimisation).

## Bundled examples (`frontend/public/structures/`, downloaded from files.rcsb.org)

| ID | Structure |
|----|-----------|
| 1UBQ | Ubiquitin |
| 4HHB | Deoxy hemoglobin (4 chains + heme) |
| 1HSG | HIV-1 protease + indinavir |
| 6LU7 | SARS-CoV-2 main protease + N3 inhibitor |
| 1CRN | Crambin |
| 1BNA | B-DNA dodecamer |

You can fetch any other ID live from RCSB (as mmCIF). You can also upload or drag in `.pdb/.cif/.sdf/.mol2/.xyz/.pqr` files.

## Features

- **Representations**: cartoon, ribbon/trace, surface, mesh, sticks, lines, spheres, ball & stick, nonbonded. Each one can be toggled or set as the only one ("show only"), on any target.
- **Color schemes**: by chain, rainbow N→C, secondary structure, element, B-factor, hydrophobicity, residue type, ocean gradient.
- **Surface**: VdW / SAS / molecular surface types and transparency; the surface follows the residue colors. Picking a type in the Surface card shows the surface on the target, and clicking the highlighted type again hides it. The "Distance to ligand center" slider limits the surface to protein residues within that distance of a ligand's center (0 = whole surface).
- **Selections**: click residues, atoms or chains in 3D or in the sequence bar (shift-click selects a range). Named selections can be indicated, zoomed or deleted.
- **Measurements**: distance, angle and dihedral by clicking atoms, plus ligand–protein polar contacts. The Polar contacts and Ligand pocket buttons and the ligand chips toggle on and off; "Default" undoes what the other presets change.
- **Water**: hidden by default; the Scene → Water switch shows it as ball & stick. Presets leave it alone.
- **View**: reset, orient (principal axes), zoom, center, spin, rock, front clipping, fog, outline, orthographic projection, PNG export, light/dark theme (the background follows the theme).
- **Presets**: simple, ligand sites, pretty surface, publication, ball & stick, B-factor.
- **Info panel**: RCSB metadata (title, method, resolution, organism) and ligand chips that select and zoom to the ligand.

## Commands behind the UI

The interpreter understands PyMOL syntax, for example:

```
hide everything; show cartoon; show sticks, organic
select site, byres organic around 5
spectrum b, blue_white_red
polar_contacts            # ligand–protein contacts; "polar_contacts off" removes them
preset.ligand_sites
```

**Selection language**: `all`, `chain`, `resi` (ranges like `10-20+35`), `resn`, `name`, `elem`, `ss h/s/l`, `b > 50`, `polymer`, `protein`, `nucleic`, `organic`, `inorganic`, `solvent`, `hetatm`, `hydrogens`, `backbone`, `sidechain`, `metals`, `model`, and PyMOL macros like `/obj//A/25/CA` or `A/25/`. You can combine them with `and`/`or`/`not` and parentheses, and use `byres`, `bychain`, `around`, `expand`, `within … of`, `beyond … of`, `first`, `last` and `neighbor`.

## Code layout

| File | Purpose |
|------|---------|
| `frontend/src/viewer.ts` | `Scene`: wraps 3Dmol and holds the per-atom reps and colors, surfaces, labels, measurements, the docking box and view ops |
| `frontend/src/selection.ts` | PyMOL selection-language parser and evaluator |
| `frontend/src/commands.ts` | PyMOL command interpreter (every UI control runs through it) |
| `frontend/src/dock/` | Docking page: `panel.ts` (sidebar cards, jobs, results), `pdb.ts` (PDB/PDBQT helpers) |
| `frontend/src/api.ts` | fetch + EventSource client for the backend |
| `frontend/src/i18n.ts` | English / Korean UI strings |
| `frontend/src/colors.ts` | PyMOL color names, element colors, palettes, gradients |
| `frontend/src/rcsb.ts` | RCSB file download and entry metadata |
| `frontend/src/ui/*` | Sidebar, sequence bar, icons, toasts |
| `backend/app/` | `main.py` (app, /api, optional static mount), `tools.py` (binary lookup), `jobs.py` (generic job manager), `routers/dock.py` |
| `backend/tests/redock_1hsg.py` | Redocking acceptance test |

## Differences from desktop PyMOL

This is not PyMOL itself: PyMOL can't run in a browser, so 3Dmol.js does the rendering here. There is no ray tracing (`ray` is an alias for `png`), and there are no movies, states or alignment commands. Transparency settings apply to a whole object, not per atom, because 3Dmol works that way. `polar_contacts` only looks at ligand–protein pairs and uses a simple N/O distance cutoff, not PyMOL's H-bond geometry check.
