"""Generic in-memory job manager: each job runs a coroutine, streams events, owns a work dir and its subprocesses."""

import asyncio
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path

JOBS_DIR = Path(tempfile.gettempdir()) / "pymol-web" / "jobs"
KEEP_SECONDS = 3600
TERMINAL = {"done", "error"}


class Job:
    def __init__(self, tool: str):
        self.id = uuid.uuid4().hex[:12]
        self.tool = tool
        self.status = "queued"  # queued | running | done | error | cancelled
        self.events: list[tuple[str, dict]] = []
        self.dir = JOBS_DIR / self.id
        self.dir.mkdir(parents=True, exist_ok=True)
        self.finished = 0.0
        self.task: asyncio.Task | None = None
        self._procs: set[subprocess.Popen] = set()
        self._cond = asyncio.Condition()

    async def emit(self, event: str, data: dict | None = None):
        async with self._cond:
            self.events.append((event, data or {}))
            self._cond.notify_all()

    async def stream(self, after: int = 0):
        """Yield (index, event, data) from `after` on, until a terminal event."""
        i = after
        while True:
            async with self._cond:
                await self._cond.wait_for(lambda: len(self.events) > i)
            event, data = self.events[i]
            i += 1
            yield i, event, data
            if event in TERMINAL:
                return

    async def run(self, args: list[str], env: dict[str, str] | None = None, on_output: Callable[[str], Awaitable[None]] | None = None, cwd: Path | None = None) -> tuple[int, str]:
        """Run a subprocess, feeding decoded output chunks to `on_output`; returns (exit code, full output).

        Uses Popen plus a reader thread rather than asyncio subprocesses: those need a Proactor loop on Windows,
        which uvicorn --reload does not provide.
        """
        loop = asyncio.get_running_loop()
        proc = subprocess.Popen(
            args, cwd=cwd or self.dir, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0)
        self._procs.add(proc)
        chunks: asyncio.Queue[bytes | None] = asyncio.Queue()

        def reader():
            fd = proc.stdout.fileno()
            try:
                while data := os.read(fd, 512):
                    loop.call_soon_threadsafe(chunks.put_nowait, data)
            except OSError:
                pass
            finally:
                loop.call_soon_threadsafe(chunks.put_nowait, None)

        threading.Thread(target=reader, daemon=True).start()
        out: list[str] = []
        try:
            while (data := await chunks.get()) is not None:
                text = data.decode("utf-8", "replace")
                out.append(text)
                if on_output:
                    await on_output(text)
            return await asyncio.to_thread(proc.wait), "".join(out)
        finally:
            kill_tree(proc)
            self._procs.discard(proc)
            proc.stdout.close()

    async def cancel(self):
        if self.status in TERMINAL or self.status == "cancelled":
            return False
        self.status = "cancelled"
        for p in list(self._procs):
            kill_tree(p)
        if self.task:
            self.task.cancel()
        self.finished = time.time()
        await self.emit("error", {"message": "Cancelled", "cancelled": True})
        return True


def kill_tree(proc: subprocess.Popen):
    if proc.poll() is not None:
        return
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
    else:
        proc.kill()


class JobManager:
    def __init__(self):
        self.jobs: dict[str, Job] = {}

    def get(self, job_id: str) -> Job | None:
        return self.jobs.get(job_id)

    def create(self, tool: str, work: Callable[[Job], Awaitable[None]]) -> Job:
        self.cleanup()
        job = Job(tool)
        self.jobs[job.id] = job

        async def wrapper():
            job.status = "running"
            try:
                await work(job)
                if job.status == "running":
                    job.status = "done"
            except asyncio.CancelledError:
                pass
            except Exception as e:  # reported to the client, not raised
                if job.status == "running":
                    job.status = "error"
                    await job.emit("error", {"message": str(e) or e.__class__.__name__})
            finally:
                job.finished = job.finished or time.time()

        job.task = asyncio.create_task(wrapper())
        return job

    def cleanup(self):
        now = time.time()
        for jid, job in list(self.jobs.items()):
            if job.finished and now - job.finished > KEEP_SECONDS:
                shutil.rmtree(job.dir, ignore_errors=True)
                del self.jobs[jid]


manager = JobManager()


def sse(event: str, data: dict, event_id: int | None = None) -> str:
    return (f"id: {event_id}\n" if event_id is not None else "") + f"event: {event}\ndata: {json.dumps(data)}\n\n"
