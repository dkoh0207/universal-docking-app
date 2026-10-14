"""Add AEV-PLIG pKd to an existing score table without redoing the other rescoring.
    backend/.env/bin/python backend/benchmark/btk/aev_score.py POSEDIR [--workers 8] [--limit N] [--chunk 200]
Merges "aev_plig" per pose into .run/btk/scores/<receptor>/<engine>-<scoring>.json (the old file is kept as .pre-aev.json)."""

import argparse
import json
import shutil
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from app import scoring  # noqa: E402

RUN = Path(__file__).resolve().parents[3] / ".run" / "btk"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("posedir")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--limit", type=int)
    ap.add_argument("--chunk", type=int, default=200, help="ligands per AEV-PLIG run (progress + partial saves)")
    a = ap.parse_args()
    posedir = Path(a.posedir).resolve()
    receptor_id, tag = posedir.parent.name, posedir.name
    path = RUN / "scores" / receptor_id / f"{tag}.json"
    scores = json.loads(path.read_text())
    bak = path.with_suffix(".pre-aev.json")
    if not bak.exists():
        shutil.copy(path, bak)
    ids = [i for i in scores if "aev_plig" not in (scores[i][0] if scores[i] else {})][: a.limit]
    receptor = (RUN / "receptors" / receptor_id / "receptor.pdb").read_text()
    t0 = time.time()
    print(f"{tag}: {len(ids)} ligands to score", flush=True)
    for k in range(0, len(ids), a.chunk):
        part = ids[k : k + a.chunk]
        with tempfile.TemporaryDirectory() as td:
            res = scoring.score_batch(receptor, {i: (posedir / f"{i}.pdbqt").read_text() for i in part}, Path(td), a.workers)
        for lid, vals in res.items():
            for j, v in enumerate(vals[: len(scores[lid])]):
                scores[lid][j]["aev_plig"] = v
            for p in scores[lid]:
                p.setdefault("aev_plig", None)
        path.write_text(json.dumps(scores))
        print(f"[{time.time() - t0:5.0f}s] {min(k + a.chunk, len(ids))}/{len(ids)}", flush=True)
    print("wrote", path)


if __name__ == "__main__":
    main()
