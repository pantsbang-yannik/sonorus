# M2 技术穿刺结论

## 通道 1：Electron 内 Three.js WebGPU/TSL

- **结论：通**。WebGPU 原生路径与 forceWebGL 回退路径都能跑满 60fps（10 万粒子 TSL compute），渲染基元断言（透视尺寸衰减 + 软边圆盘）通过。后续渲染任务可放心以 WebGPURenderer + TSL 为地基。
- **真机环境**：Electron 43.0.0（Chromium 150.0.7871.46）、macOS 26.5.2 arm64、three 0.183.2、@types/three 0.183.1、electron-vite 5 dev 模式、DPR cap 1.5。

### backend 实测

| 路径 | backend | 10 万粒子 compute+render fps |
|---|---|---|
| 默认 | `WebGPUBackend`（原生 WebGPU，无需任何 Electron flag） | 58.0–60.2，稳态 60（rAF 封顶） |
| `forceWebGL: true` | `WebGLBackend`（WebGL2 回退） | 60.0–60.6，稳态 60 |

fps 由场景内每 5s 打点（`[spike] avg fps`）连续采样 ≥40s 得出，两条路径都远超 55 的验收线。截图证据：`/tmp/spike-webgpu.png`（WebGPU 全景球壳）、`/tmp/spike-webgpu-closeup.png`（相机拉近，近大远小 + 软圆盘）、`/tmp/spike-webgl.png`（WebGL2 回退路径涡旋）。

### TSL 导出确认（three@0.183.2，均从 `three/tsl` / `three/webgpu` 真实导出核对）

| 导出 | 状态 |
|---|---|
| `mx_noise_float` | ✅ `three/tsl` |
| `mx_noise_vec3` | ✅ `three/tsl`（另有 `mx_noise_vec4`，无 `mx_noise_vec2`） |
| `instancedArray` | ✅ `three/tsl` |
| `SpriteNodeMaterial` | ✅ `three/webgpu` |
| `positionView` | ✅ `three/tsl` |
| `RenderPipeline` | ✅ `three/webgpu`（`PostProcessing` 也在） |
| `Fn` / `instanceIndex` / `uniform` / `hash` / `uv` / `smoothstep` / `float` / `vec3` | ✅ `three/tsl` |

### 坑（后续任务必读）

1. **three 0.183.x 不再自带 TypeScript 类型**（brief 假设"自带声明、无需 @types/three"已过时）：npm 包 tarball 里 `.d.ts` 数量为 0，也没有 `types` 字段。必须装 `@types/three`（本项目锁 `0.183.1`，与运行时版本对齐；`@types/three` 最新是 0.185.0，不要混用大版本）。
2. **brief 起始代码的 `computeUpdate` 类型体操不成立**：`ReturnType<ReturnType<typeof Fn>>['compute'] extends never ? never : object` 在当前类型下推不出可用类型。spike 里改为 `let computeUpdate: object` + 调用处 `renderer.compute(computeUpdate as never)`（brief 授权的 spike 专用权宜）。Task 6 正式实现请直接持有 `Fn(...)().compute(COUNT)` 的推断类型（在同一作用域内声明即可，不要跨函数传 `ReturnType<typeof instancedArray>`，见下一条）。
3. **`instancedArray` 的泛型跟着字面量走**：`instancedArray(COUNT, 'vec3')` 推出 `StorageBufferNode<"vec3">`；但 `ReturnType<typeof instancedArray>` 会丢失 `'vec3'` 泛型（落到默认 uint 系），导致 `.element(instanceIndex).z` 变 `Node<"uint">`、`.negate()` 等浮点链式方法全部报错。**compute kernel 里引用 storage 数组时保持同作用域内联**，不要抽成参数类型为 `ReturnType<...>` 的辅助函数。
4. **`renderer.compute()` 必须在 `await renderer.init()` 之后**：backend 未初始化时 `compute()` 会告警并退化为异步 `computeAsync`。spike 中 init compute 在 `await renderer.init()` 之后同步调用，无问题。
5. **`forceWebGL: true` 是 WebGPURenderer 构造参数里真实存在的字段**（`@property {boolean} [forceWebGL=false]`），回退验证不需要碰 Electron 的 commandLine switch；Electron 43 下 WebGPU 默认可用，也无需 `enable-unsafe-webgpu` 之类 flag。
6. **渲染基元**：按评审修订用 `InstancedMesh(PlaneGeometry) + SpriteNodeMaterial`（`positionNode` 接 storage、`scaleNode` 世界单位、`opacityNode` 软圆盘），真机确认透视衰减和软边都成立；WebGPU 下 `Points` 图元固定 1px 的老坑因此绕开，未再踩到。
7. **HMR 表现**：electron-vite dev 下改 spike 文件触发整页 reload，renderer 会重新 init（日志里出现第二条 `backend =`），旧 GPU 资源由页面卸载回收——调试时留意别把两次 init 的 fps 混在一起看。

## M2 验收

### 自动化已验（本任务实测，2026-07-06；真机环境同 M0：Electron 43.0.0 / Chromium 150.0.7871.46 / macOS 26.5.2 arm64 / three 0.183.2）

**全量回归门**

| 检查 | 命令 | 结果 |
|---|---|---|
| 单测 | `npm test` | PASS — 15 test files / 61 tests 全绿 |
| 构建 | `npm run build` | PASS — main/preload/renderer 三段 electron-vite build 全部成功 |
| 类型 | `npx tsc --noEmit` | PASS — 零错误 |

**fps 实测（high 档，WebGPUBackend，350,000 粒子，含完整 HDR+bloom 后期与音频分析链，非 spike 而是真实王牌场景）**

流程：`ELECTRON_ENABLE_LOGGING=1 npm run dev` 后台起 app，python3 生成 30s 440Hz 正弦测试音 wav，`afplay` 播放喂系统混音 → Core Audio Process Tap 捕获链（同 M0 通道 1），场景内每 5s 打点 `[nebula] avg fps`：

| 打点顺序 | avg fps | 备注 |
|---|---|---|
| 1 | 34.3 | 场景 init 后首窗，含 shader/pipeline 首次编译开销，该窗口实际墙钟仅 5.1s |
| 2 | 6.0 | 同上延续的预热抖动，该窗口实际墙钟拉长到 10.6s（非稳态，rAF 被首次编译阻塞） |
| 3–7（连续 5 个窗口，覆盖测试音播放全程 ~25s） | 60.0 / 60.0 / 60.0 / 60.0 / 60.0 | 稳态，每窗口墙钟精确 5.0s |

稳态 60.0fps（rAF 封顶），远超验收线 55；全程未见 `[quality]` 降级日志（`FpsGovernor` 从未触发降级动作，dev.log grep 为空）。与 M0 spike 结论一致（M0：10 万粒子跑满 60fps；M2 实测 35 万粒子 + 完整 HDR/bloom/信号总线/相机弹簧同样跑满 60fps，说明 GPGPU 路径预算充裕）。前两个打点低是 dev 模式一次性编译/加载抖动，非稳态代表值。

**CPU/内存实测**（`ps -Ao pcpu,rss,comm`，测试音播放期间 3 次采样；数值为 macOS 单核归一化 %CPU）

| 采样时刻 | Electron 主进程 | GPU Helper | Renderer Helper | audelyra-tap sidecar |
|---|---|---|---|---|
| t≈2s | 2.2% / 151MB | 0.0% / 128MB | 4.2% / 243MB | 0.3% / 16MB |
| t≈6s | 4.5% / 158MB | 16.0% / 128MB | 10.7% / 248MB | 0.2% / 16MB |
| t≈16s | 2.0% / 160MB | 24.1% / 138MB | 14.3% / 254MB | 0.3% / 16MB |

单核视角合计约 6.7–40.7%（随采样时刻爬升：t≈2s 6.7% → t≈6s 31.4% → t≈16s 40.7%；首采样处于场景预热早期、GPU Helper 尚未起量，稳态负载以 40.7% 上限为参考）；RSS 全程平稳增长、无跳变（Renderer Helper 243→254MB 属正常纹理/缓冲分配后趋稳，非泄漏迹象）。

⚠️ **与 M0 基线（12–16%）不可直接对比**：M0 是极简 compute+render spike（10 万粒子、无音频分析引擎、无后期），M2 是完整王牌场景（35 万粒子 + curl noise GPGPU + HDR RenderPipeline + BloomNode + 完整信号总线/包络跟随/相机弹簧微视差）。CPU 上升在预期内，且 fps 全程稳定 60 无丢帧、无降级触发，是功能增量带来的良性开销而非性能隐患。

**截图**：`/tmp/nebula-t14.png`（测试音播放中段截取）——afplay 无 Now Playing 元数据可读，画面呈抽象星云形态，等效验证了"无封面退化抽象星云"路径；可见粒子软边圆盘、近大远小的透视尺寸衰减、局部 bloom 辉光，符合下方负面指纹否决项对渲染基元的要求（该截图不能替代人工用真实播放器验收封面重组/沉睡苏醒等状态机行为，见下）。

### 人工待验清单（无头环境无法自动判定，照 brief Step 2 全列，供用户逐项勾选）

- [ ] 双击 `npm run dev`：星云随歌流动，气质对照品牌故事（潮汐/碎光/凿击可辨）
- [ ] 换歌看到旧封面溶解 → 新封面重组（M2 里程碑验收原文）
- [ ] 无封面（浏览器视频）退化抽象星云
- [ ] 暂停 10s 沉睡（蠕动非死黑）、恢复苏醒炸开
- [ ] 4.6 负面清单 spot check：无彩虹、无全场缩放脉冲、封面主色未直铺、低能量段敢暗
- [ ] **负面指纹否决项**（评审修订：任一不过即验收失败，防"清单全过但仍是程序员可视化"）：
  - [ ] 粒子边缘是柔和圆盘、尺寸随距离变化（非 1px 尘雾/硬边方点）
  - [ ] 鼓点闪光有可辨中心与衰减方向（非全场同步增亮）
  - [ ] 沉睡画面明显暗于清醒态，且是面向观众的幕布（非横穿屏幕的一条亮线）
  - [ ] 封面形态色彩饱和可辨（未被加色混合漂白成发光团）
- [ ] fps：high 档 ≥55（自动化已实测稳态 60.0，此项人工用真实音乐复核手感即可）；记录各档实测 fps + CPU/GPU 占用（ultra/mid/low 档需手动改代码强制切档验证，本次自动化只覆盖 `pickInitialTier` 默认命中的 high 档，其余档位验收留待人工/计划③）
- [ ] 挂机 30 分钟：无崩溃、显存/内存平稳（Activity Monitor）

## 给计划③（M3 电影感打磨）的输入

- 打磨候选（设计 4.5 P1 + 4.3）：自动电影运镜（GSAP 引入）、反馈拖尾缓冲、逐粒子 CoC 散景、蓝噪声抖动、速度拉伸粒子、苏醒仪式能量调制、歌名角标设计、鼓点第三种打击模式（镜头微震）
- M2 实测帧预算余量：high 档 350,000 粒子稳态 **60.0fps**（rAF 封顶，距 55 降级线有余量，`FpsGovernor` 全程未触发降级）；同期 CPU 单核视角合计约 6.7–40.7%（主进程 2–4.5% + GPU helper 0–24.1% + Renderer helper 4.2–14.3% + sidecar ~0.3%；下限来自预热早期采样，稳态预算参考上限 40.7%），RSS 约 243–254MB（Renderer）。结论：fps 有余量但 GPU helper 已非空闲（稳态负载下爬升到 24%），说明 P1/M3 新增特效（拖尾 ping-pong RT、CoC 散景、蓝噪声抖动等）是**新增预算而非白嫖剩余帧时间**——建议 M3 开工前用本次同一套 fps/CPU 采样方法逐项量化边际成本，加一项验一项，避免多项叠加后无声无息啃穿 55 线
- 视觉验收中最"不哇塞"的三个点（2026-07-06 用户首轮真机验收反馈）：
  1. ~~第一首歌不形成封面~~——定性为启动竞态 bug（首条曲目快照早于渲染进程订阅+通道去重不重发），已修（`aae4785`：主进程缓存+did-finish-load 补发）
  2. 封面态律动太弱、无粒子跳跃感——已做第一轮增强（`4814dd6`：鼓点局部松弛吸附→弹飞回弹、打击位按 uMorph 投影到封面平面、冲量封面态 8→18、辉光 0.4→0.55、drop 随 energy 加成）；**跳跃感是否到位待用户复验，不足继续加码**（候选：beat strength 下限、BPM 网格化预期性冲量）
  3. 纯黑背景缺视觉冲击/融合感——已做（`4814dd6`：`background.ts` 氛围光渐变随封面 deep 色+能量呼吸+drop 增亮，15k 远景尘埃慢自转；亮度峰值钳制守"黑是奢侈品"）；**观感待用户复验**

## 终审遗留 triage（2026-07-06 全分支审查，合并前记录）

**记入计划③的工程债（4+3 条）：**
1. SceneHost.start() 快速重入漏 dispose + 双 rAF——场景切换 UI 开工前必修
2. NebulaParticles.dispose 不释放 4 个 storage buffer——场景热切换/多次重建前必须真释放
3. 滚动峰值公式仓库内三份重复（engine.ts/energy.ts/signal-rig.ts）——提炼 motion.ts RollingPeak
4. placeholder 兜底路径在 renderer.init 失败后大概率黑屏（canvas 上下文已被占用）+ 失败场景不 dispose——SceneHost 加固包
5. trace 行无版本戳、deserialize 弱校验——契约演进前加版本字段
6. SceneContext.quality 在 nebula 零消费（"上限参考"注释与代码不符）——pickInitialTier 上移 host 或修注释
7. T11 targetColors 换歌中途瞬时色权重跳变——人工验收若可见则入打磨清单

**接受不修（8 条）**：loudness instant 创新高语义、sampleRate 变更不重置峰值、trace-controls 监听器终身、spectrum 极值测试、test+feat 历史前缀、Spring 负 dt、placeholder canvas 清理、createScene fail-fast——理由见 .superpowers/sdd/progress.md 终审记录。
