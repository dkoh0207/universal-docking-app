"""Docking (Vina / smina / GNINA): receptor/ligand preparation with Open Babel, then the chosen engine."""

import asyncio
import re
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, model_validator

from .. import engines, tools
from ..jobs import Job, manager, sse

router = APIRouter(prefix="/dock", tags=["dock"])

Vec3 = Annotated[list[float], Field(min_length=3, max_length=3)]
PH = "7.4"
BAR_STARS = 51  # the progress bar of Vina, smina and GNINA is progress bar is 51 asterisks wide


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
    engine: Literal["vina", "smina", "gnina"] = "vina"
    scoring: str | None = None  # default: the engine's first scoring function
    cnn_scoring: Literal[engines.CNN_SCORING] = "rescore"  # GNINA only
    pose_sort: Literal[engines.POSE_SORT] = "CNNscore"  # GNINA only
    no_gpu: bool = False  # GNINA only

    @model_validator(mode="after")
    def _check_scoring(self):
        allowed = engines.ENGINES[self.engine].scoring
        if self.scoring is None:
            self.scoring = allowed[0]
        elif self.scoring not in allowed:
            raise ValueError(f"scoring must be one of {', '.join(allowed)} for {self.engine}")
        return self


@router.get("/status")
def status():
    return tools.versions()


@router.post("/jobs")
async def create_job(req: DockRequest):
    v = tools.versions()
    missing = [k for k, ok in {req.engine: v["engines"][req.engine], "obabel": v["obabel"]}.items() if not ok]
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
    engine = engines.ENGINES[req.engine]
    binary, obabel = engine.binary(), tools.obabel_bin()
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
    args = engines.build_args(engine, binary, req)

    stars = 0

    async def on_output(text: str):
        nonlocal stars
        n = text.count("*")
        if n:
            stars = min(BAR_STARS, stars + n)
            await job.emit("progress", {"value": round(100 * stars / BAR_STARS)})
        await log(text)

    code, output = await job.run(args, tools.tool_env(binary), on_output)
    out = d / "out.pdbqt"
    if code != 0 or not out.is_file():
        lines = [l.strip() for l in output.splitlines() if l.strip()]
        first = next((i for i, l in enumerate(lines) if re.search(r"error|invalid|cannot|unsupported", l, re.I)), max(len(lines) - 2, 0))
        raise RuntimeError(f"{engine.label} failed (exit {code}): {' '.join(lines[first:first + 2])[:300]}")
    poses = out.read_text()
    modes = engines.parse_modes(poses, output)
    await job.emit("progress", {"value": 100})
    await job.emit("done", {"poses": poses, "modes": modes})
