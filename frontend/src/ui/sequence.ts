import { ONE } from "../commands";
import { t } from "../i18n";
import type { PAtom } from "../types";
import type { Scene } from "../viewer";
import { esc } from "./icons";

/** Clickable one-letter sequence strip, grouped by object and chain. */
export class SequenceView {
  private el = document.getElementById("seqbar")!;
  private byRid = new Map<number, PAtom[]>();
  private lastRid: number | null = null;

  constructor(private scene: Scene) {
    scene.addEventListener("objects", () => this.render());
    scene.addEventListener("selections", () => this.highlight());
    window.addEventListener("langchange", () => this.render());
    this.el.addEventListener("click", (e) => this.onClick(e as MouseEvent));
    this.el.addEventListener("dblclick", (e) => {
      const rid = this.ridOf(e.target);
      if (rid !== null) this.scene.zoom(this.scene.mask((a) => a.rid === rid));
    });
  }

  private ridOf(t: EventTarget | null) {
    const res = (t as HTMLElement | null)?.closest?.(".res") as HTMLElement | null;
    return res ? +res.dataset.rid! : null;
  }

  render() {
    this.byRid.clear();
    for (const a of this.scene.atoms) (this.byRid.get(a.rid) ?? this.byRid.set(a.rid, []).get(a.rid)!).push(a);
    const multi = this.scene.objects.length > 1;
    let html = "";
    for (const obj of this.scene.objects) {
      if (!obj.enabled) continue;
      const chains = new Map<string, PAtom[][]>();
      const seen = new Set<number>();
      for (const a of obj.atoms) {
        if (seen.has(a.rid) || a.cls === "solvent" || a.cls === "inorganic") continue;
        seen.add(a.rid);
        (chains.get(a.chain) ?? chains.set(a.chain, []).get(a.chain)!).push(this.byRid.get(a.rid)!);
      }
      for (const [chain, residues] of chains) {
        html += `<span class="seq-chain"><span class="chain-tag" data-obj="${esc(obj.name)}" data-chain="${esc(chain)}">${multi ? esc(obj.name) + " · " : ""}${esc(chain) || "–"}</span>`;
        residues.forEach((atoms, i) => {
          const a = atoms[0];
          const het = a.cls === "organic";
          const letter = het ? a.resn : ONE[a.resn.toUpperCase()] ?? "X";
          const num = a.resi % 10 === 0 || i === 0 ? String(a.resi) : "";
          html += `<span class="res${het ? " het" : ""}" data-rid="${a.rid}" title="${a.resn} ${a.resi}${a.icode ?? ""} · ${t("chain")} ${chain}"${het ? ` style="width:auto;margin:0 3px"` : ""}><i>${num}</i><b>${letter}</b></span>`;
        });
        html += `</span>`;
      }
    }
    this.el.innerHTML = html || `<div class="seq-empty">${esc(t("seq.empty"))}</div>`;
    this.highlight();
  }

  highlight() {
    const sele = this.scene.selections.get("sele");
    const rids = new Set<number>();
    if (sele) for (const a of sele) rids.add(a.rid);
    this.el.querySelectorAll<HTMLElement>(".res").forEach((r) => r.classList.toggle("sel", rids.has(+r.dataset.rid!)));
  }

  private onClick(e: MouseEvent) {
    const tag = (e.target as HTMLElement).closest(".chain-tag") as HTMLElement | null;
    if (tag) {
      const atoms = this.scene.atoms.filter((a) => a.obj.name === tag.dataset.obj && a.chain === tag.dataset.chain);
      this.scene.toggleInSele(atoms);
      return;
    }
    const rid = this.ridOf(e.target);
    if (rid === null) return;
    let atoms = this.byRid.get(rid) ?? [];
    if (e.shiftKey && this.lastRid !== null) {
      const [lo, hi] = [Math.min(this.lastRid, rid), Math.max(this.lastRid, rid)];
      const first = atoms[0];
      atoms = this.scene.atoms.filter((a) => a.rid >= lo && a.rid <= hi && a.obj === first.obj && a.chain === first.chain && a.cls !== "solvent");
      this.scene.toggleInSele(atoms, true);
    } else {
      this.scene.toggleInSele(atoms);
    }
    this.lastRid = rid;
  }
}
