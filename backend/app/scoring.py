"""ML rescoring functions. Today: AEV-PLIG (github.com/oxpig/AEV-PLIG), an attention GNN that predicts pKd for a
protein-ligand pose. It runs in its own Python environment (old pinned deps) as a subprocess of the cloned repo."""

import csv
import os
import re
import shutil
import subprocess
import uuid
from dataclasses import dataclass
from pathlib import Path

from . import tools

ROOT = tools.ROOT
MODEL = "model_GATv2Net_ligsim90_fep_benchmark"  # 10-model ensemble shipped with the repo


@dataclass(frozen=True)
class Scorer:
    id: str
    label: str
    unit: str  # of the returned value
    higher_is_better: bool


SCORERS: dict[str, Scorer] = {"aev_plig": Scorer("aev_plig", "AEV-PLIG", "pKd", True)}


def aevplig_dir() -> Path | None:
    for p in (os.environ.get("AEVPLIG_DIR"), ROOT / "tools" / "aev-plig"):
        if p and (Path(p) / "process_and_predict.py").is_file() and (Path(p) / "output" / "trained_models").is_dir():
            return Path(p)
    return None


def aevplig_python() -> str | None:
    given = os.environ.get("AEVPLIG_PY")
    if given:
        return given if Path(given).is_file() else None
    for p in (ROOT / "tools" / "aev-plig" / ".env" / "bin" / "python", Path.home() / "envs" / "aev-plig" / "bin" / "python"):
        if p.is_file():
            return str(p)
    return None


def available() -> dict[str, bool]:
    return {"aev_plig": bool(aevplig_dir() and aevplig_python() and tools.obabel_bin())}


def split_models(pdbqt: str) -> list[str]:
    """The MODEL blocks of a multi-pose PDBQT, each as a stand-alone single-model PDBQT."""
    blocks = re.findall(r"^MODEL.*?^ENDMDL", pdbqt, re.S | re.M)
    return [b + "\n" for b in blocks] or [pdbqt]


def protein_only_pdb(text: str) -> str:
    """ATOM records only (AEV-PLIG ignores waters/ligands/hydrogens anyway, and the PDB reader dislikes oddities)."""
    return "".join(l + "\n" for l in text.splitlines() if l.startswith(("ATOM", "TER")))


def prepare(work: Path, receptor_pdb: str, poses_pdbqt: str, prefix: str = "pose", write_receptor: bool = True) -> list[Path]:
    """Write receptor.pdb and one hydrogenated <prefix>_<i>.sdf per pose into `work`; returns the SDF paths."""
    obabel = tools.obabel_bin()
    if not obabel:
        raise RuntimeError("Open Babel not found")
    work.mkdir(parents=True, exist_ok=True)
    if write_receptor:
        (work / "receptor.pdb").write_text(protein_only_pdb(receptor_pdb))
    sdfs = []
    for i, block in enumerate(split_models(poses_pdbqt), 1):
        src = work / f"{prefix}_{i}.pdbqt"
        src.write_text(block)
        out = work / f"{prefix}_{i}.sdf"
        # -h adds hydrogens: AEV-PLIG's ligand features count H neighbours (PDBQT only keeps polar hydrogens)
        subprocess.run([obabel, str(src), "-O", str(out), "-h"], capture_output=True, env=tools.tool_env(obabel), timeout=120)
        if out.is_file() and out.stat().st_size and repair_sdf(out):
            sdfs.append(out)
    return sdfs


def repair_sdf(path: Path) -> bool:
    """Make the Open Babel SDF sanitizable by RDKit (AEV-PLIG drops anything it cannot read). PDBQT carries no formal
    charges, so a ligand protonated at pH 7.4 comes back with e.g. a 4-valent neutral N: give such atoms their charge."""
    from rdkit import Chem

    mol = Chem.MolFromMolFile(str(path), sanitize=False, removeHs=False)
    if mol is None:
        return False
    for a in mol.GetAtoms():
        if a.GetFormalCharge() == 0 and a.GetSymbol() in ("N", "P") and a.GetTotalValence() == 4:
            a.SetFormalCharge(1)
        elif a.GetFormalCharge() == 0 and a.GetSymbol() == "O" and a.GetTotalValence() == 3:
            a.SetFormalCharge(1)
    try:
        Chem.SanitizeMol(mol)
    except Exception:
        return False
    Chem.MolToMolFile(mol, str(path))
    return True


class AevPligRun:
    """One AEV-PLIG invocation. `command()` is what to execute (cwd = `cwd`), `collect()` reads the predictions."""

    def __init__(self, receptor: Path, sdfs: list[Path], workers: int = 4):
        d = aevplig_dir()
        if not d or not aevplig_python():
            raise RuntimeError("AEV-PLIG is not installed (expected tools/aev-plig and its Python env)")
        self.cwd = d
        self.name = "job" + uuid.uuid4().hex[:10]
        (d / "data" / "jobs").mkdir(exist_ok=True)
        self.csv = f"data/jobs/{self.name}.csv"  # relative and dot-free: the script derives file names with split(".")
        with open(d / self.csv, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["unique_id", "pK", "sdf_file", "pdb_file"])
            for i, s in enumerate(sdfs, 1):
                w.writerow([s.stem, 0, str(s), str(receptor)])
        self.workers = workers

    def command(self) -> list[str]:
        return [aevplig_python(), "process_and_predict.py", "--trained_model_name", MODEL, "--dataset_csv", self.csv,
                "--data_name", self.name, "--num_workers", str(self.workers), "--device", "cpu"]

    def collect(self) -> dict[str, float]:
        p = self.cwd / "output" / "predictions" / f"{self.name}_predictions.csv"
        if not p.is_file():
            return {}
        with open(p) as f:
            return {r["unique_id"]: round(float(r["preds"]), 3) for r in csv.DictReader(f)}

    def cleanup(self):
        for p in [*(self.cwd / "data" / "jobs").glob(f"{self.name}*"), self.cwd / "data" / f"{self.name}_graphs.pickle",
                  self.cwd / "data" / "processed" / f"{self.name}.pt", self.cwd / "output" / "predictions" / f"{self.name}_predictions.csv"]:
            if p.is_file():
                p.unlink()


def score_poses(receptor_pdb: str, poses_pdbqt: str, work: Path, workers: int = 4) -> list[float | None]:
    """Blocking helper (benchmarks): pKd per pose of a multi-pose PDBQT, None where AEV-PLIG could not score the pose."""
    sdfs = prepare(work, receptor_pdb, poses_pdbqt)
    n = len(split_models(poses_pdbqt))
    run = AevPligRun(work / "receptor.pdb", sdfs, workers)
    try:
        r = subprocess.run(run.command(), cwd=run.cwd, capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError("AEV-PLIG failed: " + " ".join(r.stdout.strip().splitlines()[-2:] + r.stderr.strip().splitlines()[-2:]))
        scores = run.collect()
    finally:
        run.cleanup()
    return [scores.get(f"pose_{i}") for i in range(1, n + 1)]


def score_batch(receptor_pdb: str, poses: dict[str, str], work: Path, workers: int = 8) -> dict[str, list[float | None]]:
    """Blocking helper (benchmarks): one AEV-PLIG run over many ligands. `poses` maps ligand id -> multi-pose PDBQT."""
    from concurrent.futures import ThreadPoolExecutor

    work.mkdir(parents=True, exist_ok=True)
    (work / "receptor.pdb").write_text(protein_only_pdb(receptor_pdb))
    with ThreadPoolExecutor(workers) as ex:
        prepared = list(ex.map(lambda kv: prepare(work, receptor_pdb, kv[1], prefix=kv[0], write_receptor=False), poses.items()))
    run = AevPligRun(work / "receptor.pdb", [s for sdfs in prepared for s in sdfs], workers)
    try:
        r = subprocess.run(run.command(), cwd=run.cwd, capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError("AEV-PLIG failed: " + " ".join(r.stdout.strip().splitlines()[-2:] + r.stderr.strip().splitlines()[-2:]))
        scores = run.collect()
    finally:
        run.cleanup()
    return {lid: [scores.get(f"{lid}_{i}") for i in range(1, len(split_models(t)) + 1)] for lid, t in poses.items()}


def cleanup_dir(work: Path):
    shutil.rmtree(work, ignore_errors=True)
