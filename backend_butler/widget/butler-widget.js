// Butler — home screen widget for Scriptable (https://scriptable.app).
// icon-color: deep-gray; icon-glyph: comment-dots;
//
// Install: in Scriptable tap +, paste this whole file, name the script "Butler". Then long-press the home screen,
// +, Scriptable, Medium, add it; long-press the widget, Edit Widget, Script: Butler. Small also works (one button).
//
// Taps open the Home Assistant app on the Backend Butler panel:
//   Ask Butler   message box            camera / photo   one tap to open the camera or library
//   mic          dictate here, then review the words in Butler before sending
//   waveform     dictate here, then tap Send in Butler (a link never sends by itself, so nobody else's link can)
// Dictation runs in this script (iPhone dictation), so it works at home over plain http as well.

// Butler's panel path. An install from https://github.com/backend-butler/ha-addon is always this one. Otherwise
// open Butler in a browser and copy what follows the host in the address bar (a local copy: "local_backend_butler").
const PANEL = "e0a0a4ab_backend_butler";
const LINK = `homeassistant://navigate/${PANEL}`;

const butler = (kind, text) =>
  `${LINK}?butler=${kind}${text ? `&text=${encodeURIComponent(text)}` : ""}`;
const thisScript = (action) =>
  `scriptable:///run/${encodeURIComponent(Script.name())}?action=${action}`;

// Colours follow the phone's light/dark appearance, like the ChatGPT widget.
const C = {
  bg: Color.dynamic(new Color("#ffffff"), new Color("#000000")),
  well: Color.dynamic(new Color("#efeff1"), new Color("#232325")),
  icon: Color.dynamic(new Color("#0d0d0d"), new Color("#f5f5f5")),
  hint: Color.dynamic(new Color("#808085"), new Color("#9a9a9f")),
};
const TIE = new Color("#FC6B02"); // Butler's bow tie: never recoloured

// Butler's mark (web/Logo.tsx), drawn here because widgets cannot show SVG. Jacket and studs take the text colour;
// the bow tie stays orange.
const VIEWBOX = { x: 160, y: 162, size: 704 };
const JACKET = [
  "M749.942 220.58C814.037 285.517 847.277 360.473 851.65 451.672C852.85 524.818 836.905 584.683 798.107 646.903C816.745 698.038 833.92 751.768 852.025 803.36C832.712 798.988 810.362 795.163 790.682 791.323L665.695 766.828C618.287 788.975 576.242 801.478 523.285 802.985C431.761 806.18 342.835 772.213 276.748 708.808C212.578 647.36 175.077 563.188 172.307 474.386C169.745 398.835 192.519 324.596 237.006 263.479C249.022 247.018 259.48 235.645 273.417 220.948C275.84 223.88 287.478 251.398 290.068 257.307L327.609 342.739L511.99 761.698C522.782 738.763 533.552 712.828 543.812 689.45L602.95 555.05L749.942 220.58Z",
  "M506.905 434.37C518.26 431.575 529.727 438.541 532.48 449.908C535.232 461.274 528.22 472.712 516.842 475.418C505.525 478.11 494.162 471.146 491.429 459.841C488.694 448.537 495.617 437.15 506.905 434.37Z",
  "M508.16 521.797C519.575 519.712 530.54 527.219 532.708 538.627C534.883 550.027 527.443 561.044 516.058 563.294C504.56 565.574 493.403 558.044 491.209 546.524C489.016 535.004 496.625 523.905 508.16 521.797Z",
  "M510.202 609.23C521.82 608.255 532.027 616.872 533.032 628.482C534.03 640.092 525.442 650.322 513.832 651.35C502.185 652.377 491.916 643.76 490.912 632.112C489.908 620.465 498.555 610.212 510.202 609.23Z",
];
const TIE_PATH =
  "M408.633 220.664C428.508 230.775 451.307 246.223 471.295 256.877C480.312 261.412 489.669 269.054 499.455 271.644C522.885 277.845 539.438 264.565 558.323 253.605L615.293 220.648C615.3 234.676 616.403 354.8 614.7 357.238L612.885 356.602C580.988 340.038 548.385 316.924 515.58 301.693C513.09 300.538 505.845 302.407 503.43 303.694C471.585 320.639 440.174 340.756 408.582 357.973L408.633 220.664Z";

/** Absolute M/L/C/Z paths only: all the logo uses. */
function toPath(d, scale) {
  const path = new Path();
  const n = d.match(/-?\d*\.?\d+/g).map(Number);
  const pt = (i) => new Point((n[i] - VIEWBOX.x) * scale, (n[i + 1] - VIEWBOX.y) * scale);
  let i = 0;
  for (const cmd of d.match(/[MLCZ]/g)) {
    if (cmd === "M") (path.move(pt(i)), (i += 2));
    else if (cmd === "L") (path.addLine(pt(i)), (i += 2));
    else if (cmd === "C") (path.addCurve(pt(i + 4), pt(i), pt(i + 2)), (i += 6));
    else path.closeSubpath();
  }
  return path;
}

function drawMark(paths, color, size) {
  const ctx = new DrawContext();
  ctx.size = new Size(size, size);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  for (const d of paths) ctx.addPath(toPath(d, size / VIEWBOX.size));
  ctx.setFillColor(color);
  ctx.fillPath();
  return ctx.getImage();
}

/** The mark at `size` pt: the tie as the stack's background, the jacket on top, tinted to follow light/dark. */
function addLogo(parent, size) {
  const holder = parent.addStack();
  holder.size = new Size(size, size);
  holder.backgroundImage = drawMark([TIE_PATH], TIE, size);
  const jacket = holder.addImage(drawMark(JACKET, Color.black(), size));
  jacket.imageSize = new Size(size, size);
  jacket.tintColor = C.icon;
}

function addSymbol(parent, name, pt) {
  const sym = SFSymbol.named(name);
  sym.applyFont(Font.systemFont(pt));
  const img = parent.addImage(sym.image);
  img.imageSize = new Size(pt * 1.25, pt * 1.25);
  img.tintColor = C.icon;
}

function addPill(parent, height) {
  const pill = parent.addStack();
  pill.size = new Size(0, height); // 0 = as wide as the widget allows
  pill.cornerRadius = height / 2;
  pill.backgroundColor = C.well;
  pill.layoutHorizontally();
  pill.centerAlignContent();
  pill.setPadding(0, 16, 0, 16);
  pill.url = butler("field");
  addLogo(pill, 22);
  pill.addSpacer(10);
  const t = pill.addText("Ask Butler");
  t.font = Font.mediumSystemFont(17);
  t.textColor = C.hint;
  t.lineLimit = 1;
  pill.addSpacer();
}

function addCircle(parent, symbol, url, size) {
  const c = parent.addStack();
  c.size = new Size(size, size);
  c.cornerRadius = size / 2;
  c.backgroundColor = C.well;
  c.centerAlignContent();
  c.url = url;
  addSymbol(c, symbol, 19);
}

function mediumWidget() {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(14, 14, 14, 14);
  w.url = butler("field"); // taps between the buttons
  addPill(w, 56);
  w.addSpacer();
  const row = w.addStack();
  row.layoutHorizontally();
  const buttons = [
    ["camera", butler("camera")],
    ["photo.on.rectangle", butler("photo")],
    ["mic", thisScript("draft")],
    ["waveform", thisScript("say")],
  ];
  buttons.forEach(([symbol, url], i) => {
    if (i) row.addSpacer();
    addCircle(row, symbol, url, 58);
  });
  return w;
}

/** Small widgets and the lock screen allow one tap target: open Butler on the message box. */
function smallWidget() {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(16, 16, 16, 16);
  w.url = butler("field");
  addLogo(w, 34);
  w.addSpacer();
  const t = w.addText("Ask Butler");
  t.font = Font.semiboldSystemFont(17);
  t.textColor = C.icon;
  return w;
}

function lockScreenWidget() {
  const w = new ListWidget();
  w.url = butler("field");
  w.addAccessoryWidgetBackground = true;
  const img = w.addImage(drawMark(JACKET.concat([TIE_PATH]), Color.white(), 30));
  img.imageSize = new Size(30, 30);
  img.centerAlignImage();
  return w;
}

/** mic/waveform taps run the script with ?action=draft|say: dictate, then hand the words to Butler. */
async function dictateThenOpen(kind) {
  let text = "";
  try {
    text = (await Dictation.start()).trim();
  } catch (e) {
    return; // cancelled
  }
  if (text) Safari.open(butler(kind, text));
}

const action = args.queryParameters && args.queryParameters.action;
if (action === "say" || action === "draft") {
  await dictateThenOpen(action);
} else if (config.runsInWidget) {
  const family = config.widgetFamily || "medium";
  Script.setWidget(
    family.startsWith("accessory") ? lockScreenWidget() : family === "small" ? smallWidget() : mediumWidget(),
  );
} else {
  await mediumWidget().presentMedium(); // run in the app: preview
}
Script.complete();
