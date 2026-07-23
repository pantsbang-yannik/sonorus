# M0 技术穿刺结论

## 通道 1：macOS 系统音频捕获（Core Audio Process Tap）

- **结论：带条件通**
  - 技术管道全程跑通：API 在 macOS 26 编译通过，全局系统混音 tap + 私有聚合设备创建成功，IO 回调按精确码率交付 PCM。
  - **唯一未闭环的一环**：捕获到的样本全为 0（静音）。这是 Apple Process Tap 在**未获得「系统音频录制（System Audio Recording）」TCC 授权**时的标准行为——不报错，交付静音。需要宿主 App 一次性授权后即可产出真实音频。
  - 生产环境（Task 8，Electron 派生本二进制）授权归属 Electron.app，其 Info.plist 带 `NSAudioCaptureUsageDescription` 时会正常弹窗，授权路径更干净。

- **真机环境**：macOS 26.5.2（Build 25F84），Apple Silicon（arm64），Swift 6.3.3

- **复现命令**：见 `native/mac-tap/`
  - 构建：`./native/mac-tap/build.sh`
  - 一键验证（自带 440Hz 测试音 + RMS/频谱判定）：`./native/mac-tap/verify.sh`
  - 协议：启动后 stderr 首行 `{"sampleRate":48000,"channels":2}`，随后 stdout 持续输出交错 Float32 LE PCM，收 SIGTERM/SIGINT 退出。

- **实测格式**：`sampleRate=48000`，`channels=2`
  - 每次运行 header 稳定输出 `{"sampleRate":48000,"channels":2}`。
  - 字节率精确：25s 运行产出 9,560,064 B ≈ 25 × 48000 × 2ch × 4B，证明 IO 回调交付的 PCM 结构与码率完全正确（只是内容为静音）。

- **RMS 证据**：本自动化会话内 **rms = 0.0**（全零），因无法在会话内完成 TCC 人工授权（见坑）。管道结构正确性由字节率与 header 佐证；非零 RMS 待人工授权后由 `verify.sh` 复核。

- **坑（如实记录）**：
  1. **授权归属 = 宿主 App，不是本二进制**。CLI 二进制 `audelyra-tap` 未注册为已知 App（`tccutil reset AudioCapture com.audelyra.tap` 报 `No such bundle identifier -10814`），TCC 决策归属运行它的终端（本机为 iTerm，bundle id `com.googlecode.iterm2`）。生产中归属 Electron.app。
  2. **未授权 = 静音而非报错**。`AudioHardwareCreateProcessTap` / 聚合设备创建 / IO 回调全部成功返回 `noErr`，但 PCM 全零。不能靠 OSStatus 判断是否授权，必须靠 RMS/内容判定。
  3. **必须内嵌 Info.plist**。裸 `swiftc` 产物无法让系统正确归属授权提示。build.sh 用 `-Xlinker -sectcreate __TEXT __info_plist` 内嵌带 `NSAudioCaptureUsageDescription` + `CFBundleIdentifier` 的 Info.plist，并 `codesign --force --sign -` 重新 adhoc 签名覆盖。
  4. **本会话 `log show` 完全不可用**（`log show --last 1m` 返回 0 行，权限受限），无法用系统日志诊断 TCC 弹窗是否出现；只能靠 RMS 结果反推。
  5. **TCC 弹窗屏蔽合成点击**，无法用 osascript/System Events 自动点「允许」；授权必须真人操作。
  6. **API 签名对照实测**（相对 brief 起始代码的修正）：
     - `CATapDescription(stereoGlobalTapButExcludeProcesses:)` 在 macOS 26 可用，全局混音 tap 语义正确。
     - 聚合设备字典按 AudioCap 补齐了 `kAudioAggregateDeviceMainSubDeviceKey`（默认输出设备 UID）、`kAudioAggregateDeviceSubDeviceListKey`、`kAudioSubTapDriftCompensationKey`——brief 起始版本缺这几个键；补齐后仍需授权，与静音结论无关但更贴近参考实现。
     - `kAudioTapPropertyFormat` 在 `tapID` 上读取正常。

- **人工待办（一次性）**：
  给运行它的宿主 App 授权「系统音频录制」：`系统设置 > 隐私与安全性 > 系统音频录制`，启用 iTerm（或未来的 Electron）；若从未弹窗，运行一次并在弹窗点「允许」，再跑 `./native/mac-tap/verify.sh`，预期看到 `PASS: captured real audio (440Hz tone present)`。

- **是否回退 ScreenCaptureKit**：**不建议**。SCK 系统音频捕获需要**同一个** TCC 授权（甚至叠加屏幕录制权限，更重），本路线的阻塞点（一次性人工授权）在 SCK 下同样存在，且 Process Tap 更轻、延迟更低、无需屏幕录制权限。技术管道本身已证明可行，无需换方案。

## 通道 2：macOS 正在播放元数据（MediaRemote adapter）

- **结论：通（层①胜出，真机全链路验证通过）**
  - macOS 26.5.2 上可以稳定拿到系统级「正在播放」的 title / artist / 封面位图，推送式，跨应用（MediaRemote 系统层，不绑定具体播放器）。
  - 实现：`electron/nowplaying/mac.ts` 导出 `startMacNowPlaying(onEvent) => stopFn`，内部 spawn `media-control stream --no-diff` 子进程读 JSONL。

- **逐层验证结果（如实记录）**：
  | 层 | 结果 | 证据 |
  |---|---|---|
  | ① `media-control`（ungive） | **通** ✅ | **注意：它不是 npm 包**（`npm install media-control` 404，npm 上同名包全是无关物）。实际分发是 **Homebrew CLI**：`brew install media-control`（本机装的 0.7.6）。`get` 一次性取值、`stream` 推送 JSONL，title/artist/封面全拿到；`pause/play/seek` 控制命令也实测有效 |
  | ② `ungive/mediaremote-adapter` | 未单独验证（无需） | 层①即其官方封装（perl + Apple 签名宿主 hack 在 CLI 内部），层①通过即隐式验证 |
  | ③ AppleScript 查 Music.app | **本会话被 TCC 阻塞** ⚠️ | `osascript -e 'tell application "Music" to ...'` 无限挂起——等待「自动化（Apple Events）」授权弹窗真人点击。**AppleScript 路线也有自己的 TCC 门槛**，且只覆盖单一 App，不是更容易的备胎 |

- **关键问题答案**：
  - **封面拿得到吗？** 拿得到。`artworkData` 字段，**base64 字节**（不是 URL），旁带 `artworkMimeType`。实测 Music.app 交付 **image/jpeg**（即使源文件内嵌 PNG，Music 会转码）——所以 `TrackMeta.artworkPng` 的字节实际可能是 JPEG，Electron `nativeImage` 按内容嗅探格式，不受影响。
  - **轮询还是推送？** **推送**。`stream` 模式子进程持续输出 JSONL（每行 `{type:"data", diff, payload}`），无需轮询。`--no-diff` 让每次推送都是全量快照，省去自行合并 diff 状态。
  - **封面异步晚到（重要坑）**：track 切换后第一条推送往往**只有 title/artist、无封面**，封面在随后（可迟数秒）的更新中补到。`mac.ts` 的去重键含"是否有封面"，因此同一首歌会先后发两次 `change`（无封面→有封面），消费方（Task 10）按最后一次渲染即可。
  - **Music vs Spotify 覆盖**：Music.app 真机实测通过。**Spotify 本机未安装，未能实测**；但 MediaRemote 是系统层（payload 带 `bundleIdentifier` 区分来源 App），media-control 官方 README 即以 Spotify 为主要示例，覆盖预期没问题。
  - **无播放时的行为**：无媒体会话时 `get` 返回 `null`、`stream` 推送空 payload——不报错。`mac.ts` 归一化为 `{kind:'unknown'}`（去重只发一次）。

- **真机环境**：macOS 26.5.2 arm64，media-control 0.7.6（Homebrew），Node 经 `npx tsx` 运行

- **复现命令**：
  ```bash
  brew install media-control
  media-control get              # 一次性取值（无会话时输出 null）
  media-control stream --no-diff # 推送 JSONL
  # 全链路（播放任意歌曲后）：
  npx tsx -e "import { startMacNowPlaying } from './electron/nowplaying/mac';
  startMacNowPlaying(e => console.log(e.kind, e.kind==='change'?e.meta.title:''));
  setTimeout(()=>process.exit(0),15000)"
  ```
  实测事件序列（播放 A → 切到 B → 杀掉 Music）：
  ```
  [0.0s] change title="Audelyra Covr Test" artist="Covr Artist" artwork=857B
  [5.3s] change title="Audelyra Art Test" artist="Spike Artist" artwork=null
  [5.3s] change title="Audelyra Art Test" artist="Spike Artist" artwork=857B   ← 封面异步补发
  [13.3s] unknown                                                             ← 会话消失
  ```

- **坑（如实记录）**：
  1. **brief 里的层①「npm 包」不存在**——media-control 从未发布到 npm，别再试 `npm install media-control`。生产分发要么依赖用户 `brew install`，要么后续把 mediaremote-adapter 的 framework + perl 宿主打包进 app（Task 10+ 决策点）。
  2. **Electron GUI 进程的 PATH 不含 `/opt/homebrew/bin`**。`mac.ts` 已按绝对路径解析二进制（`AUDELYRA_MEDIA_CONTROL` 环境变量 > `/opt/homebrew/bin` > `/usr/local/bin` > PATH 兜底）。
  3. **封面字节不保证是 PNG**（见上，实测 JPEG）。类型契约字段名 `artworkPng` 保持不变（Task 10 依赖签名），但消费端不要假设 PNG 魔数。
  4. **每条带封面的推送体积可达数百 KB**（base64）。若未来只要文字不要图，加 `--no-artwork` 可大幅减流。
  5. **AppleScript 备胎并不「更简单」**：需要「自动化」TCC 授权（会无限挂起等真人点击），且 per-App、无推送、无封面字节（Music 的 artwork 要另取）。MediaRemote 路线反而**零 TCC 弹窗**——本会话全程无需任何授权。
  6. `media-control stream` 启动第一条推送可能是空 payload（`{}`），随后才是全量快照——`mac.ts` 会先发一次 `unknown` 再发 `change`，消费方不要把启动瞬间的 `unknown` 当错误。

- **人工待办**：无（本通道零授权、已全链路真机验证）。仅 Spotify 覆盖属"未实测"，装了 Spotify 后重跑上面复现命令即可补验。

## 通道 3：Windows 环回捕获（getDisplayMedia loopback）

- **结论：挂起（GATED-WIN）**。无 Windows 测试机，按计划跳过不阻塞。方案与代码骨架见计划① Task 11，拿到机器后补验。

## 通道 4：Windows SMTC 元数据（C# sidecar）

- **结论：挂起（GATED-WIN）**。同上，见计划① Task 12。

## M1 验收

自动化冒烟已验证（2026-07-05，macOS 26.5.2 arm64，dev 模式）：

- ✅ `npm test` 17/17 通过（features/beat/energy/engine/chunker）
- ✅ `npm run dev` 启动无报错，sidecar 拉起、主进程/渲染进程存活，挂机采样期间无崩溃
- ✅ NowPlaying 通道全链路（Task 3 真机事件序列：change→封面补发→unknown）

以下为**听感/视觉项，待人工对照确认**（播放真实音乐观察调试画面）：

- [ ] 中心圆随响度呼吸，鼓点白闪与听感对齐（延迟无明显违和）
- [ ] bpm 显示接近真实（±5 以内）
- [ ] 副歌进入时 energy 明显上升；至少触发一次 drop
- [ ] 暂停 2 秒后 silence=true，恢复播放立即 false
- [ ] 低音多的歌 low 柱高，高频亮的歌 high 柱活跃
- [ ] 角落显示歌名+歌手，右上角封面，切歌 2s 内更新
- [ ] 挂机 10 分钟不崩、内存不涨（Activity Monitor）
- [ ] 通道 1 的 TCC 授权复核：`./native/mac-tap/verify.sh` 输出 PASS（若调试画面已随音乐跳动即隐式通过）

## 给计划②（王牌场景）的输入

- **信号总线实测更新率**：46.875Hz（hop=1024 样本 @48kHz ≈ 21.3ms）——设计文档"60Hz"已修订为实测值
- **Signals 契约版本**：`src/engine/types.ts@a018196`（v1 体力信号全量：loudness/bands/spectrum/beat/bpm/energy/drop/silence）
- **封面可得性实测**：Music.app＝有（base64 字节，实测 JPEG，可能晚 title 数秒异步补发，带封面推送可达数百 KB）；Spotify＝未实测（本机未装，系统层 MediaRemote 预期覆盖）；浏览器＝未实测
- **CPU/内存基线**（dev 未优化构建，播放 30s 测试音期间 3 次采样，Apple Silicon）：主进程 2–3.5%、渲染进程 4–6%（含引擎分析+canvas 绘制）、GPU helper 5–6%、audelyra-tap sidecar 0.2–0.3%，合计约 12–16% 单核；渲染进程 RSS ≈ 112MB。注：未确认采样时 TCC 授权态（未授权=全零 PCM，计算路径与真实音频相同，基线仍有效）
- **已知延迟（估算，未实测对齐）**：sidecar IO 回调即写 stdout（写队列异步，不阻塞音频线程）→ 主进程按 2048 样本/通道切块 ≈43ms 聚齐 → 引擎 hop ≈21ms → 端到端约 65–90ms + IPC/渲染一帧。人工验收"鼓点白闪与听感对齐"即此项的体感验证
