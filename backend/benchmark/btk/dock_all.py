"""Dock the whole benchmark set with one pose engine; poses are cached per ligand so rescoring and evaluation can reuse them.

    backend/.env/bin/python backend/benchmark/btk/dock_all.py ENGINE [--receptor 5T18] [--scoring vina] [--exhaustiveness 4]
                                                              [--workers 28] [--limit N] [--no-gpu]
Writes .run/btk/poses/<receptor>/<engine>-<scoring>/<id>.pdbqt (resumable: existing files are skipped).
"""

import argparse
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import RUN, ligands, prep_ligand, prep_receptor  # noqa: E402

from app import engines, tools  # noqa: E402


def lig_dir() -> Path:
    return RUN / "ligands"


def dock_one(args):
    row, eng_id, rec, scoring, exh, gnina_gpu, out_dir = args
    out = Path(out_dir) / f"{row['id']}.pdbqt"
    if out.exists():
        return row["id"], "cached", 0.0
    t = time.time()
    info = prep_ligand(row, lig_dir())
    if info is None:
        return row["id"], "ligand prep failed", 0.0
    engine = engines.ENGINES[eng_id]
    binary = engine.binary()
    req = SimpleNamespace(center=rec["center"], size=rec["size"], exhaustiveness=exh, num_modes=9, energy_range=10, seed=42, cpu=1,
                          scoring=scoring, cnn_scoring="rescore", pose_sort="CNNscore", no_gpu=not gnina_gpu)
    work = Path(out_dir) / "_work" / row["id"]
    work.mkdir(parents=True, exist_ok=True)
    (work / "ligand.pdbqt").write_text((lig_dir() / f"{row['id']}.pdbqt").read_text())
    (work / "receptor.pdbqt").write_text((RUN / "receptors" / rec["pdb"] / "receptor.pdbqt").read_text())
    cmd = engines.build_args(engine, binary, req)
    r = subprocess.run(cmd, cwd=work, capture_output=True, text=True, env=tools.tool_env(binary), timeout=1800)
    res = work / ("unidock_out" if eng_id == "unidock" else "out.pdbqt")
    if eng_id == "unidock":
        res = next(iter((work / "unidock_out").glob("*.pdbqt")), None)
    if res is None or not Path(res).is_file():
        return row["id"], (r.stdout + r.stderr)[-200:], time.time() - t
    out.write_text(Path(res).read_text())
    for f in work.iterdir():
        if f.is_file():
            f.unlink()
        else:
            [g.unlink() for g in f.iterdir()]
            f.rmdir()
    work.rmdir()
    return row["id"], "ok", time.time() - t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("engine", choices=list(engines.ENGINES))
    ap.add_argument("--receptor", default="5T18")
    ap.add_argument("--scoring")
    ap.add_argument("--exhaustiveness", type=int, default=4)
    ap.add_argument("--workers", type=int, default=28)
    ap.add_argument("--limit", type=int)
    ap.add_argument("--gpu", action="store_true", help="GNINA: use the GPU (workers share it)")
    a = ap.parse_args()
    eng = engines.ENGINES[a.engine]
    scoring = a.scoring or eng.scoring[0]
    rec = prep_receptor(a.receptor)
    rows = ligands()
    if a.limit:  # keep the active:decoy ratio when subsampling
        acts = [r for r in rows if r["active"]][: max(1, a.limit // 10)]
        rows = acts + [r for r in rows if not r["active"]][: a.limit - len(acts)]
    out_dir = RUN / "poses" / a.receptor / f"{a.engine}-{scoring}"
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"{eng.label} ({scoring}) on {a.receptor}: {len(rows)} ligands, {a.workers} workers -> {out_dir}", flush=True)
    t0, done, bad = time.time(), 0, 0
    with ProcessPoolExecutor(a.workers if a.engine != "gnina" or not a.gpu else min(a.workers, 4)) as ex:
        futs = [ex.submit(dock_one, (r, a.engine, rec, scoring, a.exhaustiveness, a.gpu, str(out_dir))) for r in rows]
        for f in as_completed(futs):
            lid, status, dt = f.result()
            done += 1
            if status not in ("ok", "cached"):
                bad += 1
                print("FAIL", lid, status.replace("\n", " ")[:150], flush=True)
            if done % 50 == 0 or done == len(rows):
                print(f"[{time.time() - t0:5.0f}s] {done}/{len(rows)} (failed {bad})", flush=True)


if __name__ == "__main__":
    main()
