const DEFAULT_EXPIRES_SECONDS = 7 * 24 * 60 * 60;
const MIN_EXPIRES_SECONDS = 60 * 60;
const MAX_EXPIRES_SECONDS = 30 * 24 * 60 * 60;
const MAX_BODY_BYTES = 24 * 1024;

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (error) {
      console.error(error);
      return json(
        { success: false, error: "internal_error", message: "服务器处理请求时发生错误" },
        500
      );
    }
  }
};

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (request.method === "GET" && path === "/") {
    return html(homePage());
  }

  if (request.method === "GET" && path === "/health") {
    return json({
      success: true,
      service: "today-campus-share",
      time: new Date().toISOString()
    });
  }

  if (request.method === "POST" && path === "/api/share") {
    return createShare(request, env);
  }

  const apiMatch = path.match(/^\/api\/share\/([A-Za-z0-9_-]{12,80})$/);
  if (apiMatch) {
    const id = apiMatch[1];
    if (request.method === "GET") return getShareJson(id, env);
    if (request.method === "DELETE") return revokeShare(id, request, env);
  }

  const shareMatch = path.match(/^\/s\/([A-Za-z0-9_-]{12,80})$/);
  if (request.method === "GET" && shareMatch) {
    return showSharePage(shareMatch[1], env);
  }

  return json(
    { success: false, error: "not_found", message: "接口不存在" },
    404
  );
}

async function createShare(request, env) {
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader && Number(lengthHeader) > MAX_BODY_BYTES) {
    return json(
      { success: false, error: "payload_too_large", message: "提交的数据过大" },
      413
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json(
      { success: false, error: "invalid_json", message: "请求内容不是有效 JSON" },
      400
    );
  }

  const validation = normalizeSharePayload(body);
  if (!validation.ok) {
    return json(
      { success: false, error: "invalid_payload", message: validation.message },
      400
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresIn = normalizeExpiresIn(body.expiresIn);
  const expiresAt = expiresIn === null ? null : now + expiresIn;

  const id = randomToken(18);
  const manageToken = randomToken(32);
  const manageTokenHash = await sha256Hex(manageToken);

  await env.DB.prepare(
    `INSERT INTO shares
      (id, data, created_at, expires_at, revoked, manage_token_hash)
     VALUES (?, ?, ?, ?, 0, ?)`
  ).bind(
    id,
    JSON.stringify(validation.data),
    now,
    expiresAt,
    manageTokenHash
  ).run();

  const origin =
    normalizeBaseUrl(env.SHARE_BASE_URL) || new URL(request.url).origin;

  return json(
    {
      success: true,
      shareId: id,
      url: `${origin}/s/${id}`,
      manageToken,
      createdAt: now,
      expiresAt
    },
    201
  );
}

async function getShareJson(id, env) {
  const result = await readShare(id, env);
  if (!result.ok) {
    return json(
      { success: false, error: result.error, message: result.message },
      result.status
    );
  }

  return json({
    success: true,
    id,
    data: result.data,
    createdAt: result.row.created_at,
    expiresAt: result.row.expires_at
  });
}

async function revokeShare(id, request, env) {
  const token = readBearerToken(request);
  if (!token) {
    return json(
      { success: false, error: "missing_manage_token", message: "缺少管理凭证" },
      401
    );
  }

  const row = await env.DB.prepare(
    `SELECT manage_token_hash, revoked
     FROM shares
     WHERE id = ?
     LIMIT 1`
  ).bind(id).first();

  if (!row) {
    return json(
      { success: false, error: "not_found", message: "分享不存在" },
      404
    );
  }

  const tokenHash = await sha256Hex(token);
  if (!timingSafeEqual(tokenHash, String(row.manage_token_hash || ""))) {
    return json(
      { success: false, error: "invalid_manage_token", message: "管理凭证无效" },
      403
    );
  }

  if (Number(row.revoked) === 1) {
    return json({ success: true, revoked: true, alreadyRevoked: true });
  }

  await env.DB.prepare(
    `UPDATE shares SET revoked = 1 WHERE id = ?`
  ).bind(id).run();

  return json({ success: true, revoked: true });
}

async function showSharePage(id, env) {
  const result = await readShare(id, env);

  if (!result.ok) {
    const title =
      result.error === "expired" ? "分享已过期" :
      result.error === "revoked" ? "分享已撤销" :
      "分享不存在";

    return html(statusPage(title, result.message), result.status);
  }

  return html(renderSharePage(result.data, result.row), 200, {
    "cache-control": "private, no-store, max-age=0"
  });
}

async function readShare(id, env) {
  const row = await env.DB.prepare(
    `SELECT data, created_at, expires_at, revoked
     FROM shares
     WHERE id = ?
     LIMIT 1`
  ).bind(id).first();

  if (!row) {
    return {
      ok: false,
      status: 404,
      error: "not_found",
      message: "这条分享链接不存在"
    };
  }

  if (Number(row.revoked) === 1) {
    return {
      ok: false,
      status: 410,
      error: "revoked",
      message: "创建者已经撤销了这条分享"
    };
  }

  const now = Math.floor(Date.now() / 1000);
  if (
    row.expires_at !== null &&
    row.expires_at !== undefined &&
    Number(row.expires_at) > 0 &&
    now > Number(row.expires_at)
  ) {
    return {
      ok: false,
      status: 410,
      error: "expired",
      message: "这条分享已经超过有效期"
    };
  }

  let data;
  try {
    data = JSON.parse(row.data);
  } catch {
    return {
      ok: false,
      status: 500,
      error: "invalid_server_data",
      message: "分享数据损坏"
    };
  }

  return { ok: true, row, data };
}

function normalizeSharePayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "提交内容格式不正确" };
  }

  const name = clean(body.name, 40);
  const leaveType = clean(body.leaveType, 30);
  const startTime = clean(body.startTime, 50);
  const endTime = clean(body.endTime, 50);

  if (!name) return { ok: false, message: "缺少请假学生姓名" };
  if (!leaveType) return { ok: false, message: "缺少请假类型" };
  if (!startTime || !endTime) {
    return { ok: false, message: "缺少请假开始或结束时间" };
  }

  const leaveSchool = body.leaveSchool === "是" ? "是" : "否";

  const data = {
    name,
    leaveType,
    startTime,
    endTime,
    duration: clean(body.duration, 50),
    course: clean(body.course, 120),
    reason: clean(body.reason, 600),
    material: clean(body.material, 200),
    location: clean(body.location, 120),
    leaveSchool,
    applyTime: clean(body.applyTime, 50),
    approverName: clean(body.approverName, 40),
    approverRole: clean(body.approverRole, 60),
    approvalTime: clean(body.approvalTime, 50),
    approvalNote: clean(body.approvalNote, 300)
  };

  if (leaveSchool === "是") {
    data.destination = clean(body.destination, 120);
    data.detailedAddress = clean(body.detailedAddress, 240);

    if (body.shareContactDetails === true) {
      data.emergencyContact = clean(body.emergencyContact, 60);
      data.contactPhone = clean(body.contactPhone, 60);
    }
  }

  return { ok: true, data };
}

function normalizeExpiresIn(value) {
  if (value === 0 || value === "0") return null;

  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_EXPIRES_SECONDS;

  return Math.max(
    MIN_EXPIRES_SECONDS,
    Math.min(Math.floor(n), MAX_EXPIRES_SECONDS)
  );
}

function clean(value, maxLength) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, maxLength);
}

function randomToken(bytes = 18) {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);

  let binary = "";
  for (const b of array) binary += String.fromCharCode(b);

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return diff === 0;
}

function readBearerToken(request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (match) return match[1].trim();

  const fallback = request.headers.get("x-manage-token");
  return fallback ? fallback.trim() : "";
}

function renderSharePage(data, row) {
  const fields = [
    ["请假学生", data.name],
    ["请假类型", data.leaveType],
    ["开始时间", data.startTime],
    ["结束时间", data.endTime],
    ["请假时长", data.duration],
    ["影响课程", data.course],
    ["请假原因", data.reason],
    ["证明材料", data.material],
    ["发起位置", data.location],
    ["是否离校", data.leaveSchool]
  ];

  if (data.leaveSchool === "是") {
    fields.push(
      ["目的地", data.destination],
      ["详细地址", data.detailedAddress]
    );

    if (data.emergencyContact) {
      fields.push(["紧急联系人", data.emergencyContact]);
    }

    if (data.contactPhone) {
      fields.push(["联系电话", data.contactPhone]);
    }
  }

  fields.push(
    ["申请时间", data.applyTime],
    ["审批人", data.approverName],
    ["审批人身份", data.approverRole],
    ["审批时间", data.approvalTime],
    ["审批意见", data.approvalNote]
  );

  const fieldHtml = fields
    .filter(([, value]) => value && value !== "-")
    .map(
      ([label, value]) => `
        <div class="row">
          <div class="label">${escapeHtml(label)}</div>
          <div class="value">${nl2br(escapeHtml(value))}</div>
        </div>`
    )
    .join("");

  const createdText = formatUnixTime(row.created_at);
  const expireText = row.expires_at
    ? formatUnixTime(row.expires_at)
    : "永久有效（除非创建者撤销）";

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <meta name="referrer" content="no-referrer">
  <title>请假信息分享</title>
  <style>
    *{box-sizing:border-box}
    body{
      margin:0;background:#f4f6f9;color:#24272b;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif
    }
    .page{width:min(100%,560px);margin:0 auto;padding:22px 14px 42px}
    .head{padding:22px 18px;border-radius:16px 16px 0 0;background:#2f62e8;color:#fff}
    .head h1{margin:0;font-size:22px;line-height:1.3}
    .head p{margin:7px 0 0;opacity:.82;font-size:12px;line-height:1.6}
    .card{overflow:hidden;border-radius:0 0 16px 16px;background:#fff;box-shadow:0 9px 30px rgba(31,54,90,.08)}
    .status{display:flex;align-items:center;gap:8px;padding:17px 18px;border-bottom:1px solid #eef1f5;font-size:16px;font-weight:700}
    .dot{width:10px;height:10px;border-radius:50%;background:#27b36a}
    .row{display:grid;grid-template-columns:106px minmax(0,1fr);gap:12px;padding:14px 18px;border-bottom:1px solid #f0f2f5}
    .label{color:#8b929a;font-size:13px}
    .value{color:#25292e;font-size:13px;line-height:1.65;word-break:break-word;text-align:right}
    .meta{margin-top:14px;padding:15px 17px;border-radius:14px;background:#fff;color:#8b9299;font-size:11px;line-height:1.75;box-shadow:0 5px 20px rgba(31,54,90,.05)}
    .notice{margin-top:14px;padding:14px 16px;border:1px solid #e5e9ef;border-radius:13px;background:#fafbfc;color:#6f7780;font-size:11.5px;line-height:1.7}
  </style>
</head>
<body>
  <main class="page">
    <section class="head">
      <h1>请假信息分享</h1>
      <p>用户创建的只读信息快照</p>
    </section>
    <section class="card">
      <div class="status">
        <span class="dot"></span>
        <span>状态：已通过</span>
      </div>
      ${fieldHtml}
    </section>
    <section class="meta">
      创建时间：${escapeHtml(createdText)}<br>
      有效期至：${escapeHtml(expireText)}
    </section>
    <section class="notice">
      本页面展示的是用户主动分享的只读信息快照，
      不代表学校、单位或其他机构的在线核验结果，
      也不应被视为官方证明材料。
    </section>
  </main>
</body>
</html>`;
}

function statusPage(title, message) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <title>${escapeHtml(title)}</title>
  <style>
    *{box-sizing:border-box}
    body{
      margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
      padding:24px;background:#f4f6f9;color:#30343a;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif
    }
    .card{width:min(100%,420px);padding:28px 22px;border-radius:16px;background:#fff;text-align:center;box-shadow:0 10px 32px rgba(31,54,90,.08)}
    h1{margin:0;font-size:20px}
    p{margin:10px 0 0;color:#8b929a;font-size:13px;line-height:1.7}
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>`;
}

function homePage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Share Service</title>
  <style>
    body{margin:0;padding:40px 20px;background:#f4f6f9;color:#29313a;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
    main{max-width:640px;margin:auto;padding:28px;background:#fff;border-radius:16px;box-shadow:0 10px 30px rgba(31,54,90,.08)}
    h1{margin-top:0}
    code{padding:2px 5px;border-radius:5px;background:#f0f2f5}
  </style>
</head>
<body>
  <main>
    <h1>Today Campus Share Service</h1>
    <p>分享服务运行正常。</p>
    <p>健康检查：<code>GET /health</code></p>
    <p>创建分享：<code>POST /api/share</code></p>
  </main>
</body>
</html>`;
}

function formatUnixTime(seconds) {
  if (!seconds) return "-";
  return new Date(Number(seconds) * 1000).toISOString();
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders(),
      ...extraHeaders
    }
  });
}

function html(content, status = 200, extraHeaders = {}) {
  return new Response(content, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store, max-age=0",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      ...extraHeaders
    }
  });
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "Content-Type, Authorization, X-Manage-Token",
    "access-control-max-age": "86400"
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function nl2br(value) {
  return String(value).replace(/\n/g, "<br>");
}

function normalizeBaseUrl(value) {
  if (!value) return "";

  try {
    const url = new URL(String(value).trim());
    if (url.protocol !== "https:") return "";
    return url.origin;
  } catch {
    return "";
  }
}
