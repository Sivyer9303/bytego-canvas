## Why

bytego 画布当前按 OpenAI Videos 协议调用 `POST /v1/videos`（multipart），而 new-api 站内视频工具已把各类视频渠道收口到 `POST /v1/video/generations`（JSON）。Brioi 等渠道会直接拒绝 `/v1/videos`，用户在 new-api 接入的 Wan / minimax / Seedance 等视频模型无法在画布里稳定出片。

## What Changes

- 画布与视频工作台的默认视频生成改为走 new-api 统一入口：创建 `POST /v1/video/generations`，查询 `GET /v1/video/generations/{id}`，下载仍用 `GET /v1/videos/{id}/content`。
- 请求体改为 JSON，携带用户选择的 `generation_type`、画幅、时长、分辨率，以及该玩法允许的图片 / 参考视频 / 参考音频；不再按渠道类型在画布内写 SilkRoad、Brioi 专用适配。
- 视频设置提供玩法选择；画布节点和工作台共用。参考图继续复用现有画布引用，参考视频/音频继续复用已连接节点。
- 渠道编辑里已有的模型调用脚本仍可作为单模型覆盖；未写脚本的视频模型走统一入口。
- 本地 `bun run dev` 不强制 new-api 登录；无脚本的直连 OpenAI 兼容上游若仍只提供 `/v1/videos`，保留回退路径，避免非 new-api 环境完全不可用。
- 不按模型档案限制参考玩法。多数站内视频模型无 `-ref` 限制；少数模型若拒绝参考，展示上游错误即可。

## Capabilities

### New Capabilities

- `newapi-unified-video`: 画布视频生成默认使用 new-api 统一视频入口，覆盖创建、轮询、下载和最小生成参数。

### Modified Capabilities

无。当前仓库尚未建立 `openspec/specs/` 下的既有能力规范。

## Impact

- 前端：`web/src/services/api/video.ts`、画布视频节点提示词面板、视频工作台。
- 不修改 new-api 源码；依赖现有 `/v1/video/generations`、`/v1/video/generations/:id`、`/v1/videos/:id/content`。
- 不读取 `/api/video/models` 来禁用参考图或切换玩法。
- 文档：`CHANGELOG.md` Unreleased、`pending-test`。
