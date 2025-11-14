# Opinion Dynamics Multi-Agent UI

React + Vite 单页应用，用于配置/运行多 Agent 观点演化讨论。前端现在直接调用各家厂商的 HTTPS API（OpenAI / Anthropic / Gemini），不再依赖 Cloudflare Worker 代理。

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

应用默认直接向厂商提供的 HTTPS 入口（例如 `https://api.openai.com/v1`）发起请求；如需切换到自建代理，在“全局模型配置”里修改 Base URL 即可。

## 关于 Cloudflare Worker

仓库仍保留 `worker/` 目录（旧版代理逻辑），但前端已改为直接调用厂商 API，Worker 不再是必需组件。你可以按需删除该目录或将其作为示例，若需要自建代理/缓存层，可参考其中的实现。

## 目录说明

- `src/`：页面、状态管理、对话编排、ECharts 可视化等核心功能。
- `worker/src/index.ts`（可选）：旧版 Cloudflare Worker 代理实现，现已不再默认启用。
- `worker/wrangler.toml`：Worker 配置文件，仅在需要自建代理时参考。
- `.gitignore` 已忽略 `dist/`、`node_modules/` 等生成目录。

## 常见问题

- **测试连通失败**：确认在配置页中填入的 API Key / Base URL 正确且对应供应商允许来自浏览器的请求；如需避免 CORS，可改用自建代理。
- **跨域报错**：部分官方 API（如 OpenAI）默认不开放浏览器跨域访问，需使用自建代理或在后端转发。
- **ECharts 包体积提示**：构建时可能收到 >500 kB 警告，可按需拆分（动态导入）或忽略。

完成以上配置后，即可在任何静态托管环境部署前端，并直接使用各家 LLM API（或自行接入代理层）。