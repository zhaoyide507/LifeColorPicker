/* ═══════════ 采色生活 · 模型调用 ═══════════
 * DeepSeek  : https://api.deepseek.com  （色板提取，多模态 + JSON 输出）
 * SeedEdit 3.0 : https://visual.volcengineapi.com （图生图，火山 V4 签名，提交任务 + 轮询）
 * 两种调用均由浏览器直连，Key 只存放在用户本地。
 */
"use strict";

const API = {

  /* ═══════════ DeepSeek ═══════════ */

  async deepseekChat(keys, content, { maxTokens = 8192, temperature = 0.4, jsonMode = true } = {}) {
    if (!keys.dsKey) throw new Error("请先在右上角「API Key 设置」中填写 DeepSeek API Key");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120000);
    const body = {
      model: "deepseek-flash",                    // DeepSeek-V4.1-Flash
      messages: [{ role: "user", content }],
      max_tokens: maxTokens,
      temperature,
    };
    // JSON 模式要求提示词中包含 "json" 字样，仅提取色板时启用
    if (jsonMode) body.response_format = { type: "json_object" };
    try {
      const resp = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + keys.dsKey },
        signal: ctrl.signal,
        body: JSON.stringify(body),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = json.error && json.error.message ? json.error.message : `HTTP ${resp.status}`;
        throw new Error("DeepSeek 调用失败：" + msg);
      }
      return json.choices[0].message.content;
    } finally {
      clearTimeout(timer);
    }
  },

  /**
   * 提取 7×3 色板：把色彩种子图片 + 本地统计的候选色交给 DeepSeek 归纳
   * 返回 3 组 × 7 个 "#rrggbb"
   */
  async extractPalette(keys, seedCanvas, candidateHexes) {
    const img = Util.scaleCanvas(seedCanvas, 768).toDataURL("image/jpeg", 0.85);
    const prompt = [
      "你是一位专业色彩顾问。第一张图是由一位用户的生活照片像素化得到的「色彩种子」马赛克图。",
      "请从中提炼一个 7×3 的和谐色板，要求：",
      "1. 共 3 组、每组恰好 7 个十六进制颜色，按 JSON 数组给出；",
      "2. 第 1 组为暖色调、第 2 组为冷色调或中间调、第 3 组为中性色或大地色，每组内部从深到浅形成渐进；",
      "3. 颜色必须忠实于图片的整体色彩氛围，尽量取自候选列表（允许微调明度与饱和度使过渡更和谐），避免使用纯黑 #000000 或纯白 #ffffff；",
      "4. 只输出 JSON：{\"groups\": [[\"#rrggbb\"×7], [\"#rrggbb\"×7], [\"#rrggbb\"×7]]}。",
      "候选颜色（按出现频次从高到低）：" + candidateHexes.join(", "),
    ].join("\n");

    const text = await API.deepseekChat(keys, [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: img } },
    ]);
    return API.parsePalette(text);
  },

  /** 解析模型返回，做格式校验与兜底 */
  parsePalette(text) {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("模型未返回 JSON");
    const groups = JSON.parse(m[0]).groups;
    if (!Array.isArray(groups) || groups.length !== 3) throw new Error("色板组数不为 3");
    const out = groups.map(g => {
      if (!Array.isArray(g) || g.length !== 7) throw new Error("每组色值数量不为 7");
      return g.map(h => {
        const n = Util.normalizeHex(h);
        if (!n) throw new Error("存在非法色值: " + h);
        return n;
      });
    });
    return out;
  },

  async testDeepSeek(keys) {
    const text = await API.deepseekChat(keys, "回复两个字：成功", { maxTokens: 512, temperature: 0, jsonMode: false });
    return text;
  },

  /**
   * 让 DeepSeek 依据色板的情绪即兴构思一个生活场景（每次不同），
   * 作为第伍步重构指令的创作部分。返回场景描述文本（≤50 字）。
   */
  async composeRebuildScene(keys, paletteCanvas, groups, style) {
    const styleName = { oil: "油画", impression: "印象派", ink: "水墨画", comic: "漫画" }[style] || "油画";
    const img = Util.scaleCanvas(paletteCanvas, 768).toDataURL("image/jpeg", 0.85);
    const prompt = [
      `你是一位艺术指导。这张图片是一块 7×3 的色板（16 进制值依次为：${groups.flat().join("、")}），它承载了一位用户一段生活的情绪与记忆。`,
      `请为图生图模型构思一个与这块色板情绪相符的具象生活场景，用于把一幅抽象画重构成「${styleName}风格」的具象作品。`,
      "要求：1）场景必须具体、有画面感、贴近日常生活（如街道、校园、集市、河岸、老巷、车站、屋顶、菜市场……自由发挥，避免老生常谈）；2）点明时间与光线氛围；3）不超过 50 个字；4）只描述场景与氛围，不要提到颜色、画风或任何约束词。",
      '只输出 JSON：{"scene": "…"}',
    ].join("\n");
    const text = await API.deepseekChat(keys, [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: img } },
    ], { maxTokens: 4096, temperature: 1.3 });
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("模型未返回 JSON");
    const scene = (JSON.parse(m[0]).scene || "").trim();
    if (!scene) throw new Error("场景为空");
    return scene.slice(0, 60);
  },

  /* ═══════════ 火山引擎 V4 签名 ═══════════ */

  _te: new TextEncoder(),

  async _hmac(keyBytes, msg) {
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, API._te.encode(msg));
    return new Uint8Array(sig);
  },

  async _sha256Hex(str) {
    const buf = await crypto.subtle.digest("SHA-256", API._te.encode(str));
    return API._hex(new Uint8Array(buf));
  },

  _hex(buf) {
    let s = "";
    for (const b of buf) s += b.toString(16).padStart(2, "0");
    return s;
  },

  /** 构造签名后的请求头（Region cn-north-1 / Service cv） */
  async _volcHeaders(keys, action, bodyStr) {
    const host = "visual.volcengineapi.com";
    const region = "cn-north-1", service = "cv";
    const query = `Action=${action}&Version=2022-08-31`;
    const xDate = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    const shortDate = xDate.slice(0, 8);
    const bodyHash = await API._sha256Hex(bodyStr);
    const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-content-sha256:${bodyHash}\nx-date:${xDate}\n`;
    const signedHeaders = "content-type;host;x-content-sha256;x-date";
    const canonicalRequest = `POST\n/\n${query}\n${canonicalHeaders}\n${signedHeaders}\n${bodyHash}`;
    const credentialScope = `${shortDate}/${region}/${service}/request`;
    const stringToSign = `HMAC-SHA256\n${xDate}\n${credentialScope}\n${await API._sha256Hex(canonicalRequest)}`;
    const kDate = await API._hmac(API._te.encode(keys.sk), shortDate);
    const kRegion = await API._hmac(kDate, region);
    const kService = await API._hmac(kRegion, service);
    const kSigning = await API._hmac(kService, "request");
    const signature = await API._hmac(kSigning, stringToSign);
    return {
      url: `https://${host}/?${query}`,
      headers: {
        "Content-Type": "application/json",
        "X-Date": xDate,
        "X-Content-Sha256": bodyHash,
        "Authorization": `HMAC-SHA256 Credential=${keys.ak}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${API._hex(signature)}`,
      },
    };
  },

  async _volcPost(keys, action, bodyObj) {
    if (!keys.ak || !keys.sk) throw new Error("请先在右上角「API Key 设置」中填写火山引擎 AccessKeyID 与 SecretAccessKey");
    const bodyStr = JSON.stringify(bodyObj);
    const { url, headers } = await API._volcHeaders(keys, action, bodyStr);
    const resp = await fetch(url, { method: "POST", headers, body: bodyStr });
    const json = await resp.json().catch(() => ({}));
    // 火山以业务码 code=10000 表示成功
    if (json.code !== 10000) {
      const msg = json.message || (json.ResponseMetadata && json.ResponseMetadata.Error && json.ResponseMetadata.Error.Message) || `HTTP ${resp.status}`;
      throw new Error("SeedEdit 调用失败：" + msg);
    }
    return json;
  },

  /* ═══════════ SeedEdit 3.0 图生图 ═══════════ */

  /**
   * 完整图生图：提交任务 → 轮询 → 返回图像 base64
   * @param {HTMLCanvasElement} srcCanvas 输入图
   * @param {string} prompt 编辑指令（建议 ≤120 字）
   * @param {(status:string, elapsed:number)=>void} onPoll 轮询进度回调
   * @param {number} scale 编辑强度 0~1：越大文本影响越大、输入图（色彩/构图）影响越小
   */
  async seedEditGenerate(keys, srcCanvas, prompt, onPoll, scale = 0.5) {
    const b64In = Util.toJpegBase64(srcCanvas, 0.92);
    const submit = await API._volcPost(keys, "CVSync2AsyncSubmitTask", {
      req_key: "seededit_v3.0",
      binary_data_base64: [b64In],
      prompt,
      seed: -1,
      scale,
    });
    const taskId = submit.data && submit.data.task_id;
    if (!taskId) throw new Error("SeedEdit 未返回任务 ID");

    const t0 = Date.now();
    for (let i = 0; i < 80; i++) {
      await new Promise(r => setTimeout(r, i === 0 ? 2000 : 3000));
      const q = await API._volcPost(keys, "CVSync2AsyncGetResult", {
        req_key: "seededit_v3.0",
        task_id: taskId,
        req_json: JSON.stringify({ logo_info: { add_logo: false } }),
      });
      const st = q.data && q.data.status;
      if (typeof onPoll === "function") onPoll(st, (Date.now() - t0) / 1000);
      if (st === "done") {
        const b64 = q.data.binary_data_base64 && q.data.binary_data_base64[0];
        if (!b64) throw new Error("任务完成但未返回图片数据");
        return b64;
      }
      if (st === "not_found" || st === "expired") throw new Error("任务已失效（" + st + "），请重试");
    }
    throw new Error("生成超时（超过 4 分钟），请重试");
  },
};
