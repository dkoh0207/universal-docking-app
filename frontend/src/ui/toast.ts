import { icon, refreshIcons } from "./icons";

export function toast(message: string, kind: "ok" | "err" = "ok") {
  const host = document.getElementById("toasts")!;
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(kind === "err" ? "circle-alert" : "circle-check")}<span></span>`;
  el.querySelector("span")!.textContent = message;
  host.appendChild(el);
  refreshIcons(el);
  setTimeout(() => el.remove(), kind === "err" ? 5000 : 2600);
}
