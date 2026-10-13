"""Docking engines (AutoDock Vina, QuickVina 2, QuickVina-W, smina, GNINA, Uni-Dock): binary lookup, scoring options, command line and result parsing."""

import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from . import tools

CNN_SCORING = ("none", "rescore", "refinement", "metrorescore", "metrorefine", "all")
POSE_SORT = ("CNNscore", "CNNaffinity", "Energy")


@dataclass(frozen=True)
class Engine:
    id: str
    label: str
    env_var: str
    scoring: tuple[str, ...]  # first entry is the default
    local: Callable[[], list[Path]]
    platforms: tuple[str, ...] = ("win32", "linux", "darwin")

    def binary(self) -> str | None:
        if sys.platform not in self.platforms:
            return None
        return tools._find(self.env_var, self.local(), self.id)

    def version(self) -> str | None:
        b = self.binary()
        return tools._probe(b, "--version") if b else None


def _local(name: str) -> Callable[[], list[Path]]:
    env = tools.ROOT / "backend" / ".env"
    return lambda: [tools.ROOT / "tools" / name / f"{name}{tools.EXE}", env / "Library" / "bin" / f"{name}{tools.EXE}", env / "bin" / name]


ENGINES: dict[str, Engine] = {
    "vina": Engine("vina", "AutoDock Vina", "VINA_BIN", ("vina", "vinardo"), _local("vina")),
    # QuickVina 2 / QuickVina-W: Vina 1.1.2 command line (no --scoring, Vina scoring only), faster local search
    "qvina2": Engine("qvina2", "QuickVina 2", "QVINA2_BIN", ("vina",), _local("qvina2")),
    "qvinaw": Engine("qvinaw", "QuickVina-W", "QVINAW_BIN", ("vina",), _local("qvinaw")),
    "unidock": Engine("unidock", "Uni-Dock (GPU)", "UNIDOCK_BIN", ("vina", "vinardo", "ad4"), _local("unidock"), platforms=("linux",)),
    "smina": Engine("smina", "smina", "SMINA_BIN",
                    ("vinardo", "vina", "ad4_scoring", "dkoes_fast", "dkoes_scoring", "dkoes_scoring_old"), _local("smina")),
    "gnina": Engine("gnina", "GNINA", "GNINA_BIN", ("default", "vinardo", "vina", "ad4_scoring", "dkoes_fast", "dkoes_scoring"),
                    _local("gnina"), platforms=("linux",)),
}


def versions() -> dict[str, str | None]:
    return {k: e.version() for k, e in ENGINES.items()}


def build_args(engine: Engine, binary: str, req: Any) -> list[str]:
    """Command line for the prepared receptor.pdbqt / ligand.pdbqt in the job directory; output goes to out.pdbqt."""
    if engine.id == "unidock":  # batch GPU docking: ligands are listed with --ligand_index, poses land in --dir as <name>_out.pdbqt
        args = [binary, "--receptor", "receptor.pdbqt", "--gpu_batch", "ligand.pdbqt", "--dir", "unidock_out",
                "--scoring", req.scoring, "--num_modes", str(req.num_modes), "--energy_range", str(req.energy_range),
                "--search_mode", "balance" if req.exhaustiveness <= 16 else "detail"]
        for axis, c, s in zip("xyz", req.center, req.size):
            args += [f"--center_{axis}", str(c), f"--size_{axis}", str(s)]
        return args + (["--seed", str(req.seed)] if req.seed is not None else [])
    args = [binary, "--receptor", "receptor.pdbqt", "--ligand", "ligand.pdbqt"]
    for axis, c, s in zip("xyz", req.center, req.size):
        args += [f"--center_{axis}", str(c), f"--size_{axis}", str(s)]
    args += ["--exhaustiveness", str(req.exhaustiveness), "--num_modes", str(req.num_modes), "--out", "out.pdbqt"]
    if engine.id != "gnina":  # GNINA has no --energy_range
        args += ["--energy_range", str(req.energy_range)]
    if engine.id not in ("qvina2", "qvinaw") and not (engine.id == "gnina" and req.scoring == "default"):
        args += ["--scoring", req.scoring]
    if req.seed is not None:
        args += ["--seed", str(req.seed)]
    if req.cpu:
        args += ["--cpu", str(req.cpu)]
    if engine.id == "gnina":
        args += ["--cnn_scoring", req.cnn_scoring, "--pose_sort_order", req.pose_sort]
        if req.no_gpu:
            args += ["--no_gpu"]
    return args


def parse_modes(poses: str, log: str) -> list[dict]:
    """Per-mode affinity (and CNN scores) from the pose remarks; RMSD bounds from Vina's REMARK or the log table."""
    modes: list[dict] = []
    for m in re.finditer(r"^REMARK VINA RESULT:\s+(-?[\d.]+)\s+([\d.]+)\s+([\d.]+)", poses, re.M):
        modes.append({"mode": len(modes) + 1, "affinity": float(m[1]), "rmsd_lb": float(m[2]), "rmsd_ub": float(m[3])})
    if modes:
        return modes
    # smina / GNINA: one MODEL block per pose with `REMARK minimizedAffinity` (and CNNscore / CNNaffinity for GNINA)
    rows = {int(m[1]): (float(m[2]), float(m[3])) for m in re.finditer(r"^\s*(\d+)\s+-?[\d.]+\s+([\d.]+)\s+([\d.]+)", log, re.M)}
    for block in re.split(r"^MODEL\s+\d+", poses, flags=re.M)[1:]:
        def grab(key: str) -> float | None:
            f = re.search(rf"^REMARK\s+{key}\s+(-?[\d.]+)", block, re.M)
            return float(f[1]) if f else None
        aff = grab("minimizedAffinity")
        if aff is None:
            continue
        i = len(modes) + 1
        lb, ub = rows.get(i, (0.0, 0.0))
        mode = {"mode": i, "affinity": aff, "rmsd_lb": lb, "rmsd_ub": ub}
        for key, name in (("CNNscore", "cnn_score"), ("CNNaffinity", "cnn_affinity")):
            v = grab(key)
            if v is not None:
                mode[name] = v
        modes.append(mode)
    return modes
