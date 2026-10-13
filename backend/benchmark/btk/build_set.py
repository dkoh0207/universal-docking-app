"""Build the BTK benchmark: ChEMBL actives (CHEMBL5251, pChEMBL >= 7) + property-matched decoys from the DEKOIS 2.0 decoy pool.

DEKOIS 2.0 has no BTK set (81 other targets), so the decoys are picked DUD-E style: per active, the N pool molecules closest in
MW / logP / HBD / HBA / rotatable bonds / formal charge, rejecting any decoy with ECFP4 Tanimoto > 0.35 to any active.

    backend/.env/bin/python backend/benchmark/btk/build_set.py [--actives 60] [--ratio 30]    # -> .run/btk/set.csv
    (needs .run/btk/raw/decoys_part_*.zip from https://uni-tuebingen.de/.../dekois/)
"""

import argparse
import csv
import gzip
import io
import json
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
from rdkit import Chem, DataStructs, RDLogger
from rdkit.Chem import AllChem, Descriptors, Lipinski, rdMolDescriptors
from rdkit.ML.Cluster import Butina

RDLogger.DisableLog("rdApp.*")
OUT = Path(__file__).resolve().parents[3] / ".run" / "btk"
TARGET = "CHEMBL5251"


def chembl_actives(min_p: float = 7.0) -> dict[str, tuple[str, float]]:
    url = "https://www.ebi.ac.uk/chembl/api/data/activity.json?" + urllib.parse.urlencode(
        {"target_chembl_id": TARGET, "pchembl_value__gte": min_p, "standard_relation": "=", "limit": 1000, "assay_type": "B"})
    out: dict[str, tuple[str, float]] = {}
    while url:
        d = json.load(urllib.request.urlopen(url, timeout=120))
        for a in d["activities"]:
            if a["canonical_smiles"]:
                cid = a["molecule_chembl_id"]
                p = float(a["pchembl_value"])
                if cid not in out or p > out[cid][1]:
                    out[cid] = (a["canonical_smiles"], p)
        nxt = d["page_meta"]["next"]
        url = "https://www.ebi.ac.uk" + nxt if nxt else None
    return out


def clean(smi: str):
    m = Chem.MolFromSmiles(smi)
    if m is None:
        return None
    frags = Chem.GetMolFrags(m, asMols=True)
    return max(frags, key=lambda x: x.GetNumHeavyAtoms())  # drop counter-ions


def props(m) -> np.ndarray:
    return np.array([Descriptors.MolWt(m), Descriptors.MolLogP(m), Lipinski.NumHDonors(m), Lipinski.NumHAcceptors(m),
                     rdMolDescriptors.CalcNumRotatableBonds(m), Chem.GetFormalCharge(m)], float)


def fp(m):
    return AllChem.GetMorganFingerprintAsBitVect(m, 2, 2048)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--actives", type=int, default=60)
    ap.add_argument("--ratio", type=int, default=30)
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)

    raw = chembl_actives()
    acts = []
    for cid, (smi, p) in raw.items():
        m = clean(smi)
        if m is not None and 250 <= Descriptors.MolWt(m) <= 650 and 18 <= m.GetNumHeavyAtoms() <= 48:
            acts.append((cid, Chem.MolToSmiles(m), p, m))
    print(len(raw), "ChEMBL actives,", len(acts), "after size filter")
    # diverse subset: Butina clusters (ECFP4 Tc 0.6)
    fps = [fp(a[3]) for a in acts]
    dist = [1 - x for i in range(1, len(fps)) for x in DataStructs.BulkTanimotoSimilarity(fps[i], fps[:i])]
    clusters = Butina.ClusterData(dist, len(fps), 0.4, isDistData=True)
    reps = [max(c, key=lambda i: acts[i][2]) for c in clusters]  # one potent member per scaffold cluster
    np.random.default_rng(0).shuffle(reps)  # random clusters: keeping only the most potent would bias the actives to pChEMBL > 9.7
    reps = reps[: args.actives]
    acts = [acts[i] for i in reps]
    afp = [fp(a[3]) for a in acts]
    print(len(clusters), "clusters ->", len(acts), "actives, pChEMBL", min(a[2] for a in acts), "-", max(a[2] for a in acts))

    pool, seen = [], set()
    for z in sorted(OUT.glob("raw/decoys_part_*.zip")):
        with zipfile.ZipFile(z) as zf:
            for n in zf.namelist():
                if not n.endswith(".sdf.gz"):
                    continue
                for m in Chem.ForwardSDMolSupplier(io.BytesIO(gzip.decompress(zf.read(n))), removeHs=True):
                    if m is None:
                        continue
                    m = clean(Chem.MolToSmiles(m))
                    smi = Chem.MolToSmiles(m) if m else None
                    if m and smi not in seen and 18 <= m.GetNumHeavyAtoms() <= 48:
                        seen.add(smi)
                        pool.append((smi, m))
    print(len(pool), "pool decoys")
    P = np.array([props(m) for _, m in pool])
    pfp = [fp(m) for _, m in pool]
    far = np.array([max(DataStructs.BulkTanimotoSimilarity(f, afp)) <= 0.35 for f in pfp])
    sd = P.std(0) + 1e-9
    chosen: set[int] = set()
    rows = [(f"BTK_act_{i:03d}", a[1], 1, a[2], a[0]) for i, a in enumerate(acts)]
    for a in acts:
        d = np.abs((P - props(a[3])) / sd).sum(1)
        d[~far] = np.inf
        d[list(chosen)] = np.inf
        for j in np.argsort(d)[: args.ratio]:
            chosen.add(int(j))
    rows += [(f"BTK_dec_{k:04d}", pool[j][0], 0, "", "") for k, j in enumerate(sorted(chosen))]
    with (OUT / "set.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["id", "smiles", "active", "pchembl", "chembl"])
        w.writerows(rows)
    print(f"wrote {len(rows)} ligands ({len(acts)} actives, {len(chosen)} decoys)")


if __name__ == "__main__":
    main()
