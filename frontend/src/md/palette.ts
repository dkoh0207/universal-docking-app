// Chart colours (the components may only use theme tokens, so the data palette lives here).
export const C = { blue: "#2563eb", amber: "#f59e0b", violet: "#a855f7", teal: "#14b8a6", pink: "#ec4899", slate: "#64748b", light: "#e2e8f0", red: "#ef4444", sky: "#0ea5e9" };

export const INTERACTION_COLORS: Record<string, string> = {
  HBDonor: "#2563eb", HBAcceptor: "#0ea5e9", Hydrophobic: "#f59e0b", PiStacking: "#a855f7", CationPi: "#ec4899", PiCation: "#ec4899",
  Anionic: "#ef4444", Cationic: "#22c55e", XBAcceptor: "#14b8a6", XBDonor: "#14b8a6",
};
export const interactionColor = (t: string) => INTERACTION_COLORS[t] ?? "#64748b";
