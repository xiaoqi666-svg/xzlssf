# xzlssf Pages Functions 后端

这是适配 `https://xzlssf.pages.dev` 的 Cloudflare Pages Functions Advanced Mode 版本。

## Git 仓库结构

```text
/
├─ public/
│  ├─ _worker.js
│  ├─ index.html
│  └─ test.html
├─ schema.sql
├─ wrangler.jsonc
├─ package.json
└─ README.md
```

## 1. 上传到 Git

把压缩包里的内容放到你现有 `xzlssf` Git 仓库根目录。

请不要再使用旧 Worker 项目的：

```text
src/index.js
```

Pages Functions 这一版真正运行的是：

```text
public/_worker.js
```

## 2. Pages 构建设置

进入 Cloudflare 的 `xzlssf.pages.dev` Pages 项目。

设置：

```text
Production branch: main
Build command: exit 0
Build output directory: public
Root directory: /
```

不要设置：

```text
npx wrangler deploy
```

那个是 Worker 项目的部署方式，不是这里的 Pages Git 部署设置。

## 3. D1 Binding

进入：

```text
Workers & Pages
→ xzlssf（Pages 项目）
→ Settings
→ Bindings
→ Add
→ D1 database
```

填写：

```text
Variable name: DB
D1 database: SZLSSF
```

Production 和 Preview 如果可以分别配置，建议都绑定。

添加或修改 Binding 后，需要重新部署一次 Pages 项目才能生效。

数据库已经执行过 `schema.sql` 的话，不需要重新建表。

## 4. 部署后测试

健康检查：

```text
https://xzlssf.pages.dev/health
```

正常返回：

```json
{
  "success": true,
  "service": "today-campus-share",
  "time": "..."
}
```

然后浏览器打开：

```text
https://xzlssf.pages.dev/test.html
```

点击：

```text
创建测试分享
```

如果成功，会返回：

```json
{
  "success": true,
  "shareId": "...",
  "url": "https://xzlssf.pages.dev/s/...",
  "manageToken": "..."
}
```

点击生成的 URL，应当看到只读请假信息分享页。

## 5. API

创建：

```text
POST /api/share
```

查看 JSON：

```text
GET /api/share/:id
```

打开分享页：

```text
GET /s/:id
```

撤销：

```text
DELETE /api/share/:id
Authorization: Bearer <manageToken>
```

## 6. APK 后续接入地址

正式 APK 后端地址使用：

```text
https://xzlssf.pages.dev
```

创建分享：

```text
https://xzlssf.pages.dev/api/share
```

分享页面：

```text
https://xzlssf.pages.dev/s/<shareId>
```

## 7. 注意

分享页面明确标注为用户主动分享的只读信息快照，不代表学校或其他机构在线核验。

联系电话和紧急联系人默认不会保存到服务器；只有客户端显式选择分享联系方式时才上传。
