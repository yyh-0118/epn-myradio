# NOTICE

Mineradio 使用了以下第三方项目或服务。各项目版权归其原作者所有。

## Third-party Libraries

- Electron
- Three.js
- GSAP
- music-tempo
- NeteaseCloudMusicApi
- mpg123-decoder

## Community Contributions

- Cuefield AutoMix planner/runtime: adapted for experimental local testing from [SLYysl/cuefield-mineradio](https://github.com/SLYysl/cuefield-mineradio) at revision `c16f05a0bc731a49da7d42c135337fcac58f6dba` (GPL-3.0). The optional remote-feedback component from that repository is not included; Mineradio stores Cuefield ratings locally in the current user's data directory.
- Wallpaper Engine local-library detection and import UX: independently adapted from the approach used by [ww085213/Mineradio-LX-Music](https://github.com/ww085213/Mineradio-LX-Music) at commit `a5ef80a219709080700be5b1d00f1ea71a5a2576` (GPL-3.0). Mineradio only indexes local `project.json` metadata; it does not execute imported Web/Application projects or replace the user's existing background-media settings.
- Full-desktop main-window mode and home-dashboard information hierarchy: initially adapted from [ww085213/Mineradio-LX-Music](https://github.com/ww085213/Mineradio-LX-Music) at commit `82826df814c32853d99697c0ee60f749a2fcad79`, with the homepage refreshed against `812e2dc2e18bbc263e61dbd0206cb765e003d6e9` (GPL-3.0). Mineradio keeps its own provider, queue, playlist, listening-history, WorkerW validation, DPI, lifecycle, and cleanup implementations; see `docs/THIRD_PARTY_PORTS.md` in the corresponding source distribution.
- Qishui Passport Web QR authentication bridge: focused port from [Wx2yZx/Mineradio-Qishui-QR-Login](https://github.com/Wx2yZx/Mineradio-Qishui-QR-Login) at commit `aaadaab7d011714f94fbe45b382ba8dcc7cf17b9` (declared `GPL-3.0-only`). Only the official QR create/poll, security-signing host, session persistence, and second-verification path are integrated; Mineradio keeps its own catalogue, playlist, entitlement, and playback adapters. The bundled ByteDance/Qishui web security runtime resources remain the property of their respective rights holders and are used only to interoperate with the user's own official account session.

## Third-party Services

Mineradio 可能与网易云音乐、QQ 音乐等第三方音乐服务进行用户自有账号相关的本地客户端交互。

Mineradio 不是任何音乐平台的官方客户端，也不隶属于网易云音乐、QQ 音乐或腾讯音乐娱乐集团。请用户自行遵守对应平台的服务协议、版权规则和会员权益规则。

## Original Design

Mineradio 名称、MR Logo、界面视觉设计、启动动画方向、粒子视觉体验和电影镜头系统的产品表达属于作者原创设计。

emily 作为 Mineradio 早期视觉底层想法与 `emily` 视觉预设改进方向的共创者和灵感来源之一，特此致谢。

感谢小天才e宝、应春日、锋将军、軌跡、林中、骊、风痕、花椰菜🥦在早期体验、测试反馈和发布准备中的帮助。

## Mineradio Afterglow Fusion

本目录是在 Mineradio 基础上建立的独立 GPL 融合原型。保留 Mineradio 原作者、共创者、社区移植和第三方库声明，不将原界面、名称或视觉重新声明为融合层原创。

新增融合层包括：`public/js/modules/10-shell/06-afterglow-host.js`、`public/css/afterglow-workbench.css`、`workbench/src/host/*` 和构建脚本。它们实现播放器与笔记工作台之间的受限消息桥、记录入口和嵌入界面。

`workbench/vendor/epn` 来自本地 EchoPulseNode 项目的分析服务依赖子集，并通过 `build/afterglow-sidecar` 作为独立本地分析运行时接入。当前工程仍为 private 原型；公开发布前必须确认 EchoPulseNode 相关代码、提示词和品牌名称的分发授权。

融合层不包含音乐文件，也不会把音乐平台 Cookie、Token、Authorization、音频 URL 或本地文件路径发送给嵌入工作台。第三方平台能力仍受原服务条款与接口变化约束。
