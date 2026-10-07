"""Redocking acceptance test: dock the native ligand of 1HSG (indinavir, MK1) back into its own pocket via the API.

Receptor = protein ATOM records (no water/HETATM); ligand = the MK1 HETATM records; box = MK1 bounding-box center,
size = extent + 8 A; exhaustiveness 8, seed 42. Heavy-atom RMSD of each pose vs the crystal ligand is computed by
atom name (no superposition: poses are already in the crystal frame). Pass: one of the top 3 poses < 2.0 A with a
negative affinity.

    backend/.env/python backend/tests/redock_1hsg.py [--base http://127.0.0.1:8787]
"""

import argparse
import json
import math
import sys
import urllib.request
from pathlib import Path

PDB = Path(__file__).resolve().parents[2] / "frontend" / "public" / "structures" / "1HSG.pdb"
PAD = 8.0


def read_atoms(lines):
    """name -> (x, y, z) for heavy atoms of PDB/PDBQT ATOM/HETATM lines."""
    atoms = {}
    for l in lines:
        if l[:6] in ("ATOM  ", "HETATM"):
            name = l[12:16].strip()
            elem = l[76:78].strip().upper() if len(l) >= 78 else ""
            if elem in ("H", "HD") or (not elem and name.startswith("H")):
                continue
            atoms.setdefault(name, (float(l[30:38]), float(l[38:46]), float(l[46:54])))
    return atoms


def rmsd(pose, ref):
    common = [n for n in ref if n in pose]
    if not common:
        return math.nan, 0
    s = sum(sum((a - b) ** 2 for a, b in zip(pose[n], ref[n])) for n in common)
    return math.sqrt(s / len(common)), len(common)


def split_models(pdbqt):
    models, cur = [], []
    for l in pdbqt.splitlines():
        if l.startswith("MODEL"):
            cur = []
        elif l.startswith("ENDMDL"):
            models.append(cur)
        else:
            cur.append(l)
    return models


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8787")
    ap.add_argument("--exhaustiveness", type=int, default=8)
    args = ap.parse_args()

    lines = PDB.read_text().splitlines()
    receptor = [l for l in lines if l.startswith("ATOM  ")]
    ligand = [l for l in lines if l.startswith("HETATM") and l[17:20] == "MK1"]
    ref = read_atoms(ligand)
    xyz = list(ref.values())
    lo = [min(p[i] for p in xyz) for i in range(3)]
    hi = [max(p[i] for p in xyz) for i in range(3)]
    center = [round((a + b) / 2, 3) for a, b in zip(lo, hi)]
    size = [round(b - a + PAD, 3) for a, b in zip(lo, hi)]
    print(f"receptor atoms {len(receptor)}, ligand heavy atoms {len(ref)}, center {center}, size {size}")

    body = json.dumps({
        "receptor_pdb": "\n".join(receptor) + "\nEND\n",
        "ligand": {"text": "\n".join(ligand) + "\nEND\n", "format": "pdb"},
        "center": center, "size": size, "exhaustiveness": args.exhaustiveness, "num_modes": 9, "energy_range": 3, "seed": 42,
    }).encode()
    req = urllib.request.Request(f"{args.base}/api/dock/jobs", body, {"Content-Type": "application/json"})
    job = json.load(urllib.request.urlopen(req))["id"]
    print("job", job)

    result, err, event, last = None, None, None, -1
    with urllib.request.urlopen(f"{args.base}/api/dock/jobs/{job}/events") as stream:
        for raw in stream:
            line = raw.decode().rstrip("\n")
            if line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:"):
                data = json.loads(line[5:])
                if event == "stage":
                    print("stage:", data["stage"])
                elif event == "progress":
                    if data["value"] // 25 != last // 25:
                        print(f"progress: {data['value']}%")
                    last = data["value"]
                elif event == "done":
                    result = data
                    break
                elif event == "error":
                    err = data["message"]
                    break
    if err or not result:
        print("FAILED:", err)
        return 1

    models = split_models(result["poses"])
    print(f"\n{'mode':>4} {'affinity':>9} {'RMSD(crystal)':>14} {'atoms':>6}")
    rows = []
    for m, lines_ in zip(result["modes"], models):
        r, n = rmsd(read_atoms(lines_), ref)
        rows.append((m["mode"], m["affinity"], r, n))
        print(f"{m['mode']:>4} {m['affinity']:>9.2f} {r:>14.3f} {n:>6}")
    ok = any(r < 2.0 and a < 0 for _, a, r, _ in rows[:3])
    print("\nPASS" if ok else "\nFAIL", "(a top-3 pose with RMSD < 2.0 A and negative affinity)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
