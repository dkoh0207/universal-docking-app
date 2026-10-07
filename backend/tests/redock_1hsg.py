"""Redocking acceptance test: dock the native ligand of 1HSG (indinavir, MK1) back into its own pocket via the API.

Receptor = protein ATOM records (no water/HETATM); ligand = the MK1 HETATM records; box = MK1 bounding-box center,
size = extent + 8 A; exhaustiveness 8, seed 42. Heavy-atom RMSD of each pose vs the crystal ligand is computed as a symmetric
nearest-neighbour same-element RMSD (no superposition: poses are already in the crystal frame). Pass: one of the top 3 poses < 2.0 A with a
negative affinity.

    backend/.env/python backend/tests/redock_1hsg.py [--base http://127.0.0.1:8787] [--engine vina|smina|gnina]
"""

import argparse
import json
import math
import sys
import urllib.request
from pathlib import Path

PDB = Path(__file__).resolve().parents[2] / "frontend" / "public" / "structures" / "1HSG.pdb"
PAD = 8.0


def element(l):
    """Element of a PDB/PDBQT atom line (PDBQT types like OA / NA / A are mapped to O / N / C)."""
    t = l[76:78].strip().upper() if len(l) >= 78 else ""
    if not t:
        t = "".join(c for c in l[12:16] if c.isalpha()).upper()[:1]
    return "C" if t == "A" else t[0] if len(t) == 2 and t[1] == "A" else t


def read_atoms(lines):
    """[(element, x, y, z)] for the heavy atoms of PDB/PDBQT ATOM/HETATM lines."""
    return [(element(l), float(l[30:38]), float(l[38:46]), float(l[46:54]))
            for l in lines if l[:6] in ("ATOM  ", "HETATM") and element(l) not in ("H", "HD")]


def rmsd(pose, ref):
    """Symmetric nearest-neighbour heavy-atom RMSD (same element, no atom order or name needed, so it also works for
    PDBQT atom names / order rewritten by Open Babel and for symmetric groups). No superposition: poses share the crystal frame."""
    def one_way(a, b):
        d = [min((sum((p - q) ** 2 for p, q in zip(x[1:], y[1:])) for y in b if y[0] == x[0]), default=math.inf) for x in a]
        return sum(d) / len(d)
    if not pose or not ref:
        return math.nan, 0
    return math.sqrt(max(one_way(pose, ref), one_way(ref, pose))), len(pose)


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
    ap.add_argument("--engine", choices=["vina", "smina", "gnina"], default="vina")
    ap.add_argument("--no-gpu", action="store_true", help="gnina: CPU only")
    args = ap.parse_args()

    lines = PDB.read_text().splitlines()
    receptor = [l for l in lines if l.startswith("ATOM  ")]
    ligand = [l for l in lines if l.startswith("HETATM") and l[17:20] == "MK1"]
    ref = read_atoms(ligand)
    xyz = [a[1:] for a in ref]
    lo = [min(p[i] for p in xyz) for i in range(3)]
    hi = [max(p[i] for p in xyz) for i in range(3)]
    center = [round((a + b) / 2, 3) for a, b in zip(lo, hi)]
    size = [round(b - a + PAD, 3) for a, b in zip(lo, hi)]
    print(f"receptor atoms {len(receptor)}, ligand heavy atoms {len(ref)}, center {center}, size {size}")

    body = json.dumps({
        "receptor_pdb": "\n".join(receptor) + "\nEND\n",
        "ligand": {"text": "\n".join(ligand) + "\nEND\n", "format": "pdb"},
        "center": center, "size": size, "exhaustiveness": args.exhaustiveness, "num_modes": 9, "energy_range": 3, "seed": 42,
        "engine": args.engine, "no_gpu": args.no_gpu,
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
    # GNINA's affinity is CNN-rescored, so only the pose RMSD is judged for it
    ok = any(r < 2.0 and (a < 0 or args.engine == "gnina") for _, a, r, _ in rows[:3])
    print("\nPASS" if ok else "\nFAIL", "(a top-3 pose with RMSD < 2.0 A and negative affinity)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
