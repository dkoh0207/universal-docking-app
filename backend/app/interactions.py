"""Required-interaction filter for docked poses: ProLIF interactions of a pose against a rule set (e.g. backend/data/btk/interactions.json).

    rules = load_rules(path)
    prot = protein_molecule(receptor_pdb_path)                     # prepared receptor with hydrogens, original residue numbers
    found = pose_interactions(prot, pdbqt_model_text, template_smiles)   # {("MET477", "HBAcceptor"), ...}
    ok, missing = check(found, rules)
"""

import json
import re
import warnings
from pathlib import Path

AD = {"A": "C", "NA": "N", "OA": "O", "SA": "S", "HD": "H", "Cl": "Cl", "Br": "Br", "F": "F", "I": "I", "P": "P"}
TYPES = ["Hydrophobic", "HBDonor", "HBAcceptor", "PiStacking", "Anionic", "Cationic", "CationPi", "PiCation", "XBAcceptor", "XBDonor"]


def load_rules(path: Path) -> dict:
    return json.loads(Path(path).read_text())


def protein_molecule(pdb_path: Path):
    """ProLIF molecule of the (hydrogen-bearing) receptor; bonds come from the OpenMM topology (guessing them can crash RDKit)."""
    import MDAnalysis as mda
    import prolif as plf
    from openmm.app import PDBFile

    warnings.filterwarnings("ignore")
    pdb = PDBFile(str(pdb_path))
    u = mda.Universe(pdb.topology, str(pdb_path))
    u.residues.resids = [int(r.id) for r in pdb.topology.residues()]  # a Universe built from an OpenMM topology numbers residues from 1
    return plf.Molecule.from_mda(u.select_atoms("protein"))


def pdbqt_model_to_pdb(model: str) -> str:
    out = []
    for l in model.splitlines():
        if l[:6] in ("ATOM  ", "HETATM"):
            el = AD.get(l[77:79].strip(), l[77:79].strip()).upper()
            if el != "H":  # polar hydrogens of the PDBQT are rebuilt with AddHs (they would break the bond-order assignment)
                out.append(l[:66].ljust(76) + el.rjust(2))
    return "\n".join(out) + "\nEND\n"


def split_models(pdbqt: str) -> list[str]:
    parts = re.split(r"^MODEL\s+\d+\s*$", pdbqt, flags=re.M)
    return [p.split("ENDMDL")[0] for p in parts[1:]] or [pdbqt]


def ligand_molecule(pose_pdbqt: str, template_smiles: str | list[str]):
    """RDKit molecule with bond orders (from the template SMILES), hydrogens and the pose coordinates; None if the pose does not match the template."""
    from rdkit import Chem
    from rdkit.Chem import AllChem

    pose = Chem.MolFromPDBBlock(pdbqt_model_to_pdb(pose_pdbqt), removeHs=True, proximityBonding=True, sanitize=False)
    if pose is None:
        return None
    mol = None
    for smi in [template_smiles] if isinstance(template_smiles, str) else template_smiles:  # e.g. the pH 7.4 form, then the neutral one
        tmpl = Chem.MolFromSmiles(smi)
        if tmpl is None:
            continue
        try:
            pose.UpdatePropertyCache(strict=False)
            mol = Chem.AddHs(AllChem.AssignBondOrdersFromTemplate(tmpl, pose), addCoords=True)
            break
        except Exception:  # noqa: BLE001  (atom-count / topology / charge mismatch)
            continue
    if mol is None:
        return None
    for i, a in enumerate(mol.GetAtoms()):  # ProLIF splits molecules by residue: one residue for every atom, hydrogens included
        a.SetMonomerInfo(Chem.AtomPDBResidueInfo(f" {a.GetSymbol():<3}", residueName="LIG", residueNumber=1, chainId="L", serialNumber=i + 1))
    return mol


def pose_interactions(prot, pose_pdbqt: str, template_smiles: str | list[str], types: list[str] = TYPES) -> set[tuple[str, str]] | None:
    import prolif as plf

    mol = ligand_molecule(pose_pdbqt, template_smiles)
    if mol is None:
        return None
    fp = plf.Fingerprint(types)
    fp.run_from_iterable([plf.Molecule.from_rdkit(mol)], prot, progress=False)
    df = fp.to_dataframe()
    return {(re.sub(r"\.\w+$", "", str(c[1])), str(c[2])) for c in df.columns if bool(df[c].iloc[0])}


def check(found: set[tuple[str, str]] | None, rules: dict) -> tuple[bool, list[str]]:
    """(passes, missing): every `polar.must` residue needs one of its H-bond types and `hydrophobic.min_count` listed residues need a hydrophobic contact."""
    if found is None:
        return False, ["unparsable pose"]
    missing = []
    for m in rules["polar"]["must"]:
        if not any(r == m["res"] and t in m["types"] for r, t in found):
            missing.append(f"{m['res']} H-bond")
    hyd = {r for r, t in found if t == "Hydrophobic" and r in rules["hydrophobic"]["residues"]}
    if len(hyd) < rules["hydrophobic"]["min_count"]:
        missing.append(f"hydrophobic {len(hyd)}/{rules['hydrophobic']['min_count']}")
    return not missing, missing


def score(found: set[tuple[str, str]] | None, rules: dict) -> float:
    """Knowledge-based score: required-polar hits weigh 3, optional polar 1, listed hydrophobic residues 0.5 each."""
    if found is None:
        return 0.0
    s = 0.0
    for kind, w in (("must", 3.0), ("optional", 1.0)):
        s += w * sum(any(r == m["res"] and t in m["types"] for r, t in found) for m in rules["polar"][kind])
    return s + 0.5 * len({r for r, t in found if t == "Hydrophobic" and r in rules["hydrophobic"]["residues"]})
