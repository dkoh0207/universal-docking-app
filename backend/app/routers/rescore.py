"""Rescoring of docked poses with a machine-learning scoring function (AEV-PLIG)."""

import asyncio
import re
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from .. import scoring
from ..jobs import Job, manager
from .dock import events_stream

router = APIRouter(prefix="/rescore", tags=["rescore"])


class RescoreRequest(BaseModel):
    receptor_pdb: str = Field(min_length=1)
    poses: str = Field(min_length=1)  # multi-pose PDBQT, as returned by a dock job
    scorer: Literal["aev_plig"] = "aev_plig"


@router.get("/status")
def status():
    return {"scorers": [{**vars(s), "available": scoring.available()[s.id]} for s in scoring.SCORERS.values()]}


@router.post("/jobs")
async def create_job(req: RescoreRequest):
    if not scoring.available()[req.scorer]:
        raise HTTPException(503, f"{scoring.SCORERS[req.scorer].label} is not installed (tools/aev-plig and its Python env).")
    job = manager.create("rescore", lambda j: run_rescore(j, req))
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


async def run_rescore(job: Job, req: RescoreRequest):
    await job.emit("stage", {"stage": "prep_poses"})
    n = len(scoring.split_models(req.poses))
    sdfs = await asyncio.to_thread(scoring.prepare, job.dir, req.receptor_pdb, req.poses)
    if not sdfs:
        raise RuntimeError("Open Babel could not convert any pose")
    await job.emit("progress", {"value": 20})

    await job.emit("stage", {"stage": "scoring"})
    run = scoring.AevPligRun(job.dir / "receptor.pdb", sdfs, workers=min(8, len(sdfs)))
    try:
        async def on_output(text: str):
            for line in re.split(r"[\r\n]+", text):
                if line.strip() and not re.search(r"\d+%\||it/s|s/it", line):
                    await job.emit("log", {"text": line.strip()})

        code, output = await job.run(run.command(), None, on_output, run.cwd)
        scores = run.collect()
    finally:
        run.cleanup()
    if code != 0 or not scores:
        tail = " ".join(l.strip() for l in output.strip().splitlines()[-2:])
        raise RuntimeError(f"AEV-PLIG failed (exit {code}): {tail[:300]}")
    await job.emit("progress", {"value": 100})
    await job.emit("done", {"scorer": req.scorer, "scores": [scores.get(f"pose_{i}") for i in range(1, n + 1)]})
