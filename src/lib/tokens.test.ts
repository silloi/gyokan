/**
 * 色のトークン（tokens.css）が、デジタル庁デザインシステムのカラートークンから選ばれていて、
 * コントラスト比と色覚の多様性への配慮の基準を満たしていることを確かめる。
 *
 * - コントラスト比: WCAG 2.x の計算。文字は 4.5:1 以上、線などの文字でないものは 3:1 以上
 * - 色覚シミュレーション: Machado, Oliveira & Fernandes (2009) の行列（強度 1.0 = 2色覚）を線形 RGB にかける
 * - 色差: CIEDE2000
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, test } from "vite-plus/test";

type RGB = [number, number, number];

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const tokensCss = read("./tokens.css");
const frameCss = read("./frame.css");
const appCss = read("../style.css");
/** デジタル庁デザインシステムのカラートークン（devDependencies の @digital-go-jp/design-tokens） */
const dadsCss = readFileSync(
  createRequire(import.meta.url).resolve("@digital-go-jp/design-tokens/dist/tokens.css"),
  "utf8",
);

const dads = new Map(
  [...dadsCss.matchAll(/--color-(?:primitive|neutral)-([a-z0-9-]+):\s*(#[0-9a-f]{6})/g)].map(
    (m) => [m[1]!, m[2]!],
  ),
);
const vars = new Map(
  [...tokensCss.matchAll(/(--gk-[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]),
);

/** トークンを、デザインシステムの色（--gk-dads-*）までたどる */
function dadsNameOf(token: string): string {
  const value = vars.get(token);
  if (value === undefined) throw new Error(`${token} がない`);
  if (token.startsWith("--gk-dads-")) return token;
  const ref = /^var\((--gk-[a-z0-9-]+)\)$/.exec(value);
  if (!ref) throw new Error(`${token}: ${value}（デザインシステムの色を参照していない）`);
  return dadsNameOf(ref[1]!);
}
const hexOf = (token: string) => vars.get(dadsNameOf(token))!;

const rgb = (hex: string): RGB =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as RGB;
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const unlin = (c: number) => {
  const v = Math.min(1, Math.max(0, c));
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
};
const luminance = ([r, g, b]: RGB) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(rgb(hexOf(a))), luminance(rgb(hexOf(b)))].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const VISIONS = {
  C: null,
  P: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  D: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  T: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
} as const;
type Vision = keyof typeof VISIONS;

function simulate(c: RGB, vision: Vision): RGB {
  const m = VISIONS[vision];
  if (!m) return c;
  const v = c.map(lin);
  return m.map((row) => unlin(row[0] * v[0]! + row[1] * v[1]! + row[2] * v[2]!)) as RGB;
}

function lab(c: RGB): RGB {
  const [r, g, b] = c.map(lin) as RGB;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function deltaE2000([L1, a1, b1]: RGB, [L2, a2, b2]: RGB): number {
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cb7 = ((C1 + C2) / 2) ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h1p = (Math.atan2(b1, a1p) / rad + 360) % 360;
  const h2p = (Math.atan2(b2, a2p) / rad + 360) % 360;
  let dhp = h2p - h1p;
  if (C1p * C2p === 0) dhp = 0;
  else if (dhp > 180) dhp -= 360;
  else if (dhp < -180) dhp += 360;
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hbp /= 2;
    else hbp = hbp < 360 ? (hbp + 360) / 2 : (hbp - 360) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hbp - 30) * rad) +
    0.24 * Math.cos(2 * hbp * rad) +
    0.32 * Math.cos((3 * hbp + 6) * rad) -
    0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt(
    (dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh),
  );
}

/** 2つのトークンの色差（その色覚で見たとき） */
const diff = (a: string, b: string, vision: Vision) =>
  deltaE2000(lab(simulate(rgb(hexOf(a)), vision)), lab(simulate(rgb(hexOf(b)), vision)));
const ALL: Vision[] = ["C", "P", "D", "T"];
const LEVELS = [1, 2, 3, 4] as const;

describe("色のトークン", () => {
  test("--gk-dads-* はデジタル庁デザインシステムのカラートークンと同じ値", () => {
    const own = [...vars].filter(([k]) => k.startsWith("--gk-dads-"));
    expect(own.length).toBeGreaterThan(0);
    for (const [k, v] of own) expect([k, v]).toEqual([k, dads.get(k.slice("--gk-dads-".length))]);
  });

  test("ほかのトークンは、すべてデザインシステムの色を参照している", () => {
    for (const k of vars.keys()) expect(() => dadsNameOf(k)).not.toThrow();
  });

  test("アプリと iframe の CSS には、色を直接書かない（トークンを使う）", () => {
    for (const [name, css] of [
      ["style.css", appCss],
      ["frame.css", frameCss],
    ]) {
      const hex = css!.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
      expect([name, hex]).toEqual([name, []]);
    }
  });
});

describe("つまみのレベルの色", () => {
  test("濃い色は白に対して 4.5:1 以上（チップの白い文字・つまみの文字に使う）", () => {
    for (const lv of LEVELS)
      expect(contrast(`--gk-l${lv}`, "--gk-dads-white")).toBeGreaterThanOrEqual(4.5);
  });

  test("補足の線は背景に対して 3:1 以上、補足の本文は背景に対して 7:1 以上", () => {
    for (const lv of LEVELS) {
      expect(contrast(`--gk-l${lv}`, `--gk-l${lv}-bg`)).toBeGreaterThanOrEqual(3);
      expect(contrast("--gk-ink", `--gk-l${lv}-bg`)).toBeGreaterThanOrEqual(7);
    }
    expect(contrast("--gk-ink", "--gk-l2-mark")).toBeGreaterThanOrEqual(7);
  });

  test("ことば・言い回し・文脈の濃い色は、どの色覚でも見分けられる（色差 15 以上）", () => {
    const low: string[] = [];
    for (const [a, b] of [
      [1, 2],
      [1, 3],
      [2, 3],
    ]) {
      for (const v of ALL) {
        const d = diff(`--gk-l${a}`, `--gk-l${b}`, v);
        if (d < 15) low.push(`L${a}-L${b} ${v}: ${d.toFixed(1)}`);
      }
    }
    expect(low).toEqual([]);
  });

  test("いちばん多く並ぶ「ことば」と「言い回し」は、背景の淡い色どうしも、どの色覚でも見分けられる", () => {
    for (const v of ALL) expect(diff("--gk-l1-bg", "--gk-l2-bg", v)).toBeGreaterThanOrEqual(15);
  });

  test("一般色覚では、4色とも互いに見分けられる（前提は色覚によっては青と近いので、破線と「推測」でも区別する）", () => {
    for (const a of LEVELS) {
      for (const b of LEVELS) {
        if (a >= b) continue;
        expect(diff(`--gk-l${a}`, `--gk-l${b}`, "C")).toBeGreaterThanOrEqual(15);
        expect(diff(`--gk-l${a}-bg`, `--gk-l${b}-bg`, "C")).toBeGreaterThanOrEqual(8);
      }
    }
    expect(frameCss).toMatch(/gk-note\[data-level="4"\] gk-box\s*\{[^}]*dashed/);
  });
});

describe("文字・バッジ・お知らせ", () => {
  test("文字は背景に対して 4.5:1 以上、枠線は 3:1 以上", () => {
    const pairs: [string, string][] = [
      ["--gk-ink", "--gk-surface"],
      ["--gk-ink-sub", "--gk-surface"],
      ["--gk-muted", "--gk-surface"],
      ["--gk-muted", "--gk-canvas"],
      ["--gk-link", "--gk-surface"],
      ["--gk-surface", "--gk-brand"],
      ["--gk-guess", "--gk-guess-bg"],
      ["--gk-general", "--gk-general-bg"],
      ["--gk-dads-white", "--gk-must-bg"],
      ["--gk-dads-white", "--gk-must-not-bg"],
      ["--gk-should", "--gk-should-bg"],
      ["--gk-may", "--gk-may-bg"],
      ["--gk-info", "--gk-info-bg"],
      ["--gk-page", "--gk-surface"],
      ["--gk-error", "--gk-error-bg"],
      ["--gk-warn", "--gk-warn-bg"],
      ["--gk-caution", "--gk-caution-bg"],
    ];
    const low = pairs
      .filter(([fg, bg]) => contrast(fg, bg) < 4.5)
      .map(([fg, bg]) => `${fg} / ${bg}: ${contrast(fg, bg).toFixed(2)}`);
    expect(low).toEqual([]);
    expect(contrast("--gk-line", "--gk-surface")).toBeGreaterThanOrEqual(3);
    expect(contrast("--gk-focus-ring", "--gk-focus")).toBeGreaterThanOrEqual(3);
  });
});
