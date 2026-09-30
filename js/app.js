/* ═══════════ 采色生活 · 界面与流程 ═══════════ */
"use strict";

/* 拼图规格：张数 → （横向 × 纵向） */
const SPECS = {
  16:  { cols: 4,  rows: 4,  label: "4×4" },
  25:  { cols: 5,  rows: 5,  label: "5×5" },
  36:  { cols: 9,  rows: 4,  label: "9×4" },
  81:  { cols: 9,  rows: 9,  label: "9×9" },
  162: { cols: 18, rows: 9,  label: "18×9" },
};

/* 第肆步：色板 → 线条种子（大胆流动；色彩严格性由 clampToPalette 自动校准保证） */
const LINE_SEED_PROMPT =
  "把这张色板图化作一幅大幅流动的抽象流体画：所有颜色互相渗透，舒展成贯穿整幅画面的流畅波浪曲线与漩涡，如大理石纹般连绵流动，充满动势，画面浑然一体；" +
  "绝不允许出现任何格子、方块、分块或边界线；大致保留画面上下左右的色彩分布；无文字";
const LINE_SEED_SCALE = 0.65;

/* 第伍步：重构指令 = DeepSeek 即兴场景 + 固定色彩约束 + 画风笔触 */
const REBUILD_CONSTRAINT =
  "画面各区域的颜色与上下左右的色彩分布保持不变，不新增颜色、不提高饱和度、不使用荧光色；" +
  "让色块自然晕染、相互连通地融入具象场景，不要保留任何格子、方块或分块边界";
const STYLE_TAILS = {
  oil:        "用油画厚涂笔触呈现",
  impression: "用印象派光斑与松散笔触呈现",
  ink:        "用水墨晕染呈现，浓淡相宜，适量留白",
  comic:      "用漫画平涂上色与清晰勾线呈现",
};
const REBUILD_SCALE = 0.5;

/* DeepSeek 不可用时的兜底场景 */
const FALLBACK_SCENES = [
  "清晨的老街早点摊，蒸汽与微光一起升起",
  "黄昏的河岸步道，归家的人影被夕阳拉长",
  "雨后的巷口，石板路映着檐下的暖灯",
  "周末的校园小径，树影斑驳，有人骑车经过",
  "夜市的灯串刚刚亮起，人潮慢慢涌动",
  "初冬的十字路口，行人裹着围巾等一场绿灯",
];

const $ = (id) => document.getElementById(id);
const KEYS_STORAGE = "caise_keys_v1";
const RESULTS_STORAGE = "caise_results_v1";

const App = {

  state: {
    count: 16,
    images: [],          // { id, bitmap, url, name }
    collage: null,       // canvas
    colorSeed: null,     // canvas
    palette: null,       // { canvas, groups }
    lineSeed: null,      // canvas
    rebuild: null,       // { before, after }
    poster: null,        // canvas 组图
    style: "oil",
    busy: false,
  },

  keys: { dsKey: "", ak: "", sk: "" },
  _uid: 0,

  /* ───────────────────────── 启动 ───────────────────────── */

  init() {
    App.loadKeys();
    App.bindGlobal();
    App.bindStep1();
    App.bindStep2();
    App.bindStep3();
    App.bindStep4();
    App.bindStep5();
    App.bindStepFinal();
    App.bindKeyModal();
    App.refreshKeyStatus();
    App.refreshSteps();
    App.applyKeyVisibility();
    App.restoreResults();          // 恢复上次持久化的作品（含校准后的线条种子）
  },

  /** 依据 Key 配置切换界面：第叁步描述文案 + 第肆、伍步显隐（未配置火山 AK/SK 时整体隐藏） */
  applyKeyVisibility() {
    const k = App.keysReady();
    $("step4").classList.toggle("hidden", !k.volc);
    $("step5").classList.toggle("hidden", !k.volc);
    $("paletteDesc").innerHTML = k.ds
      ? "调用 <strong>DeepSeek</strong> 模型，从色彩种子中提取 3 组（每组 7 个）十六进制色值。"
      : "由于未接入模型 Key，使用本地算法，从色彩种子中提取 3 组（每组 7 个）十六进制色值。";
  },

  /* ───────────────────── 结果持久化（localStorage） ───────────────────── */

  /**
   * 把已生成的作品（含校准后的线条种子）写入 localStorage，
   * 刷新页面后可直接从任意已完成步骤继续，不必重新生成。
   * 照片原图不入库（体积大且仅用于重新生成拼图）。
   */
  persistResults() {
    try {
      const s = App.state;
      const jpeg = (cv, q) => cv ? Util.scaleCanvas(cv, 1600).toDataURL("image/jpeg", q) : null;
      const png = (cv) => cv ? Util.scaleCanvas(cv, 1600).toDataURL("image/png") : null;
      const pack = {
        v: 1,
        count: s.count,
        paletteGroups: s.palette ? s.palette.groups : null,
        collage: jpeg(s.collage, 0.85),
        colorSeed: png(s.colorSeed),
        paletteImg: png(s.palette && s.palette.canvas),
        lineSeed: jpeg(s.lineSeed, 0.92),          // 已校准的线条种子
        rebuildBefore: jpeg(s.rebuild && s.rebuild.before, 0.92),
        rebuildAfter: jpeg(s.rebuild && s.rebuild.after, 0.92),
      };
      localStorage.setItem(RESULTS_STORAGE, JSON.stringify(pack));
    } catch (e) {
      // 存储配额不足等情况：不影响主流程
      console.warn("结果持久化失败：", e);
    }
  },

  /** 启动时恢复上次的作品 */
  async restoreResults() {
    let pack = null;
    try { pack = JSON.parse(localStorage.getItem(RESULTS_STORAGE) || "null"); } catch (e) { /* 忽略 */ }
    if (!pack) return;
    const dec = (url) => url ? Util.dataURLToCanvas(url).catch(() => null) : Promise.resolve(null);
    const [collage, colorSeed, paletteImg, lineSeed, rb, ra] = await Promise.all([
      dec(pack.collage), dec(pack.colorSeed), dec(pack.paletteImg),
      dec(pack.lineSeed), dec(pack.rebuildBefore), dec(pack.rebuildAfter),
    ]);
    if (pack.count && SPECS[pack.count]) {
      App.state.count = pack.count;
      document.querySelectorAll(".spec-btn").forEach(b =>
        b.classList.toggle("active", parseInt(b.dataset.count, 10) === pack.count));
      App.refreshCount();
    }
    const s = App.state;
    if (collage) {
      s.collage = collage;
      App.showCanvas("collageCanvas", "collagePlaceholder", collage);
      $("dlCollage").classList.remove("hidden");
    }
    if (colorSeed) {
      s.colorSeed = colorSeed;
      App.showCanvas("seedCanvas", "seedPlaceholder", colorSeed);
      $("dlSeed").classList.remove("hidden");
    }
    if (paletteImg && Array.isArray(pack.paletteGroups)) {
      s.palette = { canvas: paletteImg, groups: pack.paletteGroups };
      App.showCanvas("paletteCanvas", "palettePlaceholder", paletteImg);
      $("dlPalette").classList.remove("hidden");
      $("paletteNote").textContent = "7 × 3 · 三组十六进制色值";
      App.renderHexList(pack.paletteGroups);
    }
    if (lineSeed) {
      s.lineSeed = lineSeed;
      App.showCanvas("lineSeedCanvas", "lineSeedPlaceholder", lineSeed);
      $("dlLineSeed").classList.remove("hidden");
      $("lineSeedTag").classList.remove("hidden");
    }
    if (rb && ra) {
      s.rebuild = { before: rb, after: ra };
      App.paint($("rebuildBeforeCanvas"), rb);
      App.paint($("rebuildAfterCanvas"), ra);
      $("rebuildPlaceholder").classList.add("hidden");
      App.showRebuildView("before");
      $("rebuildToggle").classList.remove("hidden");
      $("rebuildExports").classList.remove("hidden");
    }
    App.refreshSteps();
    if (s.collage || s.lineSeed) {
      App.toast("已恢复上次的作品，可继续后续步骤（照片不保留，重生成拼图需重新上传）", "ok");
    }
  },

  /* ───────────────────────── 通用 UI ───────────────────────── */

  toast(msg, type = "") {
    const t = document.createElement("div");
    t.className = "toast " + type;
    t.textContent = msg;
    $("toasts").appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; }, 3600);
    setTimeout(() => t.remove(), 4000);
  },

  setBusy(b) {
    App.state.busy = b;
    ["btnCollage", "btnSeed", "btnPalette", "btnLineSeed", "btnRebuild", "btnPoster"].forEach(id => {
      const el = $(id);
      el.disabled = b || !el.dataset.ready;
    });
  },

  /** 按钮进入加载态 */
  loading(btn, on) {
    btn.classList.toggle("loading", on);
    btn.disabled = on;
  },

  /** 完成上一步后解锁后续步骤 */
  refreshSteps() {
    const gates = [
      !!App.state.collage,
      !!App.state.colorSeed,
      !!App.state.palette,
      !!App.state.lineSeed,
    ];
    for (let s = 2; s <= 5; s++) {
      $("step" + s).classList.toggle("locked", !gates[s - 2]);
    }
    // 各生成按钮的就绪条件
    App.markReady("btnSeed", !!App.state.collage);
    App.markReady("btnPalette", !!App.state.colorSeed);
    App.markReady("btnLineSeed", !!App.state.palette);
    App.markReady("btnRebuild", !!App.state.lineSeed);
    App.markReady("btnPoster", !!App.state.collage);
    if (!App.state.busy) App.setBusy(false);
  },

  markReady(id, ready) {
    const el = $(id);
    el.dataset.ready = ready ? "1" : "";
    el.disabled = !ready || App.state.busy;
  },

  /** 从第 n 步起结果失效（上游重新生成时） */
  invalidateFrom(stepNo) {
    const clear = [
      () => { App.state.collage = null; App.showCanvas("collageCanvas", "collagePlaceholder", null); $("dlCollage").classList.add("hidden"); },
      () => { App.state.colorSeed = null; App.showCanvas("seedCanvas", "seedPlaceholder", null); $("dlSeed").classList.add("hidden"); },
      () => { App.state.palette = null; App.showCanvas("paletteCanvas", "palettePlaceholder", null); $("dlPalette").classList.add("hidden"); $("hexList").classList.add("hidden"); },
      () => { App.state.lineSeed = null; App.showCanvas("lineSeedCanvas", "lineSeedPlaceholder", null); $("dlLineSeed").classList.add("hidden"); $("lineSeedStatus").classList.add("hidden"); $("lineSeedTag").classList.add("hidden"); },
      () => {
        App.state.rebuild = null;
        App.showCanvas("rebuildBeforeCanvas", "rebuildPlaceholder", null);
        $("rebuildAfterCanvas").classList.add("hidden");
        $("tagAfter").classList.add("hidden");
        $("rebuildToggle").classList.add("hidden");
        $("rebuildExports").classList.add("hidden");
        $("rebuildStatus").classList.add("hidden");
        $("rebuildPromptBox").classList.add("hidden");
      },
      () => { App.state.poster = null; App.showCanvas("posterCanvas", "posterPlaceholder", null); $("dlPoster").classList.add("hidden"); },
    ];
    for (let i = stepNo - 1; i < clear.length; i++) clear[i]();
    App.refreshSteps();
    App.persistResults();          // 同步修剪持久化，避免刷新后恢复过期作品
  },

  /** 在预览框里显示/隐藏画布 */
  showCanvas(canvasId, placeholderId, canvas) {
    const cv = $(canvasId), ph = $(placeholderId);
    if (canvas) {
      App.paint(cv, canvas);
      cv.classList.remove("hidden");
      ph.classList.add("hidden");
    } else {
      cv.classList.add("hidden");
      cv.width = cv.height = 0;
      ph.classList.remove("hidden");
    }
  },

  /** 把 src 画到目标预览 canvas（重设尺寸） */
  paint(cv, src) {
    cv.width = src.width; cv.height = src.height;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(src, 0, 0);
  },

  /* ───────────────────────── Key 面板 ───────────────────────── */

  loadKeys() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEYS_STORAGE) || "{}");
      App.keys = { dsKey: saved.dsKey || "", ak: saved.ak || "", sk: saved.sk || "" };
    } catch (e) { /* 忽略损坏数据 */ }
  },

  saveKeys() {
    localStorage.setItem(KEYS_STORAGE, JSON.stringify(App.keys));
    App.refreshKeyStatus();
  },

  keysReady() {
    return {
      ds: !!App.keys.dsKey,
      volc: !!(App.keys.ak && App.keys.sk),
    };
  },

  refreshKeyStatus() {
    const k = App.keysReady();
    const el = $("keyStatus");
    const dot = (ok) => `<span class="dot ${ok ? "ok" : "bad"}"></span>`;
    el.innerHTML = `DeepSeek ${dot(k.ds)} ＋ 火山 ${dot(k.volc)}`;
  },

  bindKeyModal() {
    // 使用说明弹窗
    $("btnHelp").addEventListener("click", () => $("helpModal").classList.remove("hidden"));
    $("btnHelpClose").addEventListener("click", () => $("helpModal").classList.add("hidden"));
    $("helpModal").addEventListener("click", (e) => { if (e.target === $("helpModal")) $("helpModal").classList.add("hidden"); });

    $("btnKeys").addEventListener("click", () => {
      $("inpDsKey").value = App.keys.dsKey;
      $("inpAk").value = App.keys.ak;
      $("inpSk").value = App.keys.sk;
      $("keyModal").classList.remove("hidden");
    });
    const close = () => { $("keyModal").classList.add("hidden"); $("helpModal").classList.add("hidden"); };
    $("btnKeyClose").addEventListener("click", close);
    $("keyModal").addEventListener("click", (e) => { if (e.target === $("keyModal")) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

    document.querySelectorAll(".peek").forEach(btn => {
      btn.addEventListener("click", () => {
        const inp = $(btn.dataset.target);
        inp.type = inp.type === "password" ? "text" : "password";
      });
    });

    $("btnKeySave").addEventListener("click", () => {
      App.keys.dsKey = $("inpDsKey").value.trim();
      App.keys.ak = $("inpAk").value.trim();
      App.keys.sk = $("inpSk").value.trim();
      App.saveKeys();
      App.applyKeyVisibility();
      App.toast("API Key 已保存到本机浏览器", "ok");
      close();
    });

    $("btnKeyClear").addEventListener("click", () => {
      App.keys = { dsKey: "", ak: "", sk: "" };
      localStorage.removeItem(KEYS_STORAGE);
      $("inpDsKey").value = $("inpAk").value = $("inpSk").value = "";
      App.refreshKeyStatus();
      App.applyKeyVisibility();
      App.toast("已清除保存的 Key（第肆 / 伍步已隐藏，前三步仍可使用）");
    });

    $("btnKeyTest").addEventListener("click", async () => {
      const dsKey = $("inpDsKey").value.trim();
      if (!dsKey) { App.toast("请先填写 DeepSeek API Key", "err"); return; }
      const btn = $("btnKeyTest");
      App.loading(btn, true);
      try {
        await API.testDeepSeek({ dsKey });
        App.toast("DeepSeek 连接成功 ✓", "ok");
      } catch (e) {
        App.toast(e.message, "err");
      } finally {
        App.loading(btn, false);
      }
    });
  },

  /* ───────────────────────── 第壹步：上传与拼图 ───────────────────────── */

  bindGlobal() {
    // 粘贴图片
    document.addEventListener("paste", (e) => {
      const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith("image/"));
      if (files.length) { e.preventDefault(); App.addFiles(files); }
    });
  },

  bindStep1() {
    // 规格切换
    $("specRow").addEventListener("click", (e) => {
      const btn = e.target.closest(".spec-btn");
      if (!btn) return;
      document.querySelectorAll(".spec-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      App.state.count = parseInt(btn.dataset.count, 10);
      App.refreshCount();
    });

    const dz = $("dropzone");
    dz.addEventListener("click", () => $("fileInput").click());
    dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") $("fileInput").click(); });
    $("fileInput").addEventListener("change", (e) => {
      App.addFiles([...e.target.files]);
      e.target.value = "";
    });
    ["dragenter", "dragover"].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("dragover"); }));
    ["dragleave", "drop"].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("dragover"); }));
    dz.addEventListener("drop", (e) => {
      const files = [...(e.dataTransfer?.files || [])].filter(f => f.type.startsWith("image/"));
      if (files.length) App.addFiles(files);
    });

    $("btnClear").addEventListener("click", () => {
      App.state.images.forEach(it => it.url && URL.revokeObjectURL(it.url));
      App.state.images = [];
      App.renderThumbs();
      App.invalidateFrom(1);
      App.refreshCount();
    });

    $("btnCollage").addEventListener("click", () => App.generateCollage());
    $("dlCollage").addEventListener("click", () => {
      const spec = SPECS[App.state.count];
      Util.download(App.state.collage, `采色生活_拼图_${spec.label}.png`);
    });
  },

  async addFiles(files) {
    const room = App.state.count - App.state.images.length;
    if (files.length > room) {
      App.toast(`超出规格：还需要 ${room} 张，已忽略多余的 ${files.length - room} 张`, "err");
      files = files.slice(0, Math.max(0, room));
    }
    for (const f of files) {
      const bitmap = await Util.fileToBitmap(f);
      if (!bitmap) { App.toast(`无法读取图片：${f.name}`, "err"); continue; }
      App.state.images.push({ id: ++App._uid, bitmap, url: URL.createObjectURL(f), name: f.name });
    }
    App.renderThumbs();
    App.refreshCount();
  },

  removeImage(id) {
    const idx = App.state.images.findIndex(it => it.id === id);
    if (idx >= 0) {
      URL.revokeObjectURL(App.state.images[idx].url);
      App.state.images.splice(idx, 1);
      App.renderThumbs();
      App.refreshCount();
    }
  },

  renderThumbs() {
    const grid = $("thumbGrid");
    grid.innerHTML = "";
    for (const it of App.state.images) {
      const div = document.createElement("div");
      div.className = "thumb";
      div.title = it.name;
      const img = document.createElement("img");
      img.src = it.url;
      img.alt = it.name;
      const rm = document.createElement("button");
      rm.className = "rm";
      rm.type = "button";
      rm.textContent = "✕";
      rm.addEventListener("click", () => App.removeImage(it.id));
      div.append(img, rm);
      grid.appendChild(div);
    }
  },

  refreshCount() {
    const n = App.state.images.length, need = App.state.count;
    const badge = $("countBadge");
    badge.textContent = `已上传 ${n} / ${need}`;
    badge.className = "count-badge " + (n === need ? "match" : n > need ? "over" : "");
    const hint = $("countHint");
    if (n > 0 && n !== need) {
      hint.textContent = n < need ? `还差 ${need - n} 张即可生成 ${SPECS[need].label} 拼图`
                                   : `已超出 ${n - need} 张，请删除多余照片`;
      hint.classList.remove("hidden");
    } else {
      hint.classList.add("hidden");
    }
    $("btnCollage").disabled = App.state.busy || n !== need;
  },

  generateCollage() {
    const { cols, rows } = SPECS[App.state.count];
    const btn = $("btnCollage");
    App.loading(btn, true);
    // 让出主线程渲染 loading
    setTimeout(() => {
      try {
        App.invalidateFrom(2);
        App.state.collage = Pipeline.buildCollage(App.state.images.map(it => it.bitmap), cols, rows);
        App.showCanvas("collageCanvas", "collagePlaceholder", App.state.collage);
        $("dlCollage").classList.remove("hidden");
        App.refreshSteps();
        App.persistResults();
        App.toast(`拼图完成：${cols}×${rows}`, "ok");
      } catch (e) {
        App.toast("拼图生成失败：" + e.message, "err");
      } finally {
        App.loading(btn, false);
      }
    }, 30);
  },

  /* ───────────────────────── 第贰步：色彩种子 ───────────────────────── */

  bindStep2() {
    $("densityRange").addEventListener("input", (e) => {
      $("densityLabel").textContent = `（每张照片 → ${e.target.value}×${e.target.value} 色块）`;
    });
    $("btnSeed").addEventListener("click", () => App.generateSeed());
    $("dlSeed").addEventListener("click", () => {
      const spec = SPECS[App.state.count];
      Util.download(App.state.colorSeed, `采色生活_色彩种子_${spec.label}.png`);
    });
  },

  generateSeed() {
    const { cols, rows } = SPECS[App.state.count];
    const B = parseInt($("densityRange").value, 10);
    const btn = $("btnSeed");
    App.loading(btn, true);
    setTimeout(() => {
      try {
        App.invalidateFrom(3);
        App.state.colorSeed = Pipeline.pixelate(App.state.collage, cols, rows, B);
        App.showCanvas("seedCanvas", "seedPlaceholder", App.state.colorSeed);
        $("dlSeed").classList.remove("hidden");
        App.refreshSteps();
        App.persistResults();
        App.toast(`色彩种子完成：${cols * B}×${rows * B} 色块`, "ok");
      } catch (e) {
        App.toast("像素化失败：" + e.message, "err");
      } finally {
        App.loading(btn, false);
      }
    }, 30);
  },

  /* ───────────────────────── 第叁步：AI 色板 ───────────────────────── */

  bindStep3() {
    $("btnPalette").addEventListener("click", () => App.generatePalette());
    $("dlPalette").addEventListener("click", () => Util.download(App.state.palette.canvas, "采色生活_色板.png"));
  },

  async generatePalette() {
    const btn = $("btnPalette");
    App.loading(btn, true);
    try {
      App.invalidateFrom(4);
      const candidates = Util.sampleCandidateColors(App.state.colorSeed, 48);
      let groups, byAI = true;
      if (!App.keys.dsKey) {
        // 未配置 Key：静默走本地算法，属于正常路径而非错误
        groups = Util.localPalette(candidates);
        byAI = false;
        App.toast("未配置 DeepSeek Key，已使用本地算法提取色板", "ok");
      } else {
        try {
          groups = await API.extractPalette(App.keys, App.state.colorSeed, candidates.map(c => c.hex));
        } catch (e) {
          console.warn("DeepSeek 色板失败，使用本地算法：", e);
          groups = Util.localPalette(candidates);
          byAI = false;
          App.toast("DeepSeek 调用失败，已用本地算法生成色板：" + e.message, "err");
        }
      }
      App.state.palette = { canvas: Pipeline.buildPaletteCanvas(groups), groups };
      App.showCanvas("paletteCanvas", "palettePlaceholder", App.state.palette.canvas);
      $("dlPalette").classList.remove("hidden");
      $("paletteNote").textContent = (byAI ? "DeepSeek 提取 · " : "本地算法 · ") + "7 × 3 · 三组十六进制色值";
      App.renderHexList(groups);
      App.refreshSteps();
      App.persistResults();
      App.toast(byAI ? "色板提取完成 ✓" : "色板已用本地算法生成", "ok");
    } catch (e) {
      App.toast("色板生成失败：" + e.message, "err");
    } finally {
      App.loading(btn, false);
    }
  },

  renderHexList(groups) {
    const box = $("hexList");
    box.innerHTML = "";
    groups.forEach(row => {
      const r = document.createElement("div");
      r.className = "hex-row";
      row.forEach(hex => {
        const [rr, gg, bb] = Util.hexToRgb(hex);
        const [, s, l] = Util.rgbToHsl(rr, gg, bb);
        const chip = document.createElement("div");
        chip.className = "hex-chip";
        chip.style.background = hex;
        chip.style.color = l > 0.6 ? "#5a4a3a" : "#fff";
        chip.textContent = hex.slice(1).toUpperCase();
        chip.title = "点击复制 " + hex;
        chip.addEventListener("click", () => {
          navigator.clipboard?.writeText(hex).then(() => App.toast("已复制 " + hex, "ok"));
        });
        r.appendChild(chip);
      });
      box.appendChild(r);
    });
    box.classList.remove("hidden");
  },

  /* ───────────────────────── 第肆步：线条种子 ───────────────────────── */

  bindStep4() {
    $("btnLineSeed").addEventListener("click", () => App.generateLineSeed());
    $("dlLineSeed").addEventListener("click", () => Util.download(App.state.lineSeed, "采色生活_线条种子.png"));
  },

  async generateLineSeed() {
    const btn = $("btnLineSeed");
    const status = $("lineSeedStatus");
    App.loading(btn, true);
    status.classList.remove("hidden");
    try {
      App.invalidateFrom(5);
      // 送模型的输入用无缝色板，避免白缝被当成构图保留成网格
      const gaplessInput = Pipeline.buildPaletteCanvas(App.state.palette.groups, { gapless: true });
      const b64 = await API.seedEditGenerate(App.keys, gaplessInput, LINE_SEED_PROMPT,
        (st, sec) => { status.textContent = `生成中… ${Math.round(sec)}s（${st || "提交任务"}）`; },
        LINE_SEED_SCALE);
      // 色彩校准：逐像素映射到最近色板色，保证线条种子严格取色于色板
      const raw = await Util.base64ToCanvas(b64);
      App.state.lineSeed = Pipeline.clampToPalette(raw, App.state.palette.groups);
      App.showCanvas("lineSeedCanvas", "lineSeedPlaceholder", App.state.lineSeed);
      $("lineSeedTag").classList.remove("hidden");
      $("dlLineSeed").classList.remove("hidden");
      status.textContent = "完成 ✓";
      App.refreshSteps();
      App.persistResults();
      App.toast("线条种子生成完成 ✓（已校准至色板色）", "ok");
    } catch (e) {
      status.textContent = "";
      status.classList.add("hidden");
      App.toast("线条种子生成失败：" + e.message, "err");
    } finally {
      App.loading(btn, false);
    }
  },

  /* ───────────────────────── 第伍步：重构 ───────────────────────── */

  bindStep5() {
    $("styleRow").addEventListener("click", (e) => {
      const btn = e.target.closest(".style-btn");
      if (!btn) return;
      document.querySelectorAll(".style-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      App.state.style = btn.dataset.style;
    });
    $("btnRebuild").addEventListener("click", () => App.generateRebuild());
    $("rebuildToggle").addEventListener("click", (e) => {
      const btn = e.target.closest(".toggle-btn");
      if (!btn) return;
      document.querySelectorAll(".toggle-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      App.showRebuildView(btn.dataset.view);
    });
    $("dlRebuildBefore").addEventListener("click", () => {
      const styleName = $("styleRow .style-btn.active").textContent.trim();
      Util.download(App.state.rebuild.before, `采色生活_重构图_${styleName}.png`);
    });
    $("dlRebuildAfter").addEventListener("click", () => {
      const styleName = $("styleRow .style-btn.active").textContent.trim();
      Util.download(App.state.rebuild.after, `采色生活_重构图_${styleName}_叠加拼图.png`);
    });
  },

  /* ───────────────────────── 终：导出组图 ───────────────────────── */

  bindStepFinal() {
    $("btnPoster").addEventListener("click", () => App.buildPoster());
    $("dlPoster").addEventListener("click", () => Util.download(App.state.poster, "采色生活_组图.png"));
  },

  buildPoster() {
    const btn = $("btnPoster");
    App.loading(btn, true);
    setTimeout(() => {
      try {
        // 未配置图生图 Key 时，组图仅含前三步
        const allowAI = App.keysReady().volc;
        const s = App.state;
        const artworks = [
          s.collage,
          s.colorSeed,
          s.palette && s.palette.canvas,
          allowAI ? s.lineSeed : null,
          allowAI ? s.rebuild && s.rebuild.after : null,
        ];
        App.state.poster = Pipeline.buildPoster(artworks);
        App.showCanvas("posterCanvas", "posterPlaceholder", App.state.poster);
        $("dlPoster").classList.remove("hidden");
        App.toast(`组图已组装（${artworks.filter(Boolean).length} 幅作品）`, "ok");
      } catch (e) {
        App.toast("组图组装失败：" + e.message, "err");
      } finally {
        App.loading(btn, false);
      }
    }, 30);
  },

  showRebuildView(which) {
    const before = $("rebuildBeforeCanvas"), after = $("rebuildAfterCanvas");
    before.classList.toggle("hidden", which !== "before");
    after.classList.toggle("hidden", which !== "after");
    $("tagAfter").classList.toggle("hidden", which !== "after");
  },

  async generateRebuild() {
    const btn = $("btnRebuild");
    const status = $("rebuildStatus");
    App.loading(btn, true);
    status.classList.remove("hidden");
    try {
      const spec = SPECS[App.state.count];
      const ratio = spec.cols / spec.rows;
      // 1) DeepSeek 依据色板情绪即兴构思场景，拼装本次指令
      status.textContent = "DeepSeek 正在依据色板构思场景…";
      let scene;
      try {
        scene = await API.composeRebuildScene(App.keys, App.state.palette.canvas, App.state.palette.groups, App.state.style);
      } catch (e) {
        console.warn("DeepSeek 构思场景失败，使用兜底场景：", e);
        scene = FALLBACK_SCENES[Math.floor(Math.random() * FALLBACK_SCENES.length)];
        App.toast("DeepSeek 构思失败，已用兜底场景：" + e.message, "err");
      }
      const prompt = `将这幅抽象画重构为具象画面：${scene}。${REBUILD_CONSTRAINT}，${STYLE_TAILS[App.state.style]}，无文字无签名`;
      $("rebuildPromptText").textContent = prompt;
      $("rebuildPromptBox").classList.remove("hidden");
      // 2) 线条种子补白到拼图比例，让出图比例与拼图一致
      const input = Pipeline.padLineSeed(App.state.lineSeed, ratio);
      // 3) 图生图
      const b64 = await API.seedEditGenerate(App.keys, input, prompt,
        (st, sec) => { status.textContent = `重构中… ${Math.round(sec)}s（${st || "提交任务"}）`; },
        REBUILD_SCALE);
      const aiCanvas = await Util.base64ToCanvas(b64);
      // 3) 裁到精确比例 + 5% 拼图叠加
      const before = Pipeline.fitRebuild(aiCanvas, ratio);
      const after = Pipeline.overlayCollage(before, App.state.collage, 0.05);
      App.state.rebuild = { before, after };
      App.paint($("rebuildBeforeCanvas"), before);
      App.paint($("rebuildAfterCanvas"), after);
      $("rebuildPlaceholder").classList.add("hidden");
      App.showRebuildView("before");
      $("rebuildToggle").classList.remove("hidden");
      $("rebuildExports").classList.remove("hidden");
      status.textContent = "完成 ✓";
      App.persistResults();
      App.toast("重构完成 ✓", "ok");
    } catch (e) {
      status.textContent = "";
      status.classList.add("hidden");
      App.toast("重构失败：" + e.message, "err");
    } finally {
      App.loading(btn, false);
    }
  },
};

document.addEventListener("DOMContentLoaded", () => App.init());

/* 供自动化测试 / 控制台调试使用 */
window.__caise = {
  addFiles: (files) => App.addFiles(files),
  state: App.state,
  keys: () => App.keys,
};
