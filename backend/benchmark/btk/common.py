"""Shared paths, receptor and ligand preparation for the BTK benchmark."""

import csv
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "backend"))
from app import tools  # noqa: E402

RUN = ROOT / ".run" / "btk"
RULES = ROOT / "backend" / "data" / "btk" / "interactions.json"
PH = "7.4"
BOX = 22.0  # cubic search box edge (A) centred on the crystal ligand: covers the ATP site and the back pocket, ~2x faster than ligand extent + 16
HINGE = "EYMANG"  # Cys481 is Ser in some constructs


def ligands() -> list[dict]:
    with (RUN / "set.csv").open() as f:
        return [dict(r, active=int(r["active"])) for r in csv.DictReader(f)]


def obabel(args: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess:
    b = tools.obabel_bin()
    return subprocess.run([b, *args], capture_output=True, text=True, env=tools.tool_env(b), cwd=cwd, timeout=120)


def prep_receptor(pid: str) -> dict:
    """Clean chain A of a PDB entry (PDBFixer, H at pH 7.4, original residue ids), receptor.pdbqt via Open Babel, box from the crystal ligand."""
    import re

    from openmm.app import PDBFile
    from pdbfixer import PDBFixer

    d = RUN / "receptors" / pid
    d.mkdir(parents=True, exist_ok=True)
    meta = d / "meta.json"
    if meta.exists():
        return json.loads(meta.read_text())
    src = RUN / f"{pid}.pdb"
    lines = src.read_text().splitlines()
    ref = json.loads((RUN / "consensus.json").read_text())["structures"].get(pid, {}).get("ligand")
    chain = next(l[21] for l in lines if l.startswith("HETATM") and l[17:20].strip() == ref)
    lig = [l for l in lines if l.startswith("HETATM") and l[17:20].strip() == ref and l[21] == chain and l[16] in " A"]
    prot = [l for l in lines if l.startswith("ATOM") and l[21] == chain and l[16] in " A"]
    (d / "raw.pdb").write_text("\n".join(prot) + "\nEND\n")
    (d / "crystal_ligand.pdb").write_text("\n".join(lig) + "\nEND\n")
    fx = PDBFixer(filename=str(d / "raw.pdb"))
    fx.findMissingResidues()
    fx.missingResidues = {}
    fx.findNonstandardResidues()
    fx.replaceNonstandardResidues()
    fx.findMissingAtoms()
    fx.addMissingAtoms()
    fx.addMissingHydrogens(float(PH))
    with open(d / "receptor.pdb", "w") as f:
        PDBFile.writeFile(fx.topology, fx.positions, f, keepIds=True)
    r = obabel([str(d / "receptor.pdb"), "-xr", "-O", str(d / "receptor.pdbqt")])
    if not (d / "receptor.pdbqt").is_file():
        raise RuntimeError(r.stderr[-300:])
    xyz = [(float(l[30:38]), float(l[38:46]), float(l[46:54])) for l in lig]
    lo, hi = [min(p[i] for p in xyz) for i in range(3)], [max(p[i] for p in xyz) for i in range(3)]
    seq = {"ALA": "A", "ARG": "R", "ASN": "N", "ASP": "D", "CYS": "C", "GLN": "Q", "GLU": "E", "GLY": "G", "HIS": "H", "ILE": "I", "LEU": "L",
           "LYS": "K", "MET": "M", "PHE": "F", "PRO": "P", "SER": "S", "THR": "T", "TRP": "W", "TYR": "Y", "VAL": "V"}
    res = [(int(l[22:26]), seq.get(l[17:20], "X")) for l in prot if l[12:16] == " CA "]
    s = "".join(c for _, c in res)
    k = s.find(HINGE)
    offset = 477 - res[k + 2][0] if k >= 0 else 0
    out = {"pdb": pid, "ligand": ref, "chain": chain, "center": [round((a + b) / 2, 3) for a, b in zip(lo, hi)],
           "size": [BOX, BOX, BOX], "numbering_offset": offset}
    meta.write_text(json.dumps(out))
    return out


def prep_ligand(row: dict, outdir: Path) -> dict | None:
    """SMILES -> protonated 3D PDBQT (+ the protonated SMILES used as the bond-order template for pose analysis)."""
    outdir.mkdir(parents=True, exist_ok=True)
    smi = outdir / f"{row['id']}.smi"
    smi.write_text(f"{row['smiles']} {row['id']}\n")
    pdbqt = outdir / f"{row['id']}.pdbqt"
    r = obabel([str(smi), "--gen3D", "-p", PH, "-O", str(pdbqt)])
    if not pdbqt.is_file() or pdbqt.stat().st_size == 0:
        return None
    t = obabel([str(smi), "-p", PH, "-osmi", "-xn"])
    tmpl = t.stdout.split()[0] if t.stdout.strip() else row["smiles"]
    return {"id": row["id"], "template": tmpl}


if __name__ == "__main__":
    print(json.dumps(prep_receptor(sys.argv[1] if len(sys.argv) > 1 else "5T18")))
