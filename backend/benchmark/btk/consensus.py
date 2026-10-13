"""Derive the conserved BTK-ligand interactions from crystal complexes with ProLIF (cross-check of the literature residues).

    backend/.env/bin/python backend/benchmark/btk/consensus.py [PDBID ...]      # writes .run/btk/consensus.json
"""

import json
import re
import sys
import urllib.request
import warnings
from collections import Counter
from pathlib import Path

import MDAnalysis as mda
import prolif as plf
from rdkit import Chem
from rdkit.Chem import AllChem

warnings.filterwarnings("ignore")
OUT = Path(__file__).resolve().parents[3] / ".run" / "btk"
PANEL = ["5T18", "4OT5", "4OTQ", "6O8I", "5U9D", "6E4F", "7N4Q", "6VXQ", "6DI1", "3GEN", "3K54", "4RFZ"]
SKIP = {"HOH", "DMS", "EDO", "GOL", "PEG", "SO4", "IMD", "ACT", "BTB", "PG0", "DTT", "CL", "MG", "ZN", "IOD", "PGO"}


def get(url: str) -> str:
    return urllib.request.urlopen(url, timeout=60).read().decode()


def smiles_of(comp: str) -> str:
    d = json.loads(get(f"https://data.rcsb.org/rest/v1/core/chemcomp/{comp}"))
    return d["rcsb_chem_comp_descriptor"].get("SMILES_stereo") or d["rcsb_chem_comp_descriptor"]["SMILES"]


def analyse(pid: str):
    pdb = OUT / f"{pid}.pdb"
    if not pdb.exists():
        pdb.write_text(get(f"https://files.rcsb.org/download/{pid}.pdb"))
    lines = pdb.read_text().splitlines()
    het = Counter(l[17:20].strip() for l in lines if l.startswith("HETATM"))
    comps = [c for c, n in het.most_common() if c not in SKIP and c != "HOH" and n >= 10]
    if not comps:
        return None
    comp = comps[0]
    chain = next(l[21] for l in lines if l.startswith("HETATM") and l[17:20].strip() == comp)
    lig_lines = [l for l in lines if l.startswith("HETATM") and l[17:20].strip() == comp and l[21] == chain and l[16] in " A"]
    prot_lines = [l for l in lines if l.startswith("ATOM") and l[21] == chain and l[16] in " A"]
    mol = Chem.MolFromPDBBlock("\n".join(lig_lines), removeHs=True, proximityBonding=True)
    mol = AllChem.AssignBondOrdersFromTemplate(Chem.MolFromSmiles(smiles_of(comp)), mol)
    mol = Chem.AddHs(mol, addCoords=True)
    fixed = OUT / f"{pid}_prot.pdb"
    if not fixed.exists():
        from openmm.app import PDBFile
        from pdbfixer import PDBFixer

        (OUT / f"{pid}_raw.pdb").write_text("\n".join(prot_lines) + "\nEND\n")
        fx = PDBFixer(filename=str(OUT / f"{pid}_raw.pdb"))
        fx.findMissingResidues()
        fx.missingResidues = {}
        fx.findNonstandardResidues()
        fx.replaceNonstandardResidues()
        fx.findMissingAtoms()
        fx.addMissingAtoms()
        fx.addMissingHydrogens(7.4)
        with open(fixed, "w") as f:
            PDBFile.writeFile(fx.topology, fx.positions, f, keepIds=True)
    from openmm.app import PDBFile

    u = mda.Universe(PDBFile(str(fixed)).topology, str(fixed))  # OpenMM bonds are exact; guessing them on a protein with hydrogens can crash RDKit
    pm = plf.Molecule.from_mda(u.select_atoms("protein"))
    for i, a in enumerate(mol.GetAtoms()):  # ProLIF splits by residue: give every atom (incl. added H) the same one
        a.SetMonomerInfo(Chem.AtomPDBResidueInfo(f" {a.GetSymbol():<3}", residueName="LIG", residueNumber=1, chainId="L", serialNumber=i + 1))
    lm = plf.Molecule.from_rdkit(mol)
    fp = plf.Fingerprint(["Hydrophobic", "HBDonor", "HBAcceptor", "PiStacking", "Anionic", "Cationic", "CationPi", "PiCation"])
    fp.run_from_iterable([lm], pm, progress=False)
    df = fp.to_dataframe()
    three = {"ALA": "A", "ARG": "R", "ASN": "N", "ASP": "D", "CYS": "C", "GLN": "Q", "GLU": "E", "GLY": "G", "HIS": "H", "ILE": "I", "LEU": "L",
             "LYS": "K", "MET": "M", "PHE": "F", "PRO": "P", "SER": "S", "THR": "T", "TRP": "W", "TYR": "Y", "VAL": "V"}
    res = [r for r in u.select_atoms("protein").residues]
    seq = "".join(three.get(r.resname[:3], "X") for r in res)
    k = seq.find("EYMANGC")  # hinge Glu475-Tyr476-Met477-Ala478-Asn479-Gly480-Cys481: fixes the numbering of constructs / other species
    if k < 0:
        raise ValueError("hinge motif EYMANGC not found")
    off = 477 - res[k + 2].resid
    return comp, [(re.sub(r"\d+", lambda m: str(int(m[0]) + off), str(c[1])), str(c[2])) for c in df.columns if df[c].iloc[0]]


def main(ids):
    OUT.mkdir(parents=True, exist_ok=True)
    per = {}
    for pid in ids:
        try:
            r = analyse(pid)
        except Exception as e:  # noqa: BLE001
            print(pid, "failed:", str(e)[:120])
            continue
        if r:
            per[pid] = {"ligand": r[0], "interactions": r[1]}
            print(pid, r[0], len(r[1]), "interactions")
    cnt = Counter(i for v in per.values() for i in set(map(tuple, v["interactions"])))
    n = len(per)
    cons = [{"res": r, "type": t, "fraction": round(c / n, 2)} for (r, t), c in cnt.most_common() if c / n >= 0.3]
    (OUT / "consensus.json").write_text(json.dumps({"n": n, "structures": per, "consensus": cons}, indent=1))
    for c in cons:
        print(f"{c['res']:10} {c['type']:12} {c['fraction']:.2f}")


if __name__ == "__main__":
    main(sys.argv[1:] or PANEL)
