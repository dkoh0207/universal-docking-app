import {
  Activity, Asterisk, Atom, Axis3d, Boxes, Camera, ChevronDown, Circle, CircleAlert, CircleCheck, Cloud, Contrast,
  Crosshair, ExternalLink, Eye, EyeOff, FlaskConical, Focus, Grid3x3, Image, Layers, Maximize,
  Microscope, MousePointerClick, Move3d, Moon, Network, Orbit, Palette, RotateCcw, Ruler, Scan,
  Scissors, Search, SlidersHorizontal, Spline, Sun, Tag, Target, Trash2, Triangle, Upload, WandSparkles,
  Waves, X, Info, Languages, Anchor, Box, Dna, Download, Pill, Play, RefreshCw, Send, Server, Settings2, Square, Terminal, Trophy,
  createIcons,
} from "lucide";

const ICONS = {
  Activity, Asterisk, Atom, Axis3d, Boxes, Camera, ChevronDown, Circle, CircleAlert, CircleCheck, Cloud, Contrast,
  Crosshair, ExternalLink, Eye, EyeOff, FlaskConical, Focus, Grid3x3, Image, Layers, Maximize,
  Microscope, MousePointerClick, Move3d, Moon, Network, Orbit, Palette, RotateCcw, Ruler, Scan,
  Scissors, Search, SlidersHorizontal, Spline, Sun, Tag, Target, Trash2, Triangle, Upload, WandSparkles,
  Waves, X, Info, Languages, Anchor, Box, Dna, Download, Pill, Play, RefreshCw, Send, Server, Settings2, Square, Terminal, Trophy,
};

/** Placeholder element that refreshIcons() turns into an SVG. */
export const icon = (name: string, cls = "") => `<i data-lucide="${name}"${cls ? ` class="${cls}"` : ""}></i>`;

export function refreshIcons(root: Element | Document = document) {
  createIcons({ icons: ICONS, root: root as HTMLElement });
}

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
