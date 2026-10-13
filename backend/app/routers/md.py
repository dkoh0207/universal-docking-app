"""Molecular dynamics (OpenMM) of a protein-ligand complex, then trajectory analysis (ProLIF, RMSD, ...). See app/md/."""

import asyncio
import datetime
import json
import shutil
import sys
import urllib.request
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from .. import tools
from ..jobs import Job, manager
from .dock import events_stream

router = APIRouter(prefix="/md", tags=["md"])
BACKEND = Path(__file__).resolve().parents[2]
EXAMPLES = BACKEND / "examples" / "md"  # bundled, read-only runs
RUNS = tools.ROOT / ".run" / "md-runs"  # runs saved after each successful job (gitignored)
PY = sys.executable


class MdRequest(BaseModel):
    receptor_pdb: str = Field(min_length=1)
    ligand_pdb: str = Field(min_length=1)  # the pose, PDB format (all atoms, bond orders not needed)
    smiles: str | None = None  # bond-order template; default: the RCSB chemical component of `ligand_resname`
    ligand_resname: str | None = None
    label: str = ""  # shown in the past-runs list, e.g. "1IEP · Docked pose 1"
    # simulation
    production_ns: float = Field(0.1, gt=0, le=100)
    report_ps: float = Field(10, ge=0.1, le=1000)  # frame interval (granularity of the trajectory and of the ProLIF history)
    timestep_fs: float = Field(2, ge=0.5, le=4)
    hmr: bool = False  # hydrogen mass repartitioning (allows 4 fs)
    temperature_k: float = Field(300, ge=100, le=500)
    pressure_bar: float = Field(1, ge=0.1, le=1000)
    barostat_interval: int = Field(25, ge=1, le=1000)
    friction_ps: float = Field(1, gt=0, le=100)
    # system
    padding_nm: float = Field(1.0, ge=0.5, le=3)
    ionic_strength_m: float = Field(0.15, ge=0, le=2)
    water_model: Literal["tip3p", "tip4pew", "spce"] = "tip3p"
    protein_ff: Literal["amber14-all", "amber99sbildn"] = "amber14-all"
    ligand_ff: Literal["openff-2.1.0", "gaff-2.11"] = "openff-2.1.0"
    cutoff_nm: float = Field(1.0, ge=0.6, le=1.5)
    ligand_charges: Literal["gasteiger", "mmff94", "nagl"] = "gasteiger"  # nagl: AM1-BCC-like GNN charges (+~1 min importing PyTorch); gasteiger / mmff94: instant, rougher
    # equilibration
    minimize_steps: int = Field(1000, ge=0, le=20000)
    nvt_ps: int = Field(50, ge=0, le=2000)
    npt_ps: int = Field(100, ge=1, le=5000)
    restraint_k: float = Field(1000, ge=0, le=10000)  # kJ/mol/nm^2 on protein backbone + ligand during NVT, ramped to 0 in NPT
    # run
    platform: Literal["auto", "CUDA", "OpenCL", "CPU"] = "auto"
    max_wall_s: int = Field(300, ge=60, le=86400)  # total wall-clock budget; production stops early and the finished frames are analysed
    seed: int = Field(42, ge=0)


@router.get("/status")
def status():
    """Installed MD packages. Reads package metadata only: importing openmmforcefields / PyTorch takes about a minute on a slow disk."""
    from importlib import metadata

    names = {"openmm": "openmm", "prolif": "prolif", "mdanalysis": "MDAnalysis", "openmmforcefields": "openmmforcefields", "pdbfixer": "pdbfixer"}
    try:
        v = {k: metadata.version(n) for k, n in names.items()}
    except metadata.PackageNotFoundError as e:
        return {"ok": False, "error": f"{e} is not installed"}
    platforms = ["CPU", "Reference"]
    try:  # a CUDA/OpenCL plugin library on disk (no context is created here)
        import openmm

        platforms = [openmm.Platform.getPlatform(i).getName() for i in range(openmm.Platform.getNumPlatforms())]
    except Exception:  # noqa: BLE001
        pass
    return {"ok": True, "openmm": v["openmm"], "prolif": v["prolif"], "platforms": platforms}


@router.post("/jobs")
async def create_job(req: MdRequest):
    if not (req.smiles or req.ligand_resname):
        raise HTTPException(422, "Give the ligand SMILES or its residue name")
    job = manager.create("md", lambda j: run_md(j, req))
    return {"id": job.id}


@router.get("/jobs/{job_id}/events")
async def events(job_id: str, request: Request):
    return await events_stream(job_id, request)


@router.delete("/jobs/{job_id}")
async def cancel_job(job_id: str):
    job = manager.get(job_id)
    if not job:
        raise HTTPException(404, "Unknown job")
    return {"cancelled": await job.cancel()}


def _run_dirs() -> dict[str, tuple[Path, bool]]:
    """id -> (directory, is_example) of every stored run."""
    out: dict[str, tuple[Path, bool]] = {}
    for base, example in ((EXAMPLES, True), (RUNS, False)):
        if base.is_dir():
            for d in base.iterdir():
                if (d / "run.json").is_file() and (d / "results.json").is_file():
                    out[("ex-" if example else "run-") + d.name] = (d, example)
    return out


@router.get("/runs")
def list_runs():
    """Stored runs (bundled examples and saved runs), newest first."""
    rows = []
    for rid, (d, example) in _run_dirs().items():
        try:
            rows.append({"id": rid, "example": example, **json.loads((d / "run.json").read_text())})
        except (OSError, ValueError):
            continue
    return sorted(rows, key=lambda r: r.get("created", ""), reverse=True)


def _run_file(run_id: str, name: str) -> Path:
    entry = _run_dirs().get(run_id)
    if not entry or not (entry[0] / name).is_file():
        raise HTTPException(404, "Unknown run")
    return entry[0] / name


@router.get("/runs/{run_id}/results")
def run_results(run_id: str):
    return Response(_run_file(run_id, "results.json").read_bytes(), media_type="application/json")


@router.get("/runs/{run_id}/view.pdb")
def run_view(run_id: str):
    return FileResponse(_run_file(run_id, "view.pdb"), media_type="chemical/x-pdb")


@router.delete("/runs/{run_id}")
def delete_run(run_id: str):
    entry = _run_dirs().get(run_id)
    if not entry:
        raise HTTPException(404, "Unknown run")
    if entry[1]:
        raise HTTPException(403, "Bundled examples cannot be deleted")
    shutil.rmtree(entry[0], ignore_errors=True)
    return {"deleted": True}


def save_run(job: Job, req: MdRequest):
    """Keep the results of a finished job (the job directory is deleted after an hour)."""
    r = json.loads((job.dir / "results.json").read_text())
    m = r["meta"]
    dest = RUNS / job.id
    dest.mkdir(parents=True, exist_ok=True)
    for f in ("results.json", "view.pdb"):
        shutil.copy2(job.dir / f, dest / f)
    (dest / "run.json").write_text(json.dumps({
        "name": req.label or "MD run", "created": datetime.datetime.now().isoformat(timespec="seconds"),
        "production_ns": req.production_ns, "frames": m["frames"], "platform": m["platform"], "atoms": m["atoms"],
        "checks_ok": sum(c["ok"] for c in r["checks"]), "checks": len(r["checks"])}))


@router.get("/jobs/{job_id}/results")
def results(job_id: str):
    job = manager.get(job_id)
    f = job.dir / "results.json" if job else None
    if not f or not f.is_file():
        raise HTTPException(404, "No results")
    return Response(f.read_bytes(), media_type="application/json")


@router.get("/jobs/{job_id}/view.pdb")
def view(job_id: str):
    job = manager.get(job_id)
    f = job.dir / "view.pdb" if job else None
    if not f or not f.is_file():
        raise HTTPException(404, "No trajectory")
    return FileResponse(f, media_type="chemical/x-pdb")


def ccd_smiles(code: str) -> str:
    """Isomeric SMILES of a PDB chemical component (RCSB data API)."""
    url = f"https://data.rcsb.org/rest/v1/core/chemcomp/{code.upper()}"
    with urllib.request.urlopen(url, timeout=20) as r:
        d = json.load(r)
    desc = d.get("rcsb_chem_comp_descriptor", {})
    smi = desc.get("SMILES_stereo") or desc.get("SMILES")
    if not smi:
        raise RuntimeError(f"No SMILES for component {code}")
    return smi


async def run_md(job: Job, req: MdRequest):
    d = job.dir
    env = tools.tool_env(PY)
    env["PYTHONPATH"] = str(BACKEND)
    env["PYTHONUNBUFFERED"] = "1"
    smiles = req.smiles
    if not smiles:
        await job.emit("log", {"text": f"Fetching SMILES of {req.ligand_resname} from RCSB"})
        smiles = await asyncio.to_thread(ccd_smiles, req.ligand_resname or "")
    cfg = req.model_dump(exclude={"receptor_pdb", "ligand_pdb"})
    cfg.update(smiles=smiles, water_ff=f"amber14/{req.water_model}" if req.protein_ff == "amber14-all" else req.water_model)
    (d / "config.json").write_text(json.dumps(cfg))
    (d / "receptor.pdb").write_text(req.receptor_pdb)
    (d / "ligand.pdb").write_text(req.ligand_pdb)

    buf = ""

    async def on_output(text: str):
        nonlocal buf
        buf += text
        *lines, buf = buf.split("\n")
        for line in lines:
            line = line.rstrip()
            if line.startswith("@@ "):
                try:
                    m = json.loads(line[3:])
                except ValueError:
                    continue
                if "stage" in m:
                    await job.emit("stage", {"stage": m["stage"]})
                if "progress" in m:
                    await job.emit("progress", {"value": m["progress"], **({"frames": m["frames"]} if "frames" in m else {})})
                if "log" in m:
                    await job.emit("log", {"text": m["log"]})
            elif line:
                await job.emit("log", {"text": line[:300]})

    code, out = await job.run([PY, "-m", "app.md.simulate", str(d)], env, on_output)
    if code != 0 or not (d / "meta.json").is_file():
        tail = [l for l in out.strip().splitlines() if l.strip()][-1:] or ["no output"]
        raise RuntimeError(f"Simulation failed (exit {code}): {tail[0][:300]}")
    await job.emit("stage", {"stage": "analysis"})
    code, out = await job.run([PY, "-m", "app.md.analysis", str(d)], env, on_output)
    if code != 0 or not (d / "results.json").is_file():
        tail = [l for l in out.strip().splitlines() if l.strip()][-1:] or ["no output"]
        raise RuntimeError(f"Analysis failed (exit {code}): {tail[0][:300]}")
    save_run(job, req)
    await job.emit("done", {"ok": True, "run": "run-" + job.id})
