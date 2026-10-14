import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from . import tools
from .routers import dock, md, rescore

app = FastAPI(title="PyMOL Web backend")
app.include_router(dock.router, prefix="/api")
app.include_router(md.router, prefix="/api")
app.include_router(rescore.router, prefix="/api")


@app.get("/api/health")
def health():
    return {"ok": True, **tools.versions()}


# Production: PYMOL_WEB_STATIC=<built frontend dir> serves the app from this same process (mounted last so /api wins).
_static = os.environ.get("PYMOL_WEB_STATIC")
if _static:
    _dir = Path(_static).resolve()
    if (_dir / "index.html").is_file():
        app.mount("/", StaticFiles(directory=_dir, html=True), name="frontend")
    else:
        print(f"[pymol-web] PYMOL_WEB_STATIC={_dir} has no index.html - run `npm run build` first; serving the API only.")
