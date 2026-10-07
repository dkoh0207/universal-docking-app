// UI strings in English and Korean. Components call useT(); other code calls t().
// Switching language fires "langchange".

import { useSyncExternalStore } from "react";

export type Lang = "en" | "ko";

const STRINGS = {
  "brand.sub": ["RCSB structure viewer", "RCSB 구조 뷰어"],
  "fetch.placeholder": ["PDB ID, e.g. 4HHB", "PDB ID (예: 4HHB)"],
  "fetch.btn": ["Fetch", "불러오기"],
  examples: ["Examples", "예제"],
  upload: ["Upload", "업로드"],
  "upload.title": ["Open a local .pdb / .cif / .sdf / .mol2 file", "로컬 .pdb / .cif / .sdf / .mol2 파일 열기"],
  "theme.light": ["Light", "라이트"],
  "theme.dark": ["Dark", "다크"],

  target: ["Apply to", "적용 대상"],
  "card.rep": ["Representation", "표현 방식"],
  "rep.toggle": ["Toggle", "켜기/끄기"],
  "rep.as": ["Show only", "이것만 표시"],
  hideAll: ["Hide all", "모두 숨기기"],
  default: ["Default", "기본값"],
  "card.color": ["Color", "색상"],
  keepHetero: ["Keep heteroatom colors (N, O, S…)", "헤테로 원자 색 유지 (N, O, S…)"],
  "card.surface": ["Surface", "표면"],
  "surf.vdw": ["Van der Waals", "반데르발스"],
  "surf.sas": ["Solvent acc.", "용매 접근"],
  "surf.ses": ["Molecular", "분자 표면"],
  transparency: ["Transparency", "투명도"],
  ligandRegion: ["Distance to ligand center", "리간드 중심까지 거리"],
  "ligandRegion.all": ["Whole", "전체"],
  "ligandRegion.none": ["No ligand", "리간드 없음"],
  "ligandRegion.title": ["Only draw the surface for residues within this distance of a ligand's center", "리간드 중심에서 이 거리 이내의 잔기만 표면으로 표시"],
  "card.style": ["Style", "스타일"],
  cartoon: ["Cartoon", "카툰"],
  "cs.automatic": ["Automatic", "자동"],
  "cs.oval": ["Oval", "타원형"],
  "cs.rectangle": ["Rectangle", "사각형"],
  "cs.tube": ["Tube helices", "튜브형 나선"],
  "cs.trace": ["Trace", "트레이스"],
  "cs.parabola": ["Parabola", "포물선형"],
  "cs.edged": ["Edged", "모서리형"],
  cartoonTransparency: ["Cartoon transparency", "카툰 투명도"],
  stickRadius: ["Stick radius", "스틱 반지름"],
  sphereScale: ["Sphere scale", "구 크기"],
  "card.scene": ["Scene", "장면"],
  water: ["Water (ball & stick)", "물 분자 (볼 앤 스틱)"],
  fog: ["Depth cue (fog)", "깊이 효과 (안개)"],
  outline: ["Outline", "외곽선"],
  ortho: ["Orthographic", "직교 투영"],
  "card.presets": ["Presets", "프리셋"],
  "preset.simple": ["Simple", "기본"],
  "preset.ligand": ["Ligand sites", "리간드 부위"],
  "preset.surface": ["Pretty surface", "표면 강조"],
  "preset.publication": ["Publication", "논문용"],
  "preset.ballstick": ["Ball & stick", "볼 앤 스틱"],
  "preset.bfactor": ["B-factor", "B-인자"],
  "card.analysis": ["Analysis", "분석"],
  contacts: ["Polar contacts", "극성 상호작용"],
  contactsOff: ["Hide contacts", "상호작용 숨기기"],
  "contacts.title": ["Show / hide ligand–protein polar contacts", "리간드–단백질 극성 상호작용 표시 / 숨기기"],
  pocket: ["Ligand pocket", "리간드 포켓"],
  pocketOff: ["Hide pocket", "포켓 숨기기"],
  "pocket.title": ["Show / hide residues within 5 Å of the ligands", "리간드 5 Å 이내 잔기 표시 / 숨기기"],
  measureHint: ["Measure (click atoms in the viewer)", "측정 (뷰어에서 원자 클릭)"],
  distance: ["Distance", "거리"],
  angle: ["Angle", "각도"],
  dihedral: ["Dihedral", "이면각"],
  mouseSelects: ["Mouse selects", "마우스 선택 단위"],
  atoms: ["Atoms", "원자"],
  residues: ["Residues", "잔기"],
  chains: ["Chains", "사슬"],

  structure: ["Structure", "구조"],
  objects: ["Objects", "객체"],
  selections: ["Selections", "선택 영역"],
  measurements: ["Measurements", "측정"],

  "seq.empty": ["Sequence appears here", "서열이 여기에 표시됩니다"],
  drop: ["Drop a structure file to load it", "구조 파일을 놓아 불러오기"],
  "empty.title": ["Load a structure", "구조 불러오기"],
  "empty.text": ["Pick an example, fetch any PDB ID, or drop a file here.", "예제를 고르거나 PDB ID를 불러오거나 파일을 여기에 놓으세요."],
  "busy.surface": ["Computing surface…", "표면 계산 중…"],
  "busy.loading": ["Loading {id}…", "{id} 불러오는 중…"],

  "tb.reset": ["Reset view", "시점 초기화"],
  "tb.orient": ["Orient", "주축 정렬"],
  "tb.zoom": ["Zoom to target", "대상 확대"],
  "tb.center": ["Center on target", "대상 중앙 배치"],
  "tb.spin": ["Spin", "회전"],
  "tb.rock": ["Rock", "흔들기"],
  "tb.clip": ["Clipping", "클리핑"],
  "tb.frontClip": ["Front clip", "앞면 클리핑"],
  "tb.measure": ["Measure distance", "거리 측정"],
  "tb.png": ["Save PNG", "PNG 저장"],
  "tb.fullscreen": ["Fullscreen", "전체 화면"],

  "rep.cartoon": ["Cartoon", "카툰"],
  "rep.ribbon": ["Ribbon", "리본"],
  "rep.surface": ["Surface", "표면"],
  "rep.mesh": ["Mesh", "메시"],
  "rep.sticks": ["Sticks", "스틱"],
  "rep.lines": ["Lines", "선"],
  "rep.spheres": ["Spheres", "구"],
  "rep.ballstick": ["Ball & stick", "볼 앤 스틱"],
  "rep.nonbonded": ["Nonbonded", "비결합"],

  "scheme.chain": ["By chain", "사슬별"],
  "scheme.rainbow": ["Rainbow", "무지개"],
  "scheme.ss": ["Secondary", "2차 구조"],
  "scheme.element": ["Element", "원소"],
  "scheme.b": ["B-factor", "B-인자"],
  "scheme.hydro": ["Hydrophobic", "소수성"],
  "scheme.restype": ["Residue type", "잔기 유형"],
  "scheme.ocean": ["Ocean N→C", "오션 N→C"],

  "tg.all": ["Everything", "전체"],
  "tg.sele": ["Current selection (sele · {n})", "현재 선택 (sele · {n})"],
  "tg.polymer": ["Polymer", "고분자"],
  "tg.organic": ["Ligands (organic)", "리간드 (유기)"],
  "tg.inorganic": ["Ions (inorganic)", "이온 (무기)"],
  "tg.solvent": ["Water", "물"],
  "tg.object": ["Object {name}", "객체 {name}"],
  "tg.chain": ["Chain {c}", "사슬 {c}"],
  "tg.selection": ["Selection “{name}”", "선택 “{name}”"],

  "info.none": ["No structure loaded.", "불러온 구조가 없습니다."],
  "info.loading": ["Loading metadata from RCSB…", "RCSB에서 정보를 불러오는 중…"],
  "info.unavailable": ["Metadata unavailable", "정보를 불러올 수 없습니다"],
  "info.local": ["Local file", "로컬 파일"],
  "info.entry": ["RCSB PDB entry", "RCSB PDB 항목"],
  "info.uploaded": ["Uploaded", "업로드됨"],
  "info.open": ["Open on rcsb.org", "rcsb.org에서 열기"],
  "info.resolution": ["Resolution", "해상도"],
  "info.released": ["Released", "공개일"],
  "info.organism": ["Organism", "생물종"],
  "info.entity": ["Entity 1", "엔티티 1"],
  "info.atoms": ["Atoms", "원자 수"],
  "info.residues": ["Residues", "잔기 수"],
  "info.chains": ["Chains", "사슬"],
  "info.waters": ["Waters", "물 분자"],
  "info.ligands": ["Ligands", "리간드"],
  "info.ligTitle": ["Select and zoom (click again to clear)", "선택 후 확대 (다시 클릭하면 해제)"],

  "list.noObjects": ["Nothing loaded yet.", "아직 불러온 구조가 없습니다."],
  "list.noSelections": ["Click atoms or residues in the viewer or the sequence to build a selection.", "뷰어나 서열에서 원자 또는 잔기를 클릭해 선택하세요."],
  "list.noMeasurements": ["Use the ruler, or Polar contacts under Analysis.", "자 도구나 분석의 극성 상호작용을 사용하세요."],
  "list.atoms": ["{n} atoms", "원자 {n}개"],
  "list.contacts": ["{n} contacts", "상호작용 {n}개"],
  "list.pairs": ["{n} pairs", "{n}쌍"],
  "list.noPairs": ["no pairs", "없음"],
  "act.show": ["Show", "표시"],
  "act.hide": ["Hide", "숨기기"],
  "act.zoom": ["Zoom", "확대"],
  "act.delete": ["Delete", "삭제"],
  "act.showSticks": ["Show sticks", "스틱 표시"],
  "act.hideSticks": ["Hide sticks", "스틱 숨기기"],
  "act.indicate": ["Highlight", "강조 표시"],

  loaded: ["Loaded {id}", "{id} 불러옴"],
  badId: ["PDB IDs are 4 characters, e.g. 1HSG", "PDB ID는 4자입니다 (예: 1HSG)"],
  unsupported: ["Unsupported file type .{ext}", "지원하지 않는 파일 형식: .{ext}"],
  readFail: ["Could not read {name}: {err}", "{name} 파일을 읽을 수 없습니다: {err}"],
  badge: ["Measure {mode}: pick atom {i} of {n}", "{mode} 측정: 원자 {i}/{n} 선택"],
  done: ["Done", "완료"],
  chain: ["chain", "사슬"],

  "tab.viewer": ["Viewer", "뷰어"],
  "tab.dock": ["Docking", "도킹"],

  "dock.backend": ["Backend", "백엔드"],
  "dock.recheck": ["Check again", "다시 확인"],
  "dock.status.checking": ["Checking the backend…", "백엔드 확인 중…"],
  "dock.status.ok": ["Ready · {engine} {ver} · Open Babel {obabel}", "준비됨 · {engine} {ver} · Open Babel {obabel}"],
  "dock.status.offline": ["Backend offline - run `npm run dev`", "백엔드에 연결할 수 없습니다 - `npm run dev`를 실행하세요"],
  "dock.status.missing": ["Missing: {tools} - run `{cmd}`", "설치되지 않음: {tools} - `{cmd}`을 실행하세요"],
  "dock.status.notInstalled": ["not installed", "설치되지 않음"],
  "dock.engine": ["Engine", "엔진"],
  "dock.cnnScoring": ["CNN scoring", "CNN 스코어링"],
  "dock.poseSort": ["Sort poses by", "포즈 정렬 기준"],
  "dock.noGpu": ["CPU only (no GPU)", "CPU만 사용 (GPU 안 씀)"],
  "dock.col.cnn": ["CNN score", "CNN 점수"],
  "dock.col.cnnAff": ["CNN aff.", "CNN 친화도"],
  "dock.receptor": ["Receptor", "수용체"],
  "dock.noReceptor": ["No protein loaded in the Viewer", "뷰어에 불러온 단백질이 없습니다"],
  "dock.noWater": ["Remove water", "물 분자 제거"],
  "dock.keepHet": ["Keep metals & cofactors", "금속 이온 및 보조인자 유지"],
  "dock.recInfo": ["{n} atoms · chains {chains}", "원자 {n}개 · 사슬 {chains}"],
  "dock.ligand": ["Ligand", "리간드"],
  "dock.src.structure": ["Structure", "구조에서"],
  "dock.src.upload": ["Upload", "업로드"],
  "dock.src.smiles": ["SMILES", "SMILES"],
  "dock.structureHint": ["Pick a ligand of the receptor structure to re-dock it into its own pocket.", "수용체 구조의 리간드를 골라 같은 포켓에 다시 도킹해 보세요."],
  "dock.noLigands": ["This structure has no ligands", "이 구조에는 리간드가 없습니다"],
  "dock.heavy": ["{n} heavy atoms", "비수소 원자 {n}개"],
  "dock.chooseFile": ["Choose .sdf / .mol2 / .pdb", ".sdf / .mol2 / .pdb 파일 선택"],
  "dock.smilesPlaceholder": ["e.g. CC(=O)Oc1ccccc1C(=O)O", "예: CC(=O)Oc1ccccc1C(=O)O"],
  "dock.smilesHint": ["A 3D structure is generated for you.", "3D 구조는 자동으로 생성됩니다."],
  "dock.box": ["Search box", "탐색 상자"],
  "dock.centerLig": ["Center on ligand", "리간드 중심으로"],
  "dock.centerSel": ["Viewer selection", "뷰어 선택 영역"],
  "dock.center": ["Center", "중심"],
  "dock.size": ["Size (Å)", "크기 (Å)"],
  "dock.padding": ["Padding added to size", "크기에 더할 여유"],
  "dock.needLigand": ["Pick a ligand from the structure first", "먼저 구조에서 리간드를 고르세요"],
  "dock.needSele": ["Select atoms in the Viewer first", "먼저 뷰어에서 원자를 선택하세요"],
  "dock.params": ["Parameters", "매개변수"],
  "dock.exh": ["Exhaustiveness", "탐색 강도"],
  "dock.modes": ["Poses", "포즈 수"],
  "dock.erange": ["Energy range", "에너지 범위"],
  "dock.scoring": ["Scoring", "스코어링"],
  "dock.seed": ["Seed", "시드"],
  "dock.random": ["random", "무작위"],
  "dock.cpu": ["CPU threads", "CPU 스레드"],
  "dock.all": ["all", "전체"],
  "dock.run": ["Run docking", "도킹 실행"],
  "dock.cancel": ["Cancel", "취소"],
  "dock.why.backend": ["The backend is not ready", "백엔드가 준비되지 않았습니다"],
  "dock.why.receptor": ["Load a protein in the Viewer first", "먼저 뷰어에 단백질을 불러오세요"],
  "dock.why.ligand": ["Choose a ligand", "리간드를 선택하세요"],
  "dock.why.box": ["Set the search box center and size", "탐색 상자의 중심과 크기를 입력하세요"],
  "dock.stage.submit": ["Starting…", "시작하는 중…"],
  "dock.stage.prep_receptor": ["Preparing the receptor…", "수용체 준비 중…"],
  "dock.stage.prep_ligand": ["Preparing the ligand…", "리간드 준비 중…"],
  "dock.stage.docking": ["Docking…", "도킹 중…"],
  "dock.stage.done": ["Finished", "완료"],
  "dock.stage.cancelled": ["Cancelled", "취소됨"],
  "dock.lost": ["Lost the connection to the backend", "백엔드와의 연결이 끊어졌습니다"],
  "dock.log": ["Log", "로그"],
  "dock.results": ["Results", "결과"],
  "dock.col.aff": ["kcal/mol", "kcal/mol"],
  "dock.col.lb": ["RMSD l.b.", "RMSD 하한"],
  "dock.col.ub": ["u.b.", "상한"],
  "dock.col.ref": ["vs crystal", "결정 구조 대비"],
  "dock.col.refTitle": ["Heavy-atom RMSD to the ligand in the structure; each atom is paired with the nearest atom of the same element (Å)", "구조 속 리간드와의 비수소 원자 RMSD, 같은 원소의 가장 가까운 원자끼리 대응 (Å)"],
  "dock.showAll": ["Show all poses", "모든 포즈 표시"],
  "dock.send": ["Send to Viewer", "뷰어로 보내기"],
  "dock.sent": ["Sent to the Viewer", "뷰어로 보냈습니다"],
  "dock.download": ["Download out.pdbqt", "out.pdbqt 다운로드"],
  "dock.done": ["Docking finished: best {aff} kcal/mol", "도킹 완료: 최고 {aff} kcal/mol"],
  "dock.empty.title": ["Set up a docking run", "도킹 설정"],
  "dock.empty.text": ["Load a structure in the Viewer, then pick it as the receptor.", "뷰어에서 구조를 불러온 뒤 수용체로 선택하세요."],
  "dock.tb.zoom": ["Zoom to ligand / pose", "리간드 / 포즈 확대"],
  "dock.tb.box": ["Show / hide the search box", "탐색 상자 표시 / 숨기기"],
  "dock.leg.receptor": ["Receptor", "수용체"],
  "dock.leg.ref": ["Crystal ligand", "결정 구조 리간드"],
  "dock.leg.pose": ["Pose {n}", "포즈 {n}"],
} satisfies Record<string, [string, string]>;

export type Key = keyof typeof STRINGS;

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem("pymol-web-lang");
    if (saved === "en" || saved === "ko") return saved;
  } catch { /* storage unavailable */ }
  return navigator.language?.toLowerCase().startsWith("ko") ? "ko" : "en";
}

export let lang: Lang = initialLang();
document.documentElement.lang = lang;

export function t(key: Key, vars: Record<string, string | number> = {}) {
  const s = STRINGS[key][lang === "ko" ? 1 : 0];
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

export function setLang(l: Lang) {
  lang = l;
  try { localStorage.setItem("pymol-web-lang", l); } catch { /* storage unavailable */ }
  document.documentElement.lang = l;
  window.dispatchEvent(new Event("langchange"));
}

/** Subscribe a component to language changes; returns t. */
export function useT() {
  useSyncExternalStore(
    (cb) => { window.addEventListener("langchange", cb); return () => window.removeEventListener("langchange", cb); },
    () => lang,
  );
  return t;
}

/** Command errors are English; translate the ones UI actions can produce. */
export function translateError(msg: string) {
  if (lang === "en") return msg;
  const rules: [RegExp, (m: RegExpMatchArray) => string][] = [
    [/^No organic ligands in this structure/, () => "이 구조에는 유기 리간드가 없습니다"],
    [/^No ligand \(organic\) atoms/, () => "이 구조에는 리간드(유기) 원자가 없습니다"],
    [/^No protein \/ nucleic atoms/, () => "단백질 / 핵산 원자가 없습니다"],
    [/^Selection "(.*)" matches no atoms/, (m) => `선택 "${m[1]}"에 해당하는 원자가 없습니다`],
    [/^RCSB returned 404 for (\w+)/, (m) => `RCSB에서 ${m[1]} 항목을 찾을 수 없습니다`],
    [/^RCSB returned (\d+) for (\w+)/, (m) => `RCSB 오류 (${m[1]}): ${m[2]}`],
    [/^Failed to fetch/, () => "네트워크 오류: RCSB에 연결할 수 없습니다"],
  ];
  for (const [re, fn] of rules) { const m = msg.match(re); if (m) return fn(m); }
  return msg;
}
