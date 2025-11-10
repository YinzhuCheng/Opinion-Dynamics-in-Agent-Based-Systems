# Opinion Dynamics Multi-Agent UI

React + Vite 单页应用，用于配置/运行多 Agent 观点演化讨论；同仓库内包含 Cloudflare Worker 代理，实现 OpenAI / Anthropic / Gemini 的统一调用。

```
.
├── src/                 # React 应用源码
├── public/
├── worker/              # Cloudflare Worker 代理
│   ├── wrangler.toml
│   └── src/index.ts
└── package.json         # 前端工程
```

## 本地开发

```bash
npm install
npm run dev    # http://localhost:5173
```

构建预览：

```bash
npm run build
npm run preview
```

## Cloudflare Pages 部署

仓库根目录就是前端项目，无需额外子目录配置，在 Pages 控制台填写：

| Setting               | Value                       |
|----------------------|-----------------------------|
| Framework preset     | Vite（或 None，二者皆可）     |
| Build command        | `npm run build`             |
| Build output directory | `dist`                    |
| Root directory       | *(留空)*                    |

如需在 Preview/Production 环境下指定 Worker 域名，可在 Pages 中新增环境变量：

```
Name: VITE_API_BASE
Value: https://<your-worker>.workers.dev
```

若已给 Worker 配置同域路由（例如 `app.example.com/api/llm*`），前端默认的 `/api/llm` 即可直接使用，无需额外变量。

## Cloudflare Worker 代理

`worker/` 目录包含代理源码与 `wrangler.toml`，本地（或 CI）执行：

```bash
cd worker
npm install            # 一次即可
npx wrangler dev       # 可选，本地调试
npx wrangler publish   # 发布到 Cloudflare
```

发布后可在 Cloudflare Dashboard → Workers → 选择该 Worker → Triggers 为生产域名添加路由（推荐）：

```
Route pattern:  your-domain.com/api/llm*
Environment:    Production
```

这样前端的 `/api/llm` 请求会被自动代理；否则使用 `workers.dev` 域名并在前端设置 `VITE_API_BASE`。

## 目录说明

- `src/`：页面、状态管理、对话编排、ECharts 可视化等核心功能。
- `worker/src/index.ts`：统一代理上游，处理重试、错误码与 CORS。
- `worker/wrangler.toml`：Worker 配置，发布时无须修改。
- `.gitignore` 已忽略 `dist/`、`node_modules/` 等生成目录。

## 常见问题

- **测试连通失败**：确认在配置页中填入的 API Key 正确且 Worker 已部署。
- **跨域报错**：Worker 响应头已允许 `*`，若自行限制域来源需同步调整。
- **ECharts 包体积提示**：构建时可能收到 >500 kB 警告，可按需拆分（动态导入）或忽略。

完成以上配置后，即可在 Cloudflare Pages 上一键构建前端，并通过 Worker 安全转发三方大模型请求。*** End Patch
