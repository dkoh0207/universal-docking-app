"""OpenMM protein-ligand MD (run as a subprocess by routers/md.py).

    python -m app.md.simulate <work dir>        # reads <work dir>/config.json, receptor.pdb, ligand.pdb

Progress goes to stdout as lines `@@ {json}`; files written to the work dir: system.pdb (solvated start), traj.dcd,
state.csv (StateDataReporter), meta.json. Analysis (ProLIF, RMSD, ...) is a separate step (app.md.analysis).
"""

import json
import sys
import time
from pathlib import Path

T0 = time.time()  # before the heavy imports (cold imports from a slow disk count against the wall-time cap)
NAGL = "openff-gnn-am1bcc-0.1.0-rc.3.pt"
if json.loads((Path(sys.argv[1]) / "config.json").read_text())["ligand_charges"] != "nagl":
    sys.modules["openff.nagl"] = sys.modules["openff.nagl_models"] = None  # importing PyTorch (via NAGL) alone takes ~1 min from a slow disk

import numpy as np
import openmm as mm
from openff.toolkit import Molecule
from openmm import app, unit
from openmmforcefields.generators import SystemGenerator
from pdbfixer import PDBFixer
from rdkit import Chem
from rdkit.Chem import AllChem

ANALYSIS_RESERVE_S = 40  # wall time kept free for trajectory analysis


def emit(**kw):
    print("@@ " + json.dumps(kw), flush=True)


def log(text: str):
    emit(log=f"[{time.time() - T0:5.1f}s] {text}")


def ligand_mol(pose_pdb: str, smiles: str):
    """RDKit molecule with correct bond orders (from the SMILES template), explicit hydrogens and the pose coordinates."""
    pose = Chem.MolFromPDBBlock(pose_pdb, removeHs=True, proximityBonding=True)
    tmpl = Chem.MolFromSmiles(smiles)
    if pose is None or tmpl is None:
        raise ValueError("Could not read the ligand pose or its SMILES")
    mol = AllChem.AssignBondOrdersFromTemplate(tmpl, pose)
    return Chem.AddHs(mol, addCoords=True)


def pick_platform(name: str, precision: str = "mixed"):
    names = [mm.Platform.getPlatform(i).getName() for i in range(mm.Platform.getNumPlatforms())]
    order = [name] if name != "auto" else ["CUDA", "OpenCL", "CPU"]
    for n in order:
        if n not in names:
            continue
        props = {"Precision": precision} if n in ("CUDA", "OpenCL") else {}
        try:  # a platform can be listed yet unusable (no driver / unsupported GPU): try a tiny context
            s = mm.System()
            s.addParticle(1.0)
            mm.Context(s, mm.VerletIntegrator(0.001), mm.Platform.getPlatformByName(n), props)
            return mm.Platform.getPlatformByName(n), props
        except Exception as e:  # noqa: BLE001
            log(f"platform {n} unusable: {str(e).splitlines()[0]}")
    raise RuntimeError(f"No usable OpenMM platform ({', '.join(names)})")


def main(work: Path):
    cfg = json.loads((work / "config.json").read_text())
    nm, ps, kj = unit.nanometer, unit.picosecond, unit.kilojoule_per_mole
    T = cfg["temperature_k"] * unit.kelvin
    dt_fs = cfg["timestep_fs"]
    dt = dt_fs * unit.femtosecond
    steps_per_ps = round(1000 / dt_fs)
    deadline = T0 + cfg["max_wall_s"] - ANALYSIS_RESERVE_S

    # ---------------------------------------------------------------- prepare
    emit(stage="prepare", progress=0)
    plat, props = pick_platform(cfg["platform"], cfg.get("precision", "mixed"))
    log(f"OpenMM {mm.__version__}, platform {plat.getName()}")
    fixer = PDBFixer(filename=str(work / "receptor.pdb"))
    fixer.removeHeterogens(keepWater=False)
    fixer.findMissingResidues()
    fixer.missingResidues = {}  # do not model gaps / termini
    fixer.findNonstandardResidues()
    fixer.replaceNonstandardResidues()
    fixer.findMissingAtoms()
    fixer.addMissingAtoms()
    fixer.addMissingHydrogens(7.4)
    log(f"receptor: {fixer.topology.getNumAtoms()} atoms after PDBFixer")

    rd = ligand_mol((work / "ligand.pdb").read_text(), cfg["smiles"])
    off = Molecule.from_rdkit(rd, allow_undefined_stereo=True)
    for a in off.atoms:  # the pose's PDB residue info would split the ligand into several residues (heavy atoms vs added H)
        a.metadata.clear()
    method = NAGL if cfg["ligand_charges"] == "nagl" else cfg["ligand_charges"]
    off.assign_partial_charges(method)
    log(f"ligand: {off.n_atoms} atoms, net charge {off.total_charge}, charges by {method}")

    ff_kwargs = {"constraints": app.HBonds, "rigidWater": True, "removeCMMotion": True}
    if cfg["hmr"]:
        ff_kwargs["hydrogenMass"] = 1.5 * unit.amu
    gen = SystemGenerator(
        forcefields=[f"{cfg['protein_ff']}.xml", f"{cfg['water_ff']}.xml"], small_molecule_forcefield=cfg["ligand_ff"], molecules=[off],
        forcefield_kwargs=ff_kwargs,
        periodic_forcefield_kwargs={"nonbondedMethod": app.PME, "nonbondedCutoff": cfg["cutoff_nm"] * nm},
    )
    model = app.Modeller(fixer.topology, fixer.positions)
    n_prot = model.topology.getNumAtoms()
    model.add(off.to_topology().to_openmm(), off.conformers[0].to_openmm())
    for r in model.topology.residues():
        if r.index == model.topology.getNumResidues() - 1:
            r.name = "LIG"
    log("solvating")
    model.addSolvent(gen.forcefield, model=cfg["water_model"], padding=cfg["padding_nm"] * nm,
                     ionicStrength=cfg["ionic_strength_m"] * unit.molar, neutralize=True)
    top = model.topology
    for i, r in enumerate(top.residues()):  # the ligand residue (from OpenFF) has an int id, which PDBFile.writeFile(keepIds=True) rejects
        r.id = str(r.id) if isinstance(r.id, str) else str(10000 + i)
    log(f"system: {top.getNumAtoms()} atoms, box {[round(v, 2) for v in top.getUnitCellDimensions().value_in_unit(nm)]} nm")
    with open(work / "system.pdb", "w") as f:
        app.PDBFile.writeFile(top, model.positions, f, keepIds=True)
    system = gen.create_system(top, molecules=[off])
    (work / "system.xml").write_text(mm.XmlSerializer.serialize(system))

    # positional restraints on protein backbone + ligand heavy atoms, released during NPT
    rest = mm.CustomExternalForce("0.5*kr*periodicdistance(x, y, z, x0, y0, z0)^2")
    rest.addGlobalParameter("kr", cfg["restraint_k"] * kj / nm ** 2)
    for p in ("x0", "y0", "z0"):
        rest.addPerParticleParameter(p)
    pos = model.positions
    for a in top.atoms():
        heavy = a.element is not None and a.element.symbol != "H"
        if heavy and ((a.residue.name == "LIG") or (a.index < n_prot and a.name in ("N", "CA", "C"))):
            rest.addParticle(a.index, pos[a.index].value_in_unit(nm))
    system.addForce(rest)

    integ = mm.LangevinMiddleIntegrator(T, cfg["friction_ps"] / ps, dt)
    integ.setRandomNumberSeed(cfg["seed"])
    sim = app.Simulation(top, system, integ, plat, props)
    sim.context.setPositions(pos)
    emit(stage="minimize", progress=0)
    e_prev = None
    for _ in range(10):  # rounds of L-BFGS until the energy stops dropping (clashes from H placement / docked poses need more than one)
        sim.minimizeEnergy(tolerance=10 * kj / nm, maxIterations=cfg["minimize_steps"])
        e = sim.context.getState(getEnergy=True).getPotentialEnergy().value_in_unit(kj)
        if not np.isfinite(e) or (e_prev is not None and abs(e_prev - e) < 50):
            break
        e_prev = e
    log(f"minimised, potential energy {e:.0f} kJ/mol")
    if not np.isfinite(e):
        raise RuntimeError("Energy minimisation diverged (NaN): check the ligand pose for clashes")
    sim.context.setVelocitiesToTemperature(T, cfg["seed"])

    # ---------------------------------------------------------------- equilibration
    nvt_steps = cfg["nvt_ps"] * steps_per_ps
    emit(stage="nvt", progress=0)
    for i in range(0, nvt_steps, steps_per_ps * 5 or 1):
        sim.step(min(steps_per_ps * 5, nvt_steps - i))
        emit(stage="nvt", progress=round(100 * (i + 1) / max(nvt_steps, 1)))
    log(f"NVT {cfg['nvt_ps']} ps done")

    baro = mm.MonteCarloBarostat(cfg["pressure_bar"] * unit.bar, T, cfg["barostat_interval"])
    baro.setRandomNumberSeed(cfg["seed"])
    system.addForce(baro)
    sim.context.reinitialize(preserveState=True)
    npt_ps = cfg["npt_ps"]
    emit(stage="npt", progress=0)
    for ps_i in range(npt_ps):  # ramp the restraints to zero
        sim.context.setParameter("kr", cfg["restraint_k"] * (1 - (ps_i + 1) / npt_ps) * kj / nm ** 2)
        sim.step(steps_per_ps)
        if ps_i % 5 == 0:
            emit(stage="npt", progress=round(100 * (ps_i + 1) / npt_ps))
    sim.context.setParameter("kr", 0.0)
    log(f"NPT {npt_ps} ps done")

    # ---------------------------------------------------------------- production
    frame_steps = max(1, round(cfg["report_ps"] * steps_per_ps))
    total_steps = round(cfg["production_ns"] * 1000 * steps_per_ps)
    n_frames = total_steps // frame_steps
    sim.reporters.append(app.DCDReporter(str(work / "traj.dcd"), frame_steps))
    sim.reporters.append(app.StateDataReporter(
        str(work / "state.csv"), frame_steps, time=True, potentialEnergy=True, kineticEnergy=True, totalEnergy=True,
        temperature=True, volume=True, density=True, speed=True))
    sim.currentStep = 0
    sim.context.setTime(0)
    emit(stage="production", progress=0)
    done, t_prod = 0, time.time()
    while done < n_frames:
        sim.step(frame_steps)
        done += 1
        emit(stage="production", progress=round(100 * done / n_frames), frames=done)
        if time.time() > deadline:
            log(f"wall-time cap reached after {done}/{n_frames} frames")
            break
    wall = time.time() - t_prod
    ns_day = done * cfg["report_ps"] / 1000 / (wall / 86400) if wall else 0
    (work / "meta.json").write_text(json.dumps({
        "frames": done, "frames_requested": n_frames, "report_ps": cfg["report_ps"], "platform": plat.getName(),
        "atoms": top.getNumAtoms(), "ns_per_day": ns_day, "truncated": done < n_frames, "prod_wall_s": wall,
        "n_protein_atoms": n_prot, "box_nm": [round(v, 3) for v in top.getUnitCellDimensions().value_in_unit(nm)]}))
    log(f"production: {done} frames, {ns_day:.0f} ns/day")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
