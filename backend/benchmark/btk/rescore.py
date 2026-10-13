"""Rescore cached poses of one pose engine with every available scoring function (poses are scored as they are, no minimisation).

    backend/.env/bin/python backend/benchmark/btk/rescore.py POSEDIR [--workers 28] [--no-gnina]
POSEDIR = .run/btk/poses/<receptor>/<engine>-<scoring>; writes <POSEDIR>/../../scores/<receptor>/<engine>-<scoring>.json
{ligand id: [{"dock": engine score, "vina": ..., "vinardo": ..., "ad4_scoring": ..., "dkoes_fast": ..., "dkoes_scoring": ...,
              "cnn_score": ..., "cnn_affinity": ..., "cnn_var": ...} per pose]}
"""

import argparse
import json
import re
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import RUN, obabel  # noqa: E402

from app import tools  # noqa: E402
from app.interactions import split_models  # noqa: E402

SMINA_FUNCS = ("vina", "vinardo", "ad4_scoring", "dkoes_fast", "dkoes_scoring")


def dock_energies(text: str) -> list[float]:
    e = [float(m[1]) for m in re.finditer(r"^REMARK VINA RESULT:\s+(-?[\d.]+)", text, re.M)]
    return e or [float(m[1]) for m in re.finditer(r"^REMARK minimizedAffinity\s+(-?[\d.]+)", text, re.M)] or [
        float(m[1]) for m in re.finditer(r"^REMARK Uni-Dock RESULT:\s+(-?[\d.]+)", text, re.M)]


def poses_sdf(pdbqt: Path, sdf: Path, name: str) -> int:
    """Open Babel conversion of a multi-model PDBQT; each record is titled `<name>|<pose index>`."""
    r = obabel([str(pdbqt), "-O", str(sdf)])
    txt = sdf.read_text()
    recs = [x for x in txt.split("$$$$\n") if x.strip()]
    sdf.write_text("".join(f"{name}|{i}\n" + "\n".join(rec.split("\n")[1:]) + "$$$$\n" for i, rec in enumerate(recs)))
    return len(recs)


def smina_one(args):
    lid, pdbqt, receptor = args
    out = {}
    with tempfile.TemporaryDirectory() as td:
        sdf = Path(td) / "p.sdf"
        n = poses_sdf(Path(pdbqt), sdf, lid)
        for func in SMINA_FUNCS:
            o = Path(td) / f"{func}.sdf"
            subprocess.run([tools_smina(), "--score_only", "--receptor", receptor, "--ligand", str(sdf), "--scoring", func, "-o", str(o)],
                           capture_output=True, text=True, timeout=300)
            vals = [float(m[1]) for m in re.finditer(r">\s*<minimizedAffinity>\s*\n(-?[\d.]+)", o.read_text())] if o.exists() else []
            out[func] = vals if len(vals) == n else [None] * n
    return lid, out, n


def tools_smina() -> str:
    from app import engines

    return engines.ENGINES["smina"].binary()


def gnina_all(ids: list[str], posedir: Path, receptor: str, work: Path) -> dict:
    """One GNINA process over every pose of every ligand (the CNN ensemble loads once)."""
    from app import engines

    big = work / "all.sdf"
    with big.open("w") as f:
        for lid in ids:
            sdf = work / f"{lid}.sdf"
            poses_sdf(posedir / f"{lid}.pdbqt", sdf, lid)
            f.write(sdf.read_text())
            sdf.unlink()
    out = work / "gnina.sdf"
    b = engines.ENGINES["gnina"].binary()
    subprocess.run([b, "--score_only", "--receptor", receptor, "--ligand", str(big), "--cnn_scoring", "rescore", "-o", str(out)],
                   capture_output=True, text=True, env=tools.tool_env(b), timeout=7200)
    res: dict[str, dict[int, dict]] = {}
    for rec in out.read_text().split("$$$$\n"):
        if not rec.strip():
            continue
        name = rec.split("\n")[0].strip()
        lid, i = name.rsplit("|", 1)

        def g(key):
            m = re.search(rf">\s*<{key}>\s*\n(-?[\d.eE+-]+)", rec)
            return float(m[1]) if m else None

        res.setdefault(lid, {})[int(i)] = {"cnn_score": g("CNNscore"), "cnn_affinity": g("CNNaffinity"), "cnn_var": g("CNNaffinity_variance"), "gnina_vina": g("minimizedAffinity")}
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("posedir")
    ap.add_argument("--workers", type=int, default=28)
    ap.add_argument("--no-gnina", action="store_true")
    ap.add_argument("--no-smina", action="store_true")
    a = ap.parse_args()
    posedir = Path(a.posedir).resolve()
    receptor_id, tag = posedir.parent.name, posedir.name
    receptor = str(RUN / "receptors" / receptor_id / "receptor.pdbqt")
    files = sorted(p for p in posedir.glob("*.pdbqt"))
    ids = [p.stem for p in files]
    print(f"{tag} on {receptor_id}: {len(ids)} ligands", flush=True)
    dock = {i: dock_energies(posedir.joinpath(f"{i}.pdbqt").read_text()) for i in ids}
    scores: dict[str, list[dict]] = {i: [{"dock": e} for e in dock[i]] for i in ids}
    t0 = time.time()
    if not a.no_smina:
        with ProcessPoolExecutor(a.workers) as ex:
            for k, (lid, out, n) in enumerate(ex.map(smina_one, [(i, str(posedir / f"{i}.pdbqt"), receptor) for i in ids], chunksize=4)):
                for j in range(min(n, len(scores[lid]))):
                    for func in SMINA_FUNCS:
                        scores[lid][j][func] = out[func][j]
                if (k + 1) % 100 == 0:
                    print(f"[{time.time() - t0:5.0f}s] smina {k + 1}/{len(ids)}", flush=True)
    if not a.no_gnina and engines_ok("gnina"):
        with tempfile.TemporaryDirectory() as td:
            g = gnina_all(ids, posedir, receptor, Path(td))
        for lid, per in g.items():
            for j, d in per.items():
                if j < len(scores[lid]):
                    scores[lid][j].update(d)
        print(f"[{time.time() - t0:5.0f}s] gnina done ({len(g)} ligands scored)", flush=True)
    out = RUN / "scores" / receptor_id
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{tag}.json").write_text(json.dumps(scores))
    print("wrote", out / f"{tag}.json")


def engines_ok(name: str) -> bool:
    from app import engines

    return engines.ENGINES[name].binary() is not None


if __name__ == "__main__":
    main()
