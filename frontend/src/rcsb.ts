// RCSB PDB access: coordinate files and entry metadata.

export interface ExampleEntry { id: string; name: string; desc: string; tag: string; name_ko?: string; desc_ko?: string; tag_ko?: string }

export interface EntryInfo {
  id: string;
  title?: string;
  method?: string;
  resolution?: number;
  released?: string;
  organism?: string;
  description?: string;
  doi?: string;
}

export const isPdbId = (s: string) => /^[0-9][A-Za-z0-9]{3}$/.test(s.trim());

export async function loadExamples(): Promise<ExampleEntry[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}structures/manifest.json`);
  return res.json();
}

/** Bundled examples first, then RCSB (mmCIF works for every entry, including large ones). */
export async function fetchStructure(id: string): Promise<{ data: string; format: string; source: string }> {
  const up = id.toUpperCase();
  try {
    const local = await fetch(`${import.meta.env.BASE_URL}structures/${up}.pdb`);
    const ct = local.headers.get("content-type") ?? "";
    if (local.ok && !ct.includes("text/html")) return { data: await local.text(), format: "pdb", source: "bundled" };
  } catch { /* fall through to RCSB */ }
  const res = await fetch(`https://files.rcsb.org/download/${up}.cif`);
  if (!res.ok) throw new Error(`RCSB returned ${res.status} for ${up}`);
  return { data: await res.text(), format: "cif", source: "files.rcsb.org" };
}

export async function fetchEntryInfo(id: string): Promise<EntryInfo> {
  const up = id.toUpperCase();
  const [entry, entity] = await Promise.all([
    fetch(`https://data.rcsb.org/rest/v1/core/entry/${up}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(`https://data.rcsb.org/rest/v1/core/polymer_entity/${up}/1`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  if (!entry) throw new Error("metadata unavailable");
  return {
    id: up,
    title: entry.struct?.title,
    method: entry.exptl?.[0]?.method,
    resolution: entry.rcsb_entry_info?.resolution_combined?.[0],
    released: entry.rcsb_accession_info?.initial_release_date?.slice(0, 10),
    doi: entry.rcsb_primary_citation?.pdbx_database_id_doi,
    organism: entity?.rcsb_entity_source_organism?.[0]?.scientific_name,
    description: entity?.rcsb_polymer_entity?.pdbx_description,
  };
}
