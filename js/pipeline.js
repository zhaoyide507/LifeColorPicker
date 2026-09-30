/* ═══════════ 采色生活 · 画布流水线 ═══════════
 * 拼图 → 色彩种子（像素化） → 色板 → 重构叠加，全部在浏览器 Canvas 内完成。
 */
"use strict";

const Pipeline = {

  /* ── 第壹步：拼图 ── */

  /**
   * 把一组 1:1 裁剪图织成网格拼图
   * @param {ImageBitmap[]} bitmaps 已上传图片
   * @param {number} cols 横向张数  @param {number} rows 纵向张数
   */
  buildCollage(bitmaps, cols, rows) {
    const GAP = 8;                                  // 白缝
    const CELL = cols >= 18 ? 150 : cols >= 9 ? 200 : 240;
    const W = cols * CELL + (cols + 1) * GAP;
    const H = rows * CELL + (rows + 1) * GAP;
    const c = Util.canvas(W, H);
    const ctx = Util.ctx(c);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    bitmaps.forEach((img, i) => {
      const x = i % cols, y = Math.floor(i / cols);
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2, sy = (img.height - side) / 2;
      ctx.drawImage(img, sx, sy, side, side,
        GAP + x * (CELL + GAP), GAP + y * (CELL + GAP), CELL, CELL);
    });
    return c;
  },

  /* ── 第贰步：像素化 → 色彩种子 ── */

  /**
   * 马赛克化：每张照片区域压成 B×B 个色块
   */
  pixelate(collageCanvas, cols, rows, blocksPerCell) {
    const B = blocksPerCell;
    const gw = cols * B, gh = rows * B;
    // 先缩到 mosaic 网格尺寸，让浏览器做区域平均
    const tiny = Util.canvas(gw, gh);
    const tctx = Util.ctx(tiny);
    tctx.imageSmoothingQuality = "high";
    tctx.drawImage(collageCanvas, 0, 0, gw, gh);
    const { data } = tctx.getImageData(0, 0, gw, gh);
    // 再放大成色块图
    const PX = 28;                                  // 每个色块的输出尺寸
    const GAP = 1;                                  // 块间细缝
    const c = Util.canvas(gw * (PX + GAP) + GAP, gh * (PX + GAP) + GAP);
    const ctx = Util.ctx(c);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = (y * gw + x) * 4;
        ctx.fillStyle = `rgb(${data[i]},${data[i + 1]},${data[i + 2]})`;
        ctx.fillRect(GAP + x * (PX + GAP), GAP + y * (PX + GAP), PX, PX);
      }
    }
    return c;
  },

  /**
   * 色板色彩校准：把 AI 输出的每个像素映射到最近的色板色，
   * 仅保留其明度层次（避免混色/加饱和），保证线条种子严格取色于色板。
   */
  clampToPalette(src, groups) {
    const palette = groups.flat().map(h => Util.hexToRgb(h));
    const plum = palette.map(p => p[0] * 0.299 + p[1] * 0.587 + p[2] * 0.114 || 1);
    const c = Util.canvas(src.width, src.height);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(src, 0, 0);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      let best = 0, bestD = Infinity;
      for (let k = 0; k < palette.length; k++) {
        const p = palette[k];
        const dist = (d[i] - p[0]) ** 2 + (d[i + 1] - p[1]) ** 2 + (d[i + 2] - p[2]) ** 2;
        if (dist < bestD) { bestD = dist; best = k; }
      }
      const p = palette[best];
      const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      const ratio = Math.max(0.85, Math.min(1.15, lum / plum[best]));
      d[i]     = Math.min(255, p[0] * ratio);
      d[i + 1] = Math.min(255, p[1] * ratio);
      d[i + 2] = Math.min(255, p[2] * ratio);
    }
    ctx.putImageData(img, 0, 0);
    return c;
  },

  /* ── 第叁步：色板 ── */

  /** 绘制 7×3 色板图（白底、细缝、无文字，同示例样式）；gapless=true 时无缝紧贴，作送模型的输入 */
  buildPaletteCanvas(groups, { gapless = false } = {}) {
    const COLS = 7, ROWS = 3;
    const MARGIN = gapless ? 0 : 24, GAP = gapless ? 0 : 8;
    const W = gapless ? 1407 : 1400;
    const SW = Math.floor((W - MARGIN * 2 - GAP * (COLS - 1)) / COLS);
    const H = MARGIN * 2 + ROWS * SW + GAP * (ROWS - 1);
    const c = Util.canvas(W, H);
    const ctx = Util.ctx(c);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    groups.forEach((row, r) => {
      row.forEach((hex, col) => {
        ctx.fillStyle = hex;
        ctx.fillRect(
          MARGIN + col * (SW + GAP),
          MARGIN + r * (SW + GAP),
          SW, SW,
        );
      });
    });
    return c;
  },

  /* ── 第伍步：重构 ── */

  /** 线条种子 → 按拼图比例补白（控制出图比例） */
  padLineSeed(lineSeedCanvas, ratio) {
    return Util.padToRatio(lineSeedCanvas, ratio);
  },

  /** AI 返回图 → 中心裁剪到拼图精确比例 */
  fitRebuild(aiCanvas, ratio) {
    return Util.cropToRatio(aiCanvas, ratio, 2048);
  },

  /** 重构图 + 5% 拼图叠加 */
  overlayCollage(rebuildCanvas, collageCanvas, alpha = 0.05) {
    return Util.overlay(rebuildCanvas, collageCanvas, alpha);
  },

  /* ── 终：组图 ── */

  /**
   * 把已生成的作品竖排合成一张白底组图（同示例图版式）
   * @param {HTMLCanvasElement[]} artworks 按顺序的画作
   */
  buildPoster(artworks) {
    const list = artworks.filter(Boolean);
    if (!list.length) throw new Error("还没有可拼接的作品");
    const W = 1200, MARGIN = 92, GAP = 64;
    const inner = W - MARGIN * 2;
    const scaled = list.map(a => {
      const k = inner / a.width;
      const c = Util.canvas(inner, Math.max(2, Math.round(a.height * k)));
      const ctx = Util.ctx(c);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(a, 0, 0, c.width, c.height);
      return c;
    });
    const H = MARGIN * 2 + scaled.reduce((s, c) => s + c.height, 0) + GAP * (scaled.length - 1);
    const poster = Util.canvas(W, H);
    const ctx = Util.ctx(poster);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    let y = MARGIN;
    for (const c of scaled) {
      ctx.drawImage(c, MARGIN, y);
      y += c.height + GAP;
    }
    return poster;
  },
};
