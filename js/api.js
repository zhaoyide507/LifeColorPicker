/* ═══════════ 采色生活 · 模型调用 ═══════════
 * DeepSeek  : https://api.deepseek.com  （色板提取，多模态 + JSON 输出）
 * SeedEdit 3.0 : https://visual.volcengineapi.com （图生图，火山 V4 签名，提交任务 + 轮询）
 * 两种调用均由浏览器直连，Key 只存放在用户本地。
 */
"use strict";

/* ── 纯 JS SHA-256 / HMAC 兜底 ──
 * crypto.subtle 仅在安全上下文（HTTPS / localhost）可用；
 * 通过 http://局域网IP 等方式打开页面时自动改用这里的纯 JS 实现。 */
const PureCrypto = (() => {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  function hashBytes(bytes) {
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const len = bytes.length;
    const withPad = ((len + 9 + 63) >> 6) << 6;
    const m = new Uint8Array(withPad);
    m.set(bytes);
    m[len] = 0x80;
    const dv = new DataView(m.buffer);
    dv.setUint32(withPad - 8, Math.floor(len * 8 / 4294967296), false);
    dv.setUint32(withPad - 4, (len * 8) >>> 0, false);
    const w = new Uint32Array(64);
    for (let off = 0; off < withPad; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
      for (let i = 16; i < 64; i++) {
        const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
        const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const mj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + mj) >>> 0;
        h = g; g = f; f = e;
        e = (d + t1) >>> 0;
        d = c; c = b; b = a;
        a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    const out = new Uint8Array(32);
    const odv = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i], false);
    return out;
  }

  function concat(a, b) {
    const out = new Uint8Array(a.length + b.length);
    out.set(a); out.set(b, a.length);
    return out;
  }

  function hmac(keyBytes, msgBytes) {
    const BLOCK = 64;
    let k = keyBytes;
    if (k.length > BLOCK) k = hashBytes(k);
    const ipad = new Uint8Array(BLOCK), opad = new Uint8Array(BLOCK);
    for (let i = 0; i < BLOCK; i++) {
      const b = k[i] || 0;
      ipad[i] = b ^ 0x36;
      opad[i] = b ^ 0x5c;
    }
    return hashBytes(concat(opad, hashBytes(concat(ipad, msgBytes))));
  }

  return { hashBytes, hmac };
})();

const API = {

  /* 同源代理通道（由 server.py 提供）：http/https 访问页面时优先走代理，
   * 规避手机等非安全上下文环境的跨域/预检限制；file:// 直开时为 null，浏览器直连。 */
  _proxy: (location.protocol === "http:" || location.protocol === "https:")
    ? new URL("proxy/", location.href).href
    : null,

  /** POST 一段 JSON：优先同源代理，失败自动回退浏览器直连 */
  async _postJSON(directUrl, proxyUrl, headers, bodyStr) {
    const attempts = [];
    if (API._proxy && proxyUrl) attempts.push({ url: proxyUrl, via: "代理" });
    attempts.push({ url: directUrl, via: "直连" });

    let lastErr = null;
    for (const a of attempts) {
      try {
        const resp = await fetch(a.url, { method: "POST", headers, body: bodyStr });
        const json = await resp.json().catch(() => ({}));
        // 代理通道本身不可用（如用旧版 http.server 托管时 404/501）→ 换下一通道
        if (!resp.ok && resp.status !== 401 && resp.status !== 403 && !json.code && !json.error && !json.ResponseMetadata) {
          lastErr = new Error("HTTP " + resp.status + "（" + a.via + "）");
          continue;
        }
        return json;
      } catch (e) {
        lastErr = e;
      }
    }
    const detail = lastErr && lastErr.message === "Failed to fetch"
      ? "：设备网络无法访问模型服务商，或请求被拦截。请确认手机可上外网，或改用 `python server.py` 启动本站以走本地代理通道"
      : (lastErr ? "：" + lastErr.message : "");
    throw new Error("网络请求失败" + detail);
  },

  /* ═══════════ DeepSeek ═══════════ */

  async deepseekChat(keys, content, { maxTokens = 8192, temperature = 0.4, jsonMode = true } = {}) {
    if (!keys.dsKey) throw new Error("请先在右上角「API Key 设置」中填写 DeepSeek API Key");
    const body = {
      model: "deepseek-flash",                    // DeepSeek-V4.1-Flash
      messages: [{ role: "user", content }],
      max_tokens: maxTokens,
      temperature,
    };
    // JSON 模式要求提示词中包含 "json" 字样，仅提取色板时启用
    if (jsonMode) body.response_format = { type: "json_object" };
    const bodyStr = JSON.stringify(body);
    const headers = { "Content-Type": "application/json", "Authorization": "Bearer " + keys.dsKey };
    const json = await API._postJSON(
      "https://api.deepseek.com/chat/completions",
      API._proxy ? API._proxy + "deepseek" : null,
      headers,
      bodyStr,
    );
    if (json.error) throw new Error("DeepSeek 调用失败：" + (json.error.message || "未知错误"));
    return json.choices[0].message.content;
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

  /** crypto.subtle 仅存在于安全上下文；不可用时走 PureCrypto 兜底 */
  _hasSubtle() {
    return typeof crypto !== "undefined" && !!crypto.subtle;
  },

  async _hmac(keyBytes, msg) {
    const msgBytes = API._te.encode(msg);
    if (API._hasSubtle()) {
      const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const sig = await crypto.subtle.sign("HMAC", key, msgBytes);
      return new Uint8Array(sig);
    }
    return PureCrypto.hmac(keyBytes, msgBytes);
  },

  async _sha256Hex(str) {
    const bytes = API._te.encode(str);
    if (API._hasSubtle()) {
      const buf = await crypto.subtle.digest("SHA-256", bytes);
      return API._hex(new Uint8Array(buf));
    }
    return API._hex(PureCrypto.hashBytes(bytes));
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
    const query = `Action=${action}&Version=2022-08-31`;
    const { url, headers } = await API._volcHeaders(keys, action, bodyStr);
    const json = await API._postJSON(url, API._proxy ? API._proxy + "volcano?" + query : null, headers, bodyStr);
    // 火山以业务码 code=10000 表示成功
    if (json.code !== 10000) {
      const msg = json.message || (json.ResponseMetadata && json.ResponseMetadata.Error && json.ResponseMetadata.Error.Message) || "未知错误";
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
