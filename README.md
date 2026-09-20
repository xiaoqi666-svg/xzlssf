# Today Campus Share Backend

这是一个基于 Cloudflare Workers + D1 的请假信息分享后端。

## 功能

- 创建分享链接
- 查询分享 JSON
- 浏览器打开只读分享页
- 设置分享有效期
- 支持永久分享
- 支持撤销分享
- 随机 shareId
- 随机 manageToken
- D1 只保存 manageToken 的 SHA-256 哈希
- HTML 转义，降低 XSS 风险
- `noindex`、`no-store`、CSP 等基础安全头
- “是否离校=否”时不保存目的地等内容
- 联系方式默认不保存，只有显式 `shareContactDetails: true` 才会保存

## 1. 安装依赖

```bash
npm install
```

登录 Cloudflare：

```bash
npx wrangler login
```

## 2. 创建 D1

```bash
npx wrangler d1 create today-campus-share-db
```

Cloudflare 会返回一个 `database_id`。

打开 `wrangler.jsonc`，把：

```json
"database_id": "REPLACE_WITH_YOUR_D1_DATABASE_ID"
```

替换成真实的数据库 ID。

## 3. 初始化数据库

远程：

```bash
npm run db:migrate:remote
```

本地开发：

```bash
npm run db:migrate:local
```

## 4. 本地运行

```bash
npm run dev
```

## 5. 部署

```bash
npm run deploy
```

部署成功后会得到类似：

```text
https://today-campus-share.<你的子域>.workers.dev
```

健康检查：

```text
GET /health
```

## 6. API

### 创建分享

```http
POST /api/share
Content-Type: application/json
```

示例：

```json
{
  "name": "张三",
  "leaveType": "事假",
  "startTime": "2026-09-20 14:00",
  "endTime": "2026-09-21 18:00",
  "duration": "1天4时0分",
  "course": "无",
  "reason": "个人事务",
  "material": "无",
  "location": "校内",
  "leaveSchool": "否",
  "applyTime": "2026-09-20 13:20",
  "approverName": "李老师",
  "approverRole": "辅导员",
  "approvalTime": "2026-09-20 13:35",
  "approvalNote": "同意",
  "expiresIn": 604800
}
```

`expiresIn` 单位为秒：

```text
3600       = 1 小时
86400      = 1 天
604800     = 7 天
2592000    = 30 天
0          = 永久
```

创建成功响应：

```json
{
  "success": true,
  "shareId": "随机ID",
  "url": "https://xxx.workers.dev/s/随机ID",
  "manageToken": "随机管理Token",
  "createdAt": 1789900000,
  "expiresAt": 1790504800
}
```

`manageToken` 只应该保存在创建者手机本地。

### 获取分享 JSON

```http
GET /api/share/:id
```

### 浏览器打开分享页

```text
GET /s/:id
```

### 撤销分享

```http
DELETE /api/share/:id
Authorization: Bearer <manageToken>
```

也支持：

```http
X-Manage-Token: <manageToken>
```

## 7. 离校信息

如果：

```json
"leaveSchool": "否"
```

后端不会保存：

- destination
- detailedAddress
- emergencyContact
- contactPhone

如果：

```json
"leaveSchool": "是"
```

可以发送：

```json
{
  "destination": "北京市",
  "detailedAddress": "具体地址"
}
```

联系方式默认不会保存。

如果用户主动选择同时分享联系方式，才发送：

```json
{
  "shareContactDetails": true,
  "emergencyContact": "张某",
  "contactPhone": "13800000000"
}
```

## 8. 自定义域名

如果你之后绑定：

```text
https://share.example.com
```

可以把 `wrangler.jsonc` 里的：

```json
"SHARE_BASE_URL": ""
```

改成：

```json
"SHARE_BASE_URL": "https://share.example.com"
```

这样 API 返回的分享链接就会固定使用你的域名。

如果保持空字符串，则自动使用当前 Worker 的访问域名。

## 9. APK 对接

APK 需要 Android 网络权限：

```xml
<uses-permission android:name="android.permission.INTERNET" />
```

创建分享：

```javascript
const response = await fetch(
  "https://你的Worker地址/api/share",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: "张三",
      leaveType: "事假",
      startTime: "2026-09-20 14:00",
      endTime: "2026-09-21 18:00",
      leaveSchool: "否",
      expiresIn: 604800
    })
  }
);

const result = await response.json();

console.log(result.url);
console.log(result.manageToken);
```

App 本地建议保存：

```text
shareId
shareUrl
manageToken
```

撤销：

```javascript
await fetch(
  `https://你的Worker地址/api/share/${shareId}`,
  {
    method: "DELETE",
    headers: {
      "Authorization": `Bearer ${manageToken}`
    }
  }
);
```

## 10. 隐私建议

分享信息一旦上传，就不再只是本机数据。

建议：

- 默认 7 天有效
- 联系电话默认不分享
- 紧急联系人默认不分享
- 创建分享前向用户显示“即将上传的字段”
- 支持一键撤销
- 正式对外使用前更新隐私政策

分享页已经明确标注：

> 本页面展示的是用户主动分享的只读信息快照，不代表学校、单位或其他机构的在线核验结果，也不应被视为官方证明材料。

## 11. 正式公开使用前建议

如果用户量变大，再增加：

- Cloudflare Rate Limiting / WAF
- 定时清理过期数据
- 日志与异常监控
- 自定义域名
- 进一步的创建接口防滥用机制
