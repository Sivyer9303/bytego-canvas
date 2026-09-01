## Context

画布视频默认实现在 `web/src/services/api/video.ts`：无脚本时，new-api 模式走 JSON `POST /v1/video/generations`，本地未开认证时仍走 multipart `POST /v1/videos`。有参考图就发 `image2video` 并带上 `media`，没有就发 `text2video`。站内视频工具另有模型档案和 `-ref` 玩法限制；画布不跟这套走。

约束：不改 new-api；画布仍用现有 Token 渠道的 `baseUrl`（同源 origin）和 API Key；不按上游品牌写适配器。

## Goals / Non-Goals

### Goals

- 在 new-api 挂载（`/huabu/` 或 `VITE_NEWAPI_AUTH=true`）下，无自定义脚本的视频生成走统一入口，覆盖站内已接入的视频渠道。
- 画布视频节点与视频工作台能提交文生视频，有参考图时提交图生视频。
- 保留模型调用脚本覆盖，以及非 new-api 环境下的 `/v1/videos` 回退。

### Non-Goals

- 不在画布内实现 SilkRoad / Brioi / CompatVideo / AIStarsLab 各自协议。
- 不搬站内视频工具完整 UI，也不按 `/api/video/models` 限制 `-ref` / 参考玩法。多数常用视频模型无此限制；少数模型拒绝参考时展示上游错误。
- 不修改 new-api 分组、渠道类型或视频工具前端。
- 不把视频任务状态做成独立云端任务中心。

## Decisions

### 1. 默认走统一入口，而不是继续扩 `/v1/videos` 兼容层

new-api 已把渠道差异收在 `/v1/video/generations`。画布只对接这一层。继续用 OpenAI Videos 表单无法覆盖 Brioi，也会丢掉 `generation_type`。

备选：为每个模型写调用脚本。否决：无法随 Token 同步规模化。

### 2. 用 `isNewApiAuthEnabled()` 选择协议

- 开启 new-api 认证：创建/查询用 `/v1/video/generations`；下载仍用 `/v1/videos/{id}/content`。
- 未开启：保持现有 `POST /v1/videos` multipart，避免本地直连 OpenAI 类上游回归。
- 模型脚本存在时：仍走脚本，不强制统一入口。

### 3. JSON 字段对齐视频工具 `buildVideoGenerationRequest`

最小必填：`model`、`prompt`、`generation_type`、`aspect_ratio`，以及 `seconds` 或 `duration`。`generation_type` 由用户在视频设置中选择，默认 `text2video`。可选玩法与站内视频工具一致：`text2video`、`image2video`、`multi_image`、`start_end`、`reference_audio`、`reference_videos`。提交前按所选玩法校验参考图/视频/音频数量；`start_end` 的两张图按顺序写入 `first_frame` / `last_frame`。数量不符时返回错误，不得按素材自动改玩法。不根据 `/api/video/models` 或 `-ref` 后缀改玩法。`media.source` 必须是 `/v1/video/input-assets` 上传后的 HTTPS 地址，不把 data URL 放进生成请求体。分辨率沿用现有 `vquality`。不发送 `generate_audio`：Brioi 会把未知字段直接 400。

画布已连接的参考视频 / 音频有则写入 `media`，没有则不发，不做新上传器。画幅/时长用现有控件做近似映射（如 `1280x720` → `16:9`）。

不读取 `/api/video/models` 来禁用参考或改玩法。

### 4. 轮询仍由画布执行

统一入口仍是异步任务。保持现有 create + poll 循环，只改 URL 和响应解包。不要把轮询搬到 new-api 控制台。

## Risks / Trade-offs

- [风险] 少数 `-ref` 模型拒绝参考或文生 → [缓解] 展示上游错误，不在画布按模型名禁用参考。
- [风险] 画幅/时长映射不准导致 400 → [缓解] 映射表集中在一处；用户可在节点上改尺寸和秒数。
- [风险] 大图 data URL 撑爆 JSON → [缓解] 沿用现有参考图数量上限；必要时后续再接 `/v1/video/input-assets`。
- [风险] 本地直连 `/v1/videos` 与生产统一入口分叉 → [缓解] 用认证开关明确分支，文档写清。

## Migration Plan

1. 改 `video.ts` 增加统一入口客户端，new-api 模式下切换 create/poll。
2. 画布视频节点与视频工作台提供玩法选择，并按所选 `generation_type` 组装 `media`。
3. 用 new-api 视频分组 Token 实测文生/图生；本地 `bun run dev` 回归 `/v1/videos`。
4. 回滚：还原画布前端即可，new-api 无数据迁移。

## Open Questions

无。
