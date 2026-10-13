"""Evaluate every (pose engine, scoring function, pose rule) combination on the BTK set: AUC, EF1%, EF5%, BEDROC with and without the
required-interaction filter.

    backend/.env/bin/python backend/benchmark/btk/evaluate.py [--receptor 5T18] [--workers 28] [--boot 500]
Needs .run/btk/poses/<receptor>/<tag>/ and .run/btk/scores/<receptor>/<tag>.json (rescore.py). Writes .run/btk/results-<receptor>.json and RESULTS.md.
"""

import argparse
import json
import re
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
from common import RULES, RUN, ligands, prep_ligand, prep_receptor  # noqa: E402
from metrics import bootstrap, summarize  # noqa: E402

from app import interactions  # noqa: E402

# (name, key in the score table, sign: +1 higher is better, -1 lower is better)
SCORERS = [("dock", "dock", -1), ("vina", "vina", -1), ("vinardo", "vinardo", -1), ("ad4", "ad4_scoring", -1), ("dkoes_fast", "dkoes_fast", -1),
           ("dkoes", "dkoes_scoring", -1), ("cnn_score", "cnn_score", 1), ("cnn_affinity", "cnn_affinity", 1), ("cnn_vs", "cnn_vs", 1),
           ("interactions", "ints", 1)]
FAIL_TIER = 1e3
_state: dict = {}


def _init(receptor: str):
    _state["prot"] = interactions.protein_molecule(RUN / "receptors" / receptor / "receptor.pdb")
    _state["rules"] = interactions.load_rules(RULES)
    _state["offset"] = prep_receptor(receptor)["numbering_offset"]


def _poses_of(args):
    lid, path, template = args
    rules, prot = _state["rules"], _state["prot"]
    out = []
    for model in interactions.split_models(Path(path).read_text()):
        try:
            found = interactions.pose_interactions(prot, model, template)
        except Exception:  # noqa: BLE001
            found = None
        off = _state["offset"]  # structure numbering -> UniProt numbering
        found = {(re.sub(r"\d+", lambda m: str(int(m[0]) + off), r), t) for r, t in found} if found is not None else None
        ok, missing = interactions.check(found, rules)
        out.append({"ok": ok, "missing": missing, "ints": interactions.score(found, rules),
                    "found": sorted(f"{r}:{t}" for r, t in (found or []))})
    return lid, out


def pose_interactions_for(receptor: str, tag: str, rows, workers: int) -> dict:
    cache = RUN / "interactions" / receptor / f"{tag}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    posedir = RUN / "poses" / receptor / tag
    todo = []
    for r in rows:
        p = posedir / f"{r['id']}.pdbqt"
        if p.exists():
            info = prep_ligand(r, RUN / "ligands") if not (RUN / "ligands" / f"{r['id']}.smi").exists() else None
            template = (info or {}).get("template") or template_of(r)
            todo.append((r["id"], str(p), [template, r["smiles"]]))
    t0 = time.time()
    res = {}
    with ProcessPoolExecutor(workers, initializer=_init, initargs=(receptor,)) as ex:
        for k, (lid, out) in enumerate(ex.map(_poses_of, todo, chunksize=2)):
            res[lid] = out
            if (k + 1) % 200 == 0:
                print(f"[{time.time() - t0:5.0f}s] interactions {tag} {k + 1}/{len(todo)}", flush=True)
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(res))
    return res


def template_of(row: dict) -> str:
    from common import obabel

    smi = RUN / "ligands" / f"{row['id']}.smi"
    t = obabel([str(smi), "-p", "7.4", "-osmi", "-xn"])
    return t.stdout.split()[0] if t.stdout.strip() else row["smiles"]


def table(scores: dict, ints: dict, ids: list[str]) -> dict[str, list[dict]]:
    """Per ligand, per pose: all score values (higher = better) plus the interaction verdict."""
    out = {}
    for lid in ids:
        poses = scores.get(lid) or []
        rows = []
        for i, p in enumerate(poses):
            d = {"dock": -p["dock"] if p.get("dock") is not None else None}
            for key, sign in (("vina", -1), ("vinardo", -1), ("ad4_scoring", -1), ("dkoes_fast", -1), ("dkoes_scoring", -1)):
                d[key] = sign * p[key] if p.get(key) is not None else None
            d["cnn_score"], d["cnn_affinity"] = p.get("cnn_score"), p.get("cnn_affinity")
            d["cnn_vs"] = p["cnn_score"] * p["cnn_affinity"] if p.get("cnn_score") is not None and p.get("cnn_affinity") is not None else None
            v = (ints.get(lid) or [])
            v = v[i] if i < len(v) else {"ok": False, "ints": 0.0}
            d["ints"], d["ok"] = v["ints"], v["ok"]
            rows.append(d)
        out[lid] = rows
    return out


def ligand_score(rows: list[dict], key: str, agg: str) -> float | None:
    """Ligand-level score (higher = better) for a pose rule. `+filter` rules push ligands without a passing pose below all that have one."""
    if not rows or any(r.get(key) is None for r in rows):
        return None
    filt = agg.endswith("+filter")
    pool = rows[:1] if agg.startswith("top1") else rows
    elig = [r for r in pool if r["ok"]] if filt else pool
    if elig:
        return max(r[key] for r in elig)
    best_any = max(r[key] for r in rows)  # no passing pose: ranked after every ligand that has one
    return best_any - FAIL_TIER


def evaluate_tag(tab: dict, rows: list[dict], boot: int) -> list[dict]:
    ids = [r["id"] for r in rows]
    y = np.array([r["active"] for r in rows], bool)
    out = []
    for name, key, _ in SCORERS:
        for agg in ("top1", "best", "top1+filter", "best+filter"):
            s = [ligand_score(tab.get(i, []), key, agg) for i in ids]
            if any(v is None for v in s):
                continue
            s = np.array(s, float)
            m = summarize(s, y)
            m["ci"] = bootstrap(s, y, boot) if boot else {}
            m["pass_rate_actives"] = float(np.mean([any(p["ok"] for p in tab[i]) for i, a in zip(ids, y) if a]))
            m["pass_rate_decoys"] = float(np.mean([any(p["ok"] for p in tab[i]) for i, a in zip(ids, y) if not a]))
            out.append({"scorer": name, "pose_rule": agg, **m})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--receptor", default="5T18")
    ap.add_argument("--workers", type=int, default=28)
    ap.add_argument("--boot", type=int, default=300)
    ap.add_argument("--tags", nargs="*", help="pose engines to include (default: all with scores)")
    a = ap.parse_args()
    rows_all = ligands()
    results = []
    for f in sorted((RUN / "scores" / a.receptor).glob("*.json")):
        tag = f.stem
        if a.tags and tag not in a.tags:
            continue
        scores = json.loads(f.read_text())
        rows = [r for r in rows_all if r["id"] in scores]
        n_a = sum(r["active"] for r in rows)
        if not n_a or n_a == len(rows):
            print("skip", tag, "(needs both actives and decoys)")
            continue
        ints = pose_interactions_for(a.receptor, tag, rows, a.workers)
        tab = table(scores, ints, [r["id"] for r in rows])
        for e in evaluate_tag(tab, rows, a.boot):
            results.append({"engine": tag, "n": len(rows), "n_actives": n_a, **e})
        print(f"{tag}: {len(rows)} ligands ({n_a} actives) evaluated", flush=True)
    results.sort(key=lambda r: (-r["ef1"], -r["ef5"], -r["auc"]))
    (RUN / f"results-{a.receptor}.json").write_text(json.dumps(results))
    print(f"{'engine':16} {'scorer':13} {'pose rule':12} {'AUC':>5} {'EF1':>6} {'EF5':>6} {'BEDROC':>6}  pass(act/dec)")
    for r in results[:25]:
        print(f"{r['engine']:16} {r['scorer']:13} {r['pose_rule']:12} {r['auc']:5.2f} {r['ef1']:6.1f} {r['ef5']:6.1f} {r['bedroc']:6.2f}  {r['pass_rate_actives']:.2f}/{r['pass_rate_decoys']:.2f}")


if __name__ == "__main__":
    main()
