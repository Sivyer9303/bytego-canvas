## 1. Unified video client

- [x] 1.1 在 `web/src/services/api/video.ts` 增加 new-api 统一入口：JSON `POST /v1/video/generations` 创建、`GET /v1/video/generations/{id}` 轮询，完成时拉 `GET /v1/videos/{id}/content` 或响应 URL
- [x] 1.2 组装与站内视频工具一致的请求体：`model`、`prompt`、`generation_type`、`aspect_ratio`、`seconds`/`duration`、`resolution`、`media[]`；`generation_type` 由用户选择，按玩法校验素材并写入 `media.role`，不发送 `generate_audio`
- [x] 1.3 用 `isNewApiAuthEnabled()` 分支：开启走统一入口，关闭保持现有 multipart `POST /v1/videos`；有模型脚本时仍只跑脚本

## 2. Canvas and workbench

- [x] 2.1 画布视频节点把现有参考图传入统一入口 `media`，尺寸映射为 `aspect_ratio`，时长映射为 `seconds`
- [x] 2.2 视频工作台走同一套 create/poll，避免工作台仍打 `/v1/videos`
- [x] 2.3 若画布已有可引用的视频/音频节点，先经 `/v1/video/input-assets` 上传再写入所选玩法允许的 `media`；没有则不发送，不做新的画布上传器
- [x] 2.4 视频设置提供玩法选择（文生/图生/多图/首尾帧/参考音频/参考视频），画布节点与工作台共用，默认文生视频

## 3. Docs and verification

- [x] 3.1 更新 `CHANGELOG.md` Unreleased 与 `pending-test`：new-api 模式下视频走统一入口，本地 dev 仍可 `/v1/videos`
- [ ] 3.2 用站内视频分组 Token 实测文生与图生；本地 `bun run dev` 确认无脚本模型仍走 `/v1/videos`

