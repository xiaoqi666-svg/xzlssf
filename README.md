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


---

## 分享页“结果页同款”更新

本版本已经把 `/s/:id` 的展示模板改成与 APK 请假结果页同一套视觉结构：

- 顶部“请假详情”栏
- 返回箭头
- 请假规则标签
- 学生头像、姓名、已通过
- 请假内容
- 请假去向
- 审批流程
- 审批流程收起 / 展开
- 已同意标签
- 申请人学院
- 底部“更多 / 撤销申请”或“更多 / 续假 / 销假”
- 底部会根据请假开始时间自动切换

同时继续保留一行很轻的“用户分享的只读快照 · 非在线核验”标识。

### 更新方式

把本压缩包中的文件覆盖到原来的 Git 仓库，然后提交。

Pages 设置仍然保持：

```text
Build command: exit 0
Build output directory: public
Root directory: /
```

D1 Binding 仍然保持：

```text
Variable name: DB
Database: SZLSSF
```

Git 提交后触发一次新的 Production deployment 即可。

### 已有分享链接

后端部署后，已有分享链接也会自动使用新的结果页版式。

不过旧 APK 创建的历史分享数据里没有上传“学生性别 / 学院 / 审批人性别”字段，
因此旧链接这些位置会使用默认头像或 `-`。

配合 V2.4 APK 以后新生成的链接，会把这些字段一并上传，展示会更完整。
