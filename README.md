# Mineradio Afterglow

基于 Mineradio 的独立融合原型：保留原播放器、视觉舞台、搜索与用户音乐账户适配，在同一个 Electron 应用中加入“记录此刻”、私人笔记、瞬间素材库与 EPN 工作台边界。

原项目 `Mineradio-paused`、`EchoPulseNode` 和独立交互原型 `Afterglow` 均未修改。本目录是后续迭代使用的独立工程。

## 当前已经搭好的框架

- 完整保留 Mineradio 原界面、播放队列、歌词舞台和多平台账户代码。
- 播放时右下角出现低干扰的“记录此刻”入口，显示当前歌词。
- `Alt + N` 也可记录当前曲目、播放时间和歌词。
- 工作台作为同源 iframe 覆盖层打开，不导航、不销毁 Mineradio，也不创建第二个音频播放器。
- Mineradio 与工作台通过版本化 `MessageChannel` 通信。
- 工作台可写笔记、自动保存、搜索素材、删除、导出 Markdown，并请求父播放器回听。
- 瞬间与曲目快照通过 preload 窄接口写入 Electron `userData/afterglow/notebook.json`，包含 schema 版本、串行原子写和 `.bak` 恢复；纯浏览器开发模式才回退到 IndexedDB。
- EPN 作为独立 utility process sidecar 自动启动，通过动态回环端口和随机令牌认证。
- 工作台已经接入真实 EPN 韵脚、文本情感与叙事分析；未配置 LLM 时明确使用规则引擎，模型失败时明确回退。

工作台不会收到音乐平台 Cookie、Token、Authorization、音频 URL 或本地文件路径。宿主只发送标准化曲目标识、基础信息、歌词和播放状态。分析代理也不会转发浏览器 Cookie、Authorization 或私人笔记。

## 运行

要求 Windows 与 Node.js 22/24。

```powershell
cd c:/Users/yehanyang/Desktop/epnn/Mineradio-Afterglow
npm install
npm --prefix workbench install
npm run build:fusion
npm start
```

`npm start` 启动 Electron。音乐平台登录、搜索与播放仍使用 Mineradio 原有入口；它们依赖第三方平台当前接口状态，不应视为稳定商业 API。

开发工作台时可以单独运行：

```powershell
cd workbench
npm run dev
```

独立开发页仍是 `http://127.0.0.1:5178`。正式 Electron 使用构建后的 `public/afterglow/`，不依赖 5178 端口。

## 构建与检查

```powershell
npm run check:fusion
npm run test:fusion
npm run test:electron-fusion
npm run build:fusion
npm run build:win:dir
```

所有桌面打包脚本都会先重新构建工作台。`public/afterglow/` 是生成后的嵌入资源；源码位于 `workbench/`。

## 关键目录

```text
public/
  index.html
  css/afterglow-workbench.css
  js/modules/10-shell/06-afterglow-host.js
  afterglow/                    # 工作台构建产物
workbench/
  src/host/contract.ts
  src/host/bridge-client.ts
  src/host/EmbeddedApp.tsx
  src/host/repository.ts
  src/host/embedded.css
  server/sidecar.ts
desktop/afterglow-note-store.js
scripts/build-workbench.js
scripts/build-afterglow-sidecar.js
build/afterglow-sidecar/          # EPN 打包产物
```

### Bridge 方向

```text
Mineradio 播放器
  ├─ host.snapshot：曲目、歌词、播放状态、能力
  ├─ host.capture：精确记录快照
  ├─ storage RPC → preload → IPC → userData
  └─ 接收 seek / play / pause / close
          │ MessageChannel
          ▼
Afterglow 工作台
  ├─ 笔记与素材库
  ├─ 请求回听
  └─ /afterglow-api → 严格同源代理 → EPN sidecar
```

## 当前限制

1. 当前只能回听仍在播放的同一曲目。跨曲目打开记录后自动切歌，需要后续接入受控的 `playTrack` capability。
2. Mineradio 舞台歌词是 Three.js Mesh，并非可点击 DOM 行。本阶段使用显示当前歌词的“记录此刻”浮动入口；后续可根据舞台射线拾取结果实现精确点击歌词。
3. 尚未提供图形化 LLM 密钥设置。默认运行 EPN 规则引擎；需要 LLM 时应通过进程环境提供 `USE_REAL_LLM`、`LLM_API_URL`、`LLM_API_KEY` 和 `LLM_MODEL`，sidecar 只继承白名单变量。
4. Agent 素材整理尚未启用；当前分析必须由用户主动点击，不会读取私人笔记。
5. 未对所有音乐平台账户链路做在线验收。平台接口、登录和播放能力可能因第三方变更失效。
6. 当前名称、图标和视觉沿用 Mineradio，仅适用于此 GPL 融合原型；公开发布前需要确认名称、视觉资产及 EPN 代码的分发授权。

## 下一步

- 验证网易云、QQ、酷狗、汽水等当前账户、歌单、歌词与播放链路。
- 接入受控的跨曲目 `playTrack` capability，让素材卡可以恢复对应歌曲。
- 打磨 Three.js 歌词射线拾取、翻书动效和工作台视觉连续性。
- 增加可撤销的素材整理 Agent：只检索用户授权的记录，并引用来源，不冒充用户感受。
- 提供稳定仓储的 JSON 备份导入与冲突预览。

## 来源、许可与第三方平台

Mineradio 原项目采用 `GPL-3.0-only`，本融合工程继续采用 GPL-3.0-only，详见 `LICENSE` 与 `NOTICE.md`。Mineradio 不是任何音乐平台的官方客户端，用户需要遵守相应平台服务条款、版权规则和会员权益。

Copyright (C) 2026 XxHuberrr and respective contributors. 后续融合代码及 EPN 组件版权归各自作者所有。
