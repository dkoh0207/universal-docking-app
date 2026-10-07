"""Locate and probe the external command-line tools (AutoDock Vina, Open Babel)."""

import os
import shutil
import subprocess
import sys
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXE = ".exe" if sys.platform == "win32" else ""


def _find(env: str, local: list[Path], name: str) -> str | None:
    """Env var (an explicit override: a wrong path means missing), then project-local paths, then PATH."""
    given = os.environ.get(env)
    if given:
        return given if Path(given).is_file() else None
    for p in local:
        if p.is_file():
            return str(p)
    return shutil.which(name)


def vina_bin() -> str | None:
    return _find("VINA_BIN", [ROOT / "tools" / "vina" / f"vina{EXE}"], "vina")


def obabel_bin() -> str | None:
    env = ROOT / "backend" / ".env"
    return _find("OBABEL_BIN", [env / "Library" / "bin" / f"obabel{EXE}", env / "bin" / "obabel"], "obabel")


def tool_env(binary: str) -> dict[str, str]:
    """Environment for running a tool: its own directory on PATH so bundled DLLs resolve, and Open Babel's data dir
    (force fields, pH model) located relative to a conda-style prefix, since obabel cannot find it unactivated on Windows."""
    env = dict(os.environ)
    here = Path(binary).resolve().parent
    env["PATH"] = str(here) + os.pathsep + env.get("PATH", "")
    if Path(binary).name.startswith("obabel") and "BABEL_DATADIR" not in env:
        for prefix in (here.parent.parent, here.parent):
            for data in (prefix / "share" / "openbabel", prefix / "Library" / "share" / "openbabel"):
                if (data / "UFF.prm").is_file():
                    env["BABEL_DATADIR"] = str(data)
                    env.setdefault("BABEL_LIBDIR", str(here))
                    return env
    return env


@lru_cache(maxsize=8)
def _probe(binary: str, flag: str) -> str | None:
    try:
        r = subprocess.run([binary, flag], capture_output=True, text=True, timeout=20, env=tool_env(binary))
    except (OSError, subprocess.SubprocessError):
        return None
    out = (r.stdout + r.stderr).strip().splitlines()
    return out[0].strip() if out else None


def versions() -> dict[str, str | None]:
    v, o = vina_bin(), obabel_bin()
    return {"vina": _probe(v, "--version") if v else None, "obabel": _probe(o, "-V") if o else None}
