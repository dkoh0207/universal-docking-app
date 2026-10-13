"""Trajectory analysis for app.md.simulate output: stability / sanity metrics and the ProLIF interaction history.

    python -m app.md.analysis <work dir>        # writes results.json and view.pdb (protein + ligand, aligned)
"""

import csv
import json
import sys
import warnings
from pathlib import Path

import MDAnalysis as mda
import numpy as np
from MDAnalysis.analysis import align, rms
from openmm import app

warnings.filterwarnings("ignore")
MAX_POINTS = 400  # series are thinned to this many points
VIEW_FRAMES = 40  # models in view.pdb
POCKET_A = 5.0


def thin(a, n=MAX_POINTS):
    a = np.asarray(a)
    if len(a) <= n:
        return a
    return a[np.linspace(0, len(a) - 1, n).round().astype(int)]


def lst(a, nd=3):
    return [round(float(x), nd) for x in thin(a)]


def read_state(path: Path):
    rows = list(csv.reader(path.open()))
    head = [h.strip('#" ') for h in rows[0]]
    cols = {h: np.array([float(r[i]) for r in rows[1:]]) for i, h in enumerate(head)}
    return cols


def fingerprint(u, lig, prot, frames):
    import prolif as plf

    fp = plf.Fingerprint(["Hydrophobic", "HBDonor", "HBAcceptor", "PiStacking", "Anionic", "Cationic", "CationPi", "PiCation", "XBAcceptor", "XBDonor"])
    fp.run(u.trajectory[frames], lig, prot, progress=False, n_jobs=1)
    df = fp.to_dataframe()  # index: frame; columns: (ligand, protein residue, interaction)
    cols, rows = [], []
    for c in df.columns:
        cols.append({"res": str(c[1]), "type": str(c[2])})
        rows.append(df[c].to_numpy(dtype=bool).tolist())
    order = sorted(range(len(cols)), key=lambda i: (-sum(rows[i]), cols[i]["res"]))
    return [dict(cols[i], present=[int(v) for v in rows[i]], occupancy=round(sum(rows[i]) / len(rows[i]), 3)) for i in order]


def main(work: Path):
    cfg = json.loads((work / "config.json").read_text())
    meta = json.loads((work / "meta.json").read_text())
    state = read_state(work / "state.csv")
    pdb = app.PDBFile(str(work / "system.pdb"))
    u = mda.Universe(pdb.topology, str(work / "traj.dcd"))
    chain_of = [r.chain.id for r in pdb.topology.residues()]
    u.residues.resids = [int(r.id) for r in pdb.topology.residues()]  # the original PDB numbering (MDAnalysis would number chain B on from chain A)
    # PDB residue naming from OpenMM is kept; the ligand is residue LIG, polymer is "protein"
    prot, lig = u.select_atoms("protein"), u.select_atoms("resname LIG")
    n = len(u.trajectory)
    dt_ps = meta["report_ps"]
    times = np.arange(1, n + 1) * dt_ps

    # keep every protein chain and the ligand in the same periodic image as the first chain (chains are separate molecules,
    # so older / wrapped trajectories can have them in different images, tens of angstroms apart)
    frags = u.select_atoms("protein or resname LIG").fragments

    def image_together(ts):
        box = ts.dimensions[:3]
        if box.min() <= 0:
            return ts
        anchor = frags[0].center_of_geometry()
        for f in frags[1:]:
            f.translate(-np.round((f.center_of_geometry() - anchor) / box) * box)
        return ts

    u.trajectory.add_transformations(image_together)

    # superpose on the protein backbone of frame 0 (in memory), so ligand motion is relative to the pocket
    align.AlignTraj(u, u, select="protein and backbone", in_memory=True).run()

    bb = rms.RMSD(u, u, select="protein and backbone", groupselections=["resname LIG and not name H*"], ref_frame=0).run()
    ca = u.select_atoms("protein and name CA")
    rmsf = rms.RMSF(ca).run().results.rmsf
    rg = np.array([prot.radius_of_gyration() for _ in u.trajectory])
    pocket = u.select_atoms(f"protein and around {POCKET_A} (resname LIG)")  # at the last-aligned frame; recompute at frame 0
    u.trajectory[0]
    pocket = u.select_atoms(f"protein and around {POCKET_A} resname LIG", updating=False)
    pocket_res = pocket.residues
    from MDAnalysis.lib.distances import distance_array

    com_d, min_d, contacts = [], [], []
    heavy_lig = u.select_atoms("resname LIG and not name H*")
    heavy_prot = u.select_atoms("protein and not name H*")
    for _ in u.trajectory:
        com_d.append(np.linalg.norm(lig.center_of_mass() - pocket_res.atoms.center_of_mass()))
        d = distance_array(heavy_lig.positions, heavy_prot.positions)
        min_d.append(d.min())
        contacts.append(int((d < 4.0).any(axis=0).sum()))

    # ProLIF on up to 100 frames
    sel = list(range(0, n, max(1, n // 100)))
    inter = fingerprint(u, lig, prot, sel)
    fp_times = [float(times[i]) for i in sel]

    # trajectory for the viewer: protein + ligand heavy atoms (no water, no H), up to VIEW_FRAMES models
    view_idx = list(np.linspace(0, n - 1, min(n, VIEW_FRAMES)).round().astype(int))
    keep = u.select_atoms("(protein or resname LIG) and not name H*")
    with mda.Writer(str(work / "view.pdb"), keep.n_atoms, multiframe=True) as w:
        for i in view_idx:
            u.trajectory[i]
            w.write(keep)

    t_ps = state["Time (ps)"] if "Time (ps)" in state else times
    pot, kin = state["Potential Energy (kJ/mole)"], state["Kinetic Energy (kJ/mole)"]
    tot = state.get("Total Energy (kJ/mole)", pot + kin)
    temp, dens = state["Temperature (K)"], state["Density (g/mL)"]
    slope = np.polyfit(t_ps, pot, 1)[0] if len(t_ps) > 2 else 0.0  # kJ/mol/ps; potential energy (total energy is not conserved under a thermostat / barostat)
    lrmsd = bb.results.rmsd[:, 3]
    half = len(lrmsd) // 2
    checks = [
        {"id": "temperature", "ok": abs(temp.mean() - cfg["temperature_k"]) / cfg["temperature_k"] < 0.03,
         "value": round(float(temp.mean()), 1), "target": cfg["temperature_k"], "unit": "K"},
        {"id": "density", "ok": bool(0.95 < dens.mean() < 1.08), "value": round(float(dens.mean()), 3), "target": 1.0, "unit": "g/mL"},
        {"id": "energy", "ok": bool(abs(slope * (t_ps[-1] - t_ps[0])) < 0.002 * abs(pot.mean())), "value": round(float(slope), 2), "target": 0, "unit": "kJ/mol/ps"},
        {"id": "protein_rmsd", "ok": bool(bb.results.rmsd[:, 2].max() < 4.0), "value": round(float(bb.results.rmsd[:, 2].max()), 2), "target": 4.0, "unit": "Å"},
        {"id": "ligand_rmsd", "ok": bool(lrmsd.max() < 5.0), "value": round(float(lrmsd.max()), 2), "target": 5.0, "unit": "Å"},
        {"id": "ligand_bound", "ok": bool(min_d[-1] < 4.5), "value": round(float(min_d[-1]), 2), "target": 4.5, "unit": "Å"},
        {"id": "plateau", "ok": bool(abs(lrmsd[half:].mean() - lrmsd[:half].mean()) < 1.5) if half else True,
         "value": round(float(lrmsd[half:].mean() - lrmsd[:half].mean()), 2) if half else 0, "target": 0, "unit": "Å"},
    ]
    res = {
        "meta": meta, "config": cfg, "times": lst(times, 2),
        "rmsd": {"protein": lst(bb.results.rmsd[:, 2]), "ligand": lst(lrmsd)},
        "rmsf": {"res": [int(r.resid) for r in ca.residues], "chain": [chain_of[i] for i in ca.residues.resindices], "value": [round(float(x), 3) for x in rmsf]},
        "rg": lst(rg), "com_dist": lst(com_d), "min_dist": lst(min_d), "contacts": [int(x) for x in thin(contacts)],
        "state": {"time": lst(t_ps, 2), "potential": lst(pot, 1), "kinetic": lst(kin, 1), "total": lst(tot, 1), "temperature": lst(temp, 2),
                  "density": lst(dens, 4), "volume": lst(state["Box Volume (nm^3)"], 3) if "Box Volume (nm^3)" in state else []},
        "interactions": {"times": fp_times, "items": inter},
        "checks": checks, "view_frames": len(view_idx), "view_dt_ps": float(dt_ps * (n - 1) / max(len(view_idx) - 1, 1)),
        "pocket": [f"{r.resname}{r.resid}" for r in pocket_res],
    }
    (work / "results.json").write_text(json.dumps(res, default=lambda o: o.item() if hasattr(o, "item") else str(o)))
    print("@@ " + json.dumps({"stage": "analysis", "progress": 100}), flush=True)


if __name__ == "__main__":
    main(Path(sys.argv[1]))
