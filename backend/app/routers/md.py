"""Molecular dynamics (OpenMM) of a protein-ligand complex, then trajectory analysis (ProLIF, RMSD, ...). See app/md/."""

import asyncio
import json
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
PY = sys.executable


class MdRequest(BaseModel):
    receptor_pdb: str = Field(min_length=1)
    ligand_pdb: str = Field(min_length=1)  # the pose, PDB format (all atoms, bond orders not needed)
    smiles: str | None = None  # bond-order template; default: the RCSB chemical component of `ligand_resname`
    ligand_resname: str | None = None
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
    await job.emit("done", {"ok": True})
