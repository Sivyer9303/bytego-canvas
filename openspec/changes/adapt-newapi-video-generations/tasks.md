## 1. Unified video client

- [x] 1.1 在 `web/src/services/api/video.ts` 增加 new-api 统一入口：JSON `POST /v1/video/generations` 创建、`GET /v1/video/generations/{id}` 轮询，完成时拉 `GET /v1/videos/{id}/content` 或响应 URL
- [x] 1.2 组装与站内视频工具一致的请求体：`model`、`prompt`、`generation_type`、`aspect_ratio`、`seconds`/`duration`、`resolution`、`generate_audio`、`media[]`；无图用文生、有参考图用图生
- [x] 1.3 用 `isNewApiAuthEnabled()` 分支：开启走统一入口，关闭保持现有 multipart `POST /v1/videos`；有模型脚本时仍只跑脚本

## 2. Canvas and workbench

- [x] 2.1 画布视频节点把现有参考图传入统一入口 `media`，尺寸映射为 `aspect_ratio`，时长映射为 `seconds`
- [x] 2.2 视频工作台走同一套 create/poll，避免工作台仍打 `/v1/videos`
- [x] 2.3 若画布已有可引用的视频/音频节点，一并写入 `media`；没有则不发送，不做新的上传器

## 3. Docs and verification

- [x] 3.1 更新 `CHANGELOG.md` Unreleased 与 `pending-test`：new-api 模式下视频走统一入口，本地 dev 仍可 `/v1/videos`
- [ ] 3.2 用站内视频分组 Token 实测文生与图生；本地 `bun run dev` 确认无脚本模型仍走 `/v1/videos`

