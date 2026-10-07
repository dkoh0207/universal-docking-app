import type { GLModel } from "3dmol";

export type AtomClass = "protein" | "nucleic" | "solvent" | "organic" | "inorganic";

/** A 3Dmol atom extended with the PyMOL-style state we track per atom. */
export interface PAtom {
  index: number;
  serial: number;
  elem: string;
  atom: string;
  resn: string;
  resi: number;
  icode?: string;
  chain: string;
  hetflag: boolean;
  b: number;
  x: number;
  y: number;
  z: number;
  ss?: string;
  bonds: number[];
  color: number;
  // our state
  obj: PObject;
  reps: number;
  cls: AtomClass;
  gid: number;
  rid: number;
  styleKey: number;
}

export interface PObject {
  name: string;
  model: GLModel;
  atoms: PAtom[];
  enabled: boolean;
  pdbId?: string;
  paletteOffset: number;
}

/** Representation bit flags (one per PyMOL representation). */
export const REP = {
  cartoon: 1,
  sticks: 2,
  lines: 4,
  spheres: 8,
  surface: 16,
  mesh: 32,
  ribbon: 64,
  nonbonded: 128,
  ballstick: 256,
} as const;
export type RepName = keyof typeof REP;
export const ALL_REPS = Object.values(REP).reduce((a, b) => a | b, 0);
export const SURFACE_BITS = REP.surface | REP.mesh;
export const INDICATE_BIT = 1 << 12;

export const REP_ALIASES: Record<string, RepName | "everything" | "labels"> = {
  cartoon: "cartoon", cartoons: "cartoon", car: "cartoon",
  sticks: "sticks", stick: "sticks", lic: "sticks",
  lines: "lines", line: "lines",
  spheres: "spheres", sphere: "spheres", sph: "spheres", nb_spheres: "spheres",
  surface: "surface", surf: "surface", surfaces: "surface",
  mesh: "mesh", dots: "mesh",
  ribbon: "ribbon", ribbons: "ribbon", trace: "ribbon", rib: "ribbon",
  nonbonded: "nonbonded", nb: "nonbonded", cross: "nonbonded",
  ballstick: "ballstick", ball_and_stick: "ballstick", balls: "ballstick", ballandstick: "ballstick",
  everything: "everything", all: "everything", "": "everything",
  labels: "labels", label: "labels",
};

export interface Settings {
  stick_radius: number;
  sphere_scale: number;
  cartoon_style: "automatic" | "oval" | "rectangle" | "trace" | "parabola" | "edged" | "tube";
  cartoon_transparency: number;
  stick_transparency: number;
  sphere_transparency: number;
  transparency: number; // surface transparency (PyMOL name)
  surface_type: "VDW" | "SAS" | "SES";
  surface_color: number | null; // null = follow atom colors
  surface_ligand_cutoff: number; // 0 = whole surface, else only residues within this many Å of a ligand center
  label_size: number;
  label_color: number;
  bg_color: number | null; // null = follow UI theme
  fog: boolean;
  outline: boolean;
  orthoscopic: boolean;
  mouse_selection_mode: "atoms" | "residues" | "chains";
}

export const DEFAULT_SETTINGS: Settings = {
  stick_radius: 0.22,
  sphere_scale: 1,
  cartoon_style: "automatic",
  cartoon_transparency: 0,
  stick_transparency: 0,
  sphere_transparency: 0,
  transparency: 0,
  surface_type: "SES",
  surface_color: null,
  surface_ligand_cutoff: 0,
  label_size: 12,
  label_color: 0xffffff,
  bg_color: null,
  fog: true,
  outline: false,
  orthoscopic: false,
  mouse_selection_mode: "residues",
};

export type MeasureKind = "distance" | "angle" | "dihedral" | "contacts";
export interface Measurement {
  name: string;
  kind: MeasureKind;
  groups: PAtom[][]; // each group is 2/3/4 atoms
  visible: boolean;
  shapes: unknown[];
  labels: unknown[];
  summary: string;
}
