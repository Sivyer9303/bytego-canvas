## Purpose

让 bytego 画布在 new-api 同域部署下，通过统一视频入口生成视频，而不是按上游渠道分别适配。

## ADDED Requirements

### Requirement: New-api mode uses the unified video generation API

当 new-api 认证开启且所选视频模型没有自定义调用脚本时，系统 SHALL 使用 `POST /v1/video/generations` 创建任务，SHALL 使用 `GET /v1/video/generations/{id}` 查询任务，并 SHALL 在任务完成后使用 `GET /v1/videos/{id}/content` 或响应中的可播放地址获取成片。创建请求 SHALL 使用 `application/json`，SHALL 包含 `model`、`prompt`、`generation_type` 和 `aspect_ratio`。`generation_type` SHALL 使用用户在视频设置中选择的玩法（默认文生视频），SHALL NOT 按参考素材自动猜测。系统 SHALL 在提交前校验参考图、参考视频和参考音频数量是否符合所选玩法；不符时 SHALL 拒绝请求。

#### Scenario: Text-to-video task is created

- **WHEN** 用户选择文生视频玩法并对无参考素材的视频节点发起生成
- **THEN** 画布 SHALL 向当前渠道 `baseUrl` 发送 JSON `POST /v1/video/generations`，`generation_type` 为文生视频，且不得发送 multipart `POST /v1/videos`

#### Scenario: Image-to-video task includes reference images

- **WHEN** 用户选择图生视频玩法并对带正好 1 张参考图的视频节点发起生成
- **THEN** 请求 SHALL 使用图生视频的 `generation_type`，并 SHALL 先通过 `/v1/video/input-assets` 上传参考图，再在 `media` 中放入 type 为 `image`、role 为 `reference`、source 为 HTTPS 地址的参考；SHALL NOT 把图片 data URL 写入生成请求体

#### Scenario: User-selected modes validate and assign media roles

- **WHEN** 用户选择多图参考且连接 2–9 张参考图
- **THEN** 请求 SHALL 使用 `multi_image`，图片 role 为 `reference`
- **WHEN** 用户选择首尾帧且按顺序连接正好 2 张参考图
- **THEN** 请求 SHALL 使用 `start_end`，第 1 张 role 为 `first_frame`，第 2 张 role 为 `last_frame`
- **WHEN** 用户选择参考视频且连接 1–3 个参考视频
- **THEN** 请求 SHALL 使用 `reference_videos`，并把参考视频与可选伴生图、音频写入 `media`
- **WHEN** 用户选择参考音频且连接 1–9 张参考图和 1 个参考音频
- **THEN** 请求 SHALL 使用 `reference_audio`
- **WHEN** 用户选择的玩法与已连接素材数量不符
- **THEN** 系统 SHALL 提示错误，SHALL NOT 自动改玩法或静默丢弃多余素材

#### Scenario: Task is polled until completion

- **WHEN** 创建接口返回任务 id
- **THEN** 画布 SHALL 轮询 `GET /v1/video/generations/{id}`，直到成功、失败或超时，成功后 SHALL 得到可播放的本地或远程视频

### Requirement: Custom model scripts still override the unified API

若视频模型配置了调用脚本，系统 MUST 继续执行该脚本完成创建与取回，不得改走 `/v1/video/generations`。

#### Scenario: Scripted video model is selected

- **WHEN** 用户选择带自定义脚本的视频模型并生成
- **THEN** 系统 SHALL 只运行该脚本，SHALL NOT 自动改发统一入口请求

### Requirement: Local development keeps the OpenAI Videos fallback

当 new-api 认证关闭时，无脚本的视频生成 SHALL 继续使用现有 `POST /v1/videos` multipart 流程，以便本地直连 OpenAI 兼容上游。

#### Scenario: Local bun dev generates video without new-api auth

- **WHEN** 用户在未开启 new-api 认证的本地开发环境生成视频且模型无脚本
- **THEN** 系统 SHALL 调用 `POST /v1/videos`，且行为与改前兼容

### Requirement: Canvas does not add per-provider video adaptors

系统 MUST NOT 在画布前端为 SilkRoad、Brioi、CompatVideo 或 AIStarsLab 增加独立请求协议；渠道差异 SHALL 由 new-api 统一入口处理。系统 MUST NOT 按模型档案或 `-ref` 后缀禁用参考图。

#### Scenario: Seedance or Wan token is used from canvas

- **WHEN** 用户使用 new-api 中已接入统一视频入口的 Token 在画布生成视频
- **THEN** 画布 SHALL 只调用统一入口，SHALL NOT 按模型名或渠道品牌切换不同 URL 或表单格式

#### Scenario: Reference images are sent regardless of model name

- **WHEN** 用户在 new-api 模式下对任意无脚本视频模型带符合所选玩法的参考图生成
- **THEN** 系统 SHALL 按用户选择的玩法提交 `generation_type` 及对应图片 `media`，SHALL NOT 因模型名不含 `-ref` 而拦截
