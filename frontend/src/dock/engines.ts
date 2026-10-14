// Docking engines as the UI sees them. Keep in sync with backend/app/engines.py (the backend validates).

export type EngineId = "vina" | "smina" | "gnina";
export const CNN_SCORING = ["none", "rescore", "refinement", "metrorescore", "metrorefine", "all"] as const;
export const POSE_SORT = ["CNNscore", "CNNaffinity", "Energy"] as const;

export interface EngineInfo {
  id: EngineId;
  label: string;
  scoring: readonly string[]; // first entry is the default
  cnn: boolean; // GNINA: CNN scoring options and CNN columns
  setup: string; // command that installs it
}

export const ENGINES: Record<EngineId, EngineInfo> = {
  vina: { id: "vina", label: "AutoDock Vina", scoring: ["vina", "vinardo"], cnn: false, setup: "npm run setup" },
  smina: { id: "smina", label: "smina", scoring: ["vinardo", "vina", "ad4_scoring", "dkoes_fast", "dkoes_scoring", "dkoes_scoring_old"], cnn: false, setup: "npm run setup" },
  gnina: { id: "gnina", label: "GNINA", scoring: ["default", "vinardo", "vina", "ad4_scoring", "dkoes_fast", "dkoes_scoring"], cnn: true, setup: "npm run setup -- --gnina" },
};
export const ENGINE_IDS = Object.keys(ENGINES) as EngineId[];

export interface Mode { mode: number; affinity: number; rmsd_lb: number; rmsd_ub: number; cnn_score?: number; cnn_affinity?: number; aev_plig?: number } // aev_plig: pKd from the AEV-PLIG rescoring
