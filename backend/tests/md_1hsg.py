"""End-to-end MD acceptance test: redock the native ligand of 1HSG (indinavir, MK1) with Vina, then run a short OpenMM
simulation of the top pose through the API and check the run-quality metrics and the ProLIF interactions.

    backend/.env/python backend/tests/md_1hsg.py [--base http://127.0.0.1:8787] [--ns 0.1] [--report-ps 10] [--wall 300]
"""

import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import redock_1hsg as rd  # noqa: E402

AD = {"A": "C", "NA": "N", "OA": "O", "SA": "S", "HD": "H"}


def post(base, path, body):
    req = urllib.request.Request(f"{base}{path}", json.dumps(body).encode(), {"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))


def stream(base, path):
    event = None
    with urllib.request.urlopen(f"{base}{path}") as s:
        for raw in s:
            line = raw.decode().rstrip("\n")
            if line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:"):
                yield event, json.loads(line[5:])
                if event in ("done", "error"):
                    return


def pdbqt_to_pdb(model_lines):
    out = []
    for l in model_lines:
        if l[:6] in ("ATOM  ", "HETATM"):
            el = AD.get(l[77:79].strip(), l[77:79].strip()).upper()
            out.append(l[:66].ljust(76) + el.rjust(2))
    return "\n".join(out) + "\nEND\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8787")
    ap.add_argument("--ns", type=float, default=0.1)
    ap.add_argument("--report-ps", type=float, default=10)
    ap.add_argument("--wall", type=int, default=300)
    ap.add_argument("--crystal", action="store_true", help="simulate the crystal pose instead of the redocked one")
    args = ap.parse_args()
    t0 = time.time()

    lines = rd.PDB.read_text().splitlines()
    receptor = [l for l in lines if l.startswith("ATOM  ")]
    ligand = [l for l in lines if l.startswith("HETATM") and l[17:20] == "MK1"]
    ref = rd.read_atoms(ligand)
    xyz = [a[1:] for a in ref]
    lo = [min(p[i] for p in xyz) for i in range(3)]
    hi = [max(p[i] for p in xyz) for i in range(3)]
    center = [round((a + b) / 2, 3) for a, b in zip(lo, hi)]
    size = [round(b - a + rd.PAD, 3) for a, b in zip(lo, hi)]

    pose_pdb = "\n".join(ligand) + "\nEND\n"
    if not args.crystal:
        job = post(args.base, "/api/dock/jobs", {
            "receptor_pdb": "\n".join(receptor) + "\nEND\n", "ligand": {"text": pose_pdb, "format": "pdb"}, "center": center, "size": size,
            "exhaustiveness": 8, "num_modes": 9, "energy_range": 10, "seed": 42, "engine": "vina"})["id"]
        result = next(d for e, d in stream(args.base, f"/api/dock/jobs/{job}/events") if e in ("done", "error"))
        if "poses" not in result:
            print("DOCK FAILED", result)
            return 1
        models = rd.split_models(result["poses"])
        r, _ = rd.rmsd(rd.read_atoms(models[0]), ref)
        print(f"redock: top pose {result['modes'][0]['affinity']} kcal/mol, RMSD vs crystal {r:.2f} A  [{time.time() - t0:.0f}s]")
        pose_pdb = pdbqt_to_pdb(models[0])

    job = post(args.base, "/api/md/jobs", {
        "receptor_pdb": "\n".join(receptor) + "\nEND\n", "ligand_pdb": pose_pdb, "ligand_resname": "MK1",
        "production_ns": args.ns, "report_ps": args.report_ps, "max_wall_s": args.wall})["id"]
    print("md job", job)
    stage, last = None, -1
    for ev, d in stream(args.base, f"/api/md/jobs/{job}/events"):
        if ev == "stage" and d["stage"] != stage:
            stage = d["stage"]
            print(f"[{time.time() - t0:5.0f}s] stage {stage}")
        elif ev == "log":
            print("   ", d["text"])
        elif ev == "error":
            print("MD FAILED:", d["message"])
            return 1
        elif ev == "progress" and stage == "production" and d["value"] // 25 != last // 25:
            print(f"    production {d['value']}%")
            last = d["value"]
    res = json.load(urllib.request.urlopen(f"{args.base}/api/md/jobs/{job}/results"))
    total = time.time() - t0
    m = res["meta"]
    print(f"\nframes {m['frames']}/{m['frames_requested']} on {m['platform']}, {m['atoms']} atoms, {m['ns_per_day']:.0f} ns/day, total {total:.0f}s")
    for c in res["checks"]:
        print(f"  {'ok ' if c['ok'] else 'BAD'} {c['id']:14} {c['value']} {c['unit']}")
    items = res["interactions"]["items"]
    print("top interactions:", [(i["res"], i["type"], i["occupancy"]) for i in items[:8]])
    ok = all(c["ok"] for c in res["checks"]) and len(items) >= 1 and total <= 330
    print("\nPASS" if ok else "\nFAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
