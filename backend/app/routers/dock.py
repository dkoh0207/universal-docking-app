"""AutoDock Vina docking: receptor/ligand preparation with Open Babel, then Vina."""

import asyncio
import re
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .. import tools
from ..jobs import Job, manager, sse

router = APIRouter(prefix="/dock", tags=["dock"])

Vec3 = Annotated[list[float], Field(min_length=3, max_length=3)]
PH = "7.4"
BAR_STARS = 51  # Vina's progress bar is 51 asterisks wide


class Ligand(BaseModel):
    text: str = Field(min_length=1)
    format: Literal["pdb", "sdf", "mol2", "smiles"]


class DockRequest(BaseModel):
    receptor_pdb: str = Field(min_length=1)
    ligand: Ligand
    center: Vec3
    size: Vec3
    exhaustiveness: int = Field(8, ge=1, le=64)
    num_modes: int = Field(9, ge=1, le=20)
    energy_range: float = Field(3, gt=0, le=20)
    seed: int | None = None
    cpu: int | None = Field(None, ge=1)
    scoring: Literal["vina", "vinardo"] = "vina"


@router.get("/status")
def status():
    return tools.versions()


@router.post("/jobs")
async def create_job(req: DockRequest):
    v = tools.versions()
    missing = [k for k, ok in v.items() if not ok]
    if missing:
        raise HTTPException(503, f"Missing tool(s): {', '.join(missing)}. Run `npm run setup`.")
    if any(not (1 <= s <= 126) for s in req.size):
        raise HTTPException(422, "Box size must be between 1 and 126 Å per axis")
    job = manager.create("dock", lambda j: run_dock(j, req))
    return {"id": job.id}


@router.get("/jobs/{job_id}/events")
async def events(job_id: str, request: Request):
    job = manager.get(job_id)
    if not job:
        raise HTTPException(404, "Unknown job")
    try:
        after = int(request.headers.get("last-event-id", 0))
    except ValueError:
        after = 0

    async def gen():
        agen = job.stream(after)
        nxt = asyncio.ensure_future(anext(agen, None))
        try:
            while True:
                done, _ = await asyncio.wait({nxt}, timeout=15)
                if not done:
                    yield ": keepalive\n\n"
                    continue
                item = nxt.result()
                if item is None:
                    return
                i, event, data = item
                yield sse(event, data, i)
                nxt = asyncio.ensure_future(anext(agen, None))
        finally:
            nxt.cancel()

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.delete("/jobs/{job_id}")
async def cancel_job(job_id: str):
    job = manager.get(job_id)
    if not job:
        raise HTTPException(404, "Unknown job")
    return {"cancelled": await job.cancel()}


# ---------------------------------------------------------------- pipeline
async def run_dock(job: Job, req: DockRequest):
    vina, obabel = tools.vina_bin(), tools.obabel_bin()
    ob_env = tools.tool_env(obabel)
    d = job.dir

    async def log(text: str):
        for line in re.split(r"[\r\n]+", text):
            line = line.rstrip()
            if line and not re.fullmatch(r"[\s*|\-0-9%]+", line):
                await job.emit("log", {"text": line})

    async def prep(args: list[str], out: str, what: str):
        code, output = await job.run([obabel, *args], ob_env)
        await log(output)
        p = d / out
        if code != 0 or not p.is_file() or p.stat().st_size == 0:
            tail = " ".join(output.strip().splitlines()[-2:])
            raise RuntimeError(f"Open Babel could not prepare the {what}: {tail or 'no output'}")

    await job.emit("stage", {"stage": "prep_receptor"})
    (d / "receptor.pdb").write_text(req.receptor_pdb)
    await prep(["receptor.pdb", "-xr", "-p", PH, "-O", "receptor.pdbqt"], "receptor.pdbqt", "receptor")
    await job.emit("progress", {"value": 0})

    await job.emit("stage", {"stage": "prep_ligand"})
    fmt = req.ligand.format
    lig_in = f"ligand.{'smi' if fmt == 'smiles' else fmt}"
    (d / lig_in).write_text(req.ligand.text if req.ligand.text.endswith("\n") else req.ligand.text + "\n")
    await prep([lig_in, *(["--gen3D"] if fmt == "smiles" else []), "-p", PH, "-O", "ligand.pdbqt"], "ligand.pdbqt", "ligand")

    await job.emit("stage", {"stage": "docking"})
    args = [vina, "--receptor", "receptor.pdbqt", "--ligand", "ligand.pdbqt"]
    for axis, c, s in zip("xyz", req.center, req.size):
        args += [f"--center_{axis}", str(c), f"--size_{axis}", str(s)]
    args += ["--exhaustiveness", str(req.exhaustiveness), "--num_modes", str(req.num_modes),
             "--energy_range", str(req.energy_range), "--scoring", req.scoring, "--out", "out.pdbqt"]
    if req.seed is not None:
        args += ["--seed", str(req.seed)]
    if req.cpu:
        args += ["--cpu", str(req.cpu)]

    stars = 0

    async def on_output(text: str):
        nonlocal stars
        n = text.count("*")
        if n:
            stars = min(BAR_STARS, stars + n)
            await job.emit("progress", {"value": round(100 * stars / BAR_STARS)})
        await log(text)

    code, output = await job.run(args, tools.tool_env(vina), on_output)
    out = d / "out.pdbqt"
    if code != 0 or not out.is_file():
        lines = [l.strip() for l in output.splitlines() if l.strip()]
        first = next((i for i, l in enumerate(lines) if re.search(r"error|invalid|cannot|unsupported", l, re.I)), max(len(lines) - 2, 0))
        raise RuntimeError(f"Vina failed (exit {code}): {' '.join(lines[first:first + 2])[:300]}")
    poses = out.read_text()
    modes = []
    for m in re.finditer(r"^REMARK VINA RESULT:\s+(-?[\d.]+)\s+([\d.]+)\s+([\d.]+)", poses, re.M):
        modes.append({"mode": len(modes) + 1, "affinity": float(m[1]), "rmsd_lb": float(m[2]), "rmsd_ub": float(m[3])})
    await job.emit("progress", {"value": 100})
    await job.emit("done", {"poses": poses, "modes": modes})
