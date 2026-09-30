/* ═══════════ 采色生活 · 通用工具 ═══════════ */
"use strict";

const Util = {

  /** 建一个画布 */
  canvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  },

  ctx(canvas) {
    return canvas.getContext("2d", { willReadFrequently: false });
  },

  /** 文件 → 位图（自动校正 EXIF 方向）；失败返回 null */
  async fileToBitmap(file) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch (e) {
      // 兜底：走 <img> 解码
      const url = URL.createObjectURL(file);
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        return img;
      } catch (e2) {
        return null;
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    }
  },

  /** 图片 → 1:1 中心裁剪画布（cover） */
  squareCrop(img, size) {
    const sw = img.width, sh = img.height;
    const side = Math.min(sw, sh);
    const sx = (sw - side) / 2, sy = (sh - side) / 2;
    const c = Util.canvas(size, size);
    Util.ctx(c).drawImage(img, sx, sy, side, side, 0, 0, size, size);
    return c;
  },

  /** 等比缩放画布，使长边 ≤ maxSide（不放大） */
  scaleCanvas(src, maxSide) {
    const long = Math.max(src.width, src.height);
    if (long <= maxSide) return src;
    const k = maxSide / long;
    const c = Util.canvas(Math.round(src.width * k), Math.round(src.height * k));
    const ctx = Util.ctx(c);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return c;
  },

  /** 把画布内容 contain 进指定宽高比（ratio = w/h）的白色画布，用于控制生图比例 */
  padToRatio(src, ratio) {
    const sr = src.width / src.height;
    let w, h;
    if (sr > ratio) { w = src.width; h = Math.round(src.width / ratio); }
    else { h = src.height; w = Math.round(src.height * ratio); }
    const k = Math.min(1, 1536 / Math.max(w, h));   // 送模型的图控制在长边 1536 内
    w = Math.max(2, Math.round(w * k)); h = Math.max(2, Math.round(h * k));
    const c = Util.canvas(w, h);
    const ctx = Util.ctx(c);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = "high";
    // contain
    const dk = Math.min(w / src.width, h / src.height);
    const dw = src.width * dk, dh = src.height * dk;
    ctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
    return c;
  },

  /** 中心裁剪画布到精确宽高比（ratio = w/h），输出再限制长边 ≤ maxSide */
  cropToRatio(src, ratio, maxSide = 2048) {
    const sr = src.width / src.height;
    let sw = src.width, sh = src.height, sx = 0, sy = 0;
    if (sr > ratio) { sw = Math.round(src.height * ratio); sx = (src.width - sw) / 2; }
    else { sh = Math.round(src.width / ratio); sy = (src.height - sh) / 2; }
    let w = sw, h = sh;
    const k = Math.min(1, maxSide / Math.max(w, h));
    w = Math.round(w * k); h = Math.round(h * k);
    const c = Util.canvas(w, h);
    const ctx = Util.ctx(c);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
    return c;
  },

  /** 把 base（如重构图）画到底上，再以 alpha 透明度叠上 top（如拼图），返回新画布 */
  overlay(base, top, alpha) {
    const c = Util.canvas(base.width, base.height);
    const ctx = Util.ctx(c);
    ctx.drawImage(base, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(top, 0, 0, base.width, base.height);
    ctx.globalAlpha = 1;
    return c;
  },

  /** 画布 → PNG 下载 */
  download(canvas, filename) {
    canvas.toBlob((blob) => {
      if (!blob) { App.toast("导出失败：画布为空", "err"); return; }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      App.toast(`已导出 ${filename}`, "ok");
    }, "image/png");
  },

  /** 画布 → JPEG base64（不带 data: 前缀，送审接口用） */
  toJpegBase64(canvas, quality = 0.92) {
    const url = canvas.toDataURL("image/jpeg", quality);
    return url.slice(url.indexOf(",") + 1);
  },

  /** base64 → 画布 */
  async base64ToCanvas(b64) {
    return Util.dataURLToCanvas("data:image/jpeg;base64," + b64);
  },

  /** dataURL → 画布 */
  async dataURLToCanvas(url) {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = Util.canvas(img.naturalWidth, img.naturalHeight);
    Util.ctx(c).drawImage(img, 0, 0);
    return c;
  },

  /* ── 颜色工具 ── */

  rgbToHex(r, g, b) {
    return "#" + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  },

  normalizeHex(h) {
    let s = String(h || "").trim().toLowerCase();
    if (!s) return null;
    if (s[0] !== "#") s = "#" + s;
    if (/^#[0-9a-f]{3}$/.test(s)) s = "#" + [...s.slice(1)].map(ch => ch + ch).join("");
    return /^#[0-9a-f]{6}$/.test(s) ? s : null;
  },

  hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  },

  rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > .5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [h * 60, s, l];
  },

  /** 统计色彩种子里出现频次最高的候选色（4bit/通道量化 + 去近邻） */
  sampleCandidateColors(seedCanvas, maxColors = 48) {
    const small = Util.scaleCanvas(seedCanvas, 480);
    const ctx = small.getContext("2d", { willReadFrequently: true });
    const { data } = ctx.getImageData(0, 0, small.width, small.height);
    const freq = new Map();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 200) continue;
      const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
      const f = freq.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      f.n++; f.r += data[i]; f.g += data[i + 1]; f.b += data[i + 2];
      freq.set(key, f);
    }
    let list = [...freq.values()]
      .sort((a, b) => b.n - a.n)
      .map(f => ({ hex: Util.rgbToHex(f.r / f.n, f.g / f.n, f.b / f.n) }));
    // 去掉与已选颜色距离过近的项
    const picked = [];
    for (const c of list) {
      const [r1, g1, b1] = Util.hexToRgb(c.hex);
      if (picked.every(p => {
        const [r2, g2, b2] = Util.hexToRgb(p.hex);
        return Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2) > 60;
      })) picked.push(c);
      if (picked.length >= maxColors) break;
    }
    return picked;
  },

  /**
   * 本地降级色板：当 DeepSeek 不可用时，按暖 / 冷 / 中性分三组，组内按明度排序
   */
  localPalette(candidates) {
    const warm = [], cool = [], neutral = [];
    for (const { hex } of candidates) {
      const [h, s, l] = Util.rgbToHsl(...Util.hexToRgb(hex));
      if (s < 0.16) neutral.push({ hex, l });
      else if (h < 75 || h >= 330) warm.push({ hex, l });
      else cool.push({ hex, l });
    }
    const build = (arr) => {
      arr.sort((a, b) => b.l - a.l);              // 深 → 浅
      const out = arr.slice(0, 7).map(x => x.hex);
      while (out.length < 7) {                    // 不足时向浅处插值补齐
        const base = out.length ? Util.hexToRgb(out[out.length - 1]) : [128, 128, 128];
        const t = 0.16 * (out.length + 1 - arr.slice(0, 7).length);
        out.push(Util.rgbToHex(base[0] + (255 - base[0]) * t, base[1] + (255 - base[1]) * t, base[2] + (255 - base[2]) * t));
      }
      return out;
    };
    const g1 = build(warm.length >= 3 ? warm : [...warm, ...neutral]);
    const g2 = build(cool.length >= 3 ? cool : [...cool, ...warm]);
    const g3 = build(neutral.length >= 3 ? neutral : [...neutral, ...cool]);
    return [g1, g2, g3];
  },
};
