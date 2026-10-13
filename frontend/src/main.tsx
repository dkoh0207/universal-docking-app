import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./components/app";
import { initialPage, setPage, viewerUi } from "./core";
import { loadId } from "./actions";
import { isPdbId } from "./rcsb";
import "./measure";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);

{ const p = initialPage(); if (p !== "viewer") setPage(p); }
const fromUrl = new URLSearchParams(location.search).get("pdb");
loadId(fromUrl && isPdbId(fromUrl) ? fromUrl : "1HSG");
void viewerUi;
