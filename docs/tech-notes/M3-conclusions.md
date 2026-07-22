# M3 结论台账

## 特效边际成本（M2 基线：high 档 60fps / GPU helper ~24%）

真机：WebGPUBackend，high 档，350k 粒子，48kHz 节奏测试音（120BPM kick + 440Hz pad）。
测量方式：`ELECTRON_ENABLE_LOGGING=1 npm run dev` 各 40s，读渲染进程 `[nebula] avg fps` 5s 滑窗打点。
CameraDirector「关」= `update()` 顶部临时 `return` 早退（测完已删除）。

| 特效 | 关 fps | 开 fps | 边际 | 结论 |
|---|---|---|---|---|
| CameraDirector | 60.0（稳态）| 60.0（稳态，首窗 58.3 为着色器 warmup）| ≈ 0 | 纯 CPU 层（GSAP tween proxy + 几个 Spring/ArPulse + 每帧一次 lookAt/applyEuler），无新增 GPU 通道，成本落在 60fps 帧预算的量测噪声内 |
| 速度拉伸粒子（rotationNode+scaleNode vec2） | 60.0（稳态，`stretch.mul(0)` 临时置零测量）| 60.0（稳态，正常实现）| ≈ 0 | 每粒子每帧多一次 mat4×vec4 变换 + 1 次 atan + 2 次除法，落在 SpriteNodeMaterial 顶点着色器既有 350k 粒子实例化绘制的帧预算噪声内；high 档本就有余量（M2 结论：high 档 58-60fps @10万/30万粒子），vertex 阶段增量不构成新瓶颈 |
| 逐粒子 CoC 散景（scaleNode 乘系数 + opacityNode 乘系数） | 60.0（稳态，`coc.mul(0)` 临时置零测量）| 60.0（稳态，正常实现）| ≈ 0 | 每粒子每帧多 1 次 mat4×vec4（复用不了 velView 那次，depth 需要 simPos 而非速度）+ saturate/min/abs/div 几条 ALU；同样落在 high 档帧预算噪声内 |
| afterImage 拖尾 + 暗部 dither（scenePass → afterImage → +bloom → renderOutput → +dither） | 60.0 稳态（临时把 `trailedColor` 短路回 `color`、`outputColorTransform` 恢复默认 true、dither 乘幅改成 0，跳过 afterImage 全屏 RT 往返与 renderOutput/dither 采样）| 60.0 稳态（正常实现，afterImage 全屏合成 RT + renderOutput 手动 tone map + dither 采样全部在线）| ≈ 0 | afterImage 是本任务里唯一的**新增绘制通道**（每帧一次全屏 quad 合成 + RT 交换），理论上比"每粒子多几条 ALU"更该吃 fill-rate；但在 350k 粒子 + high 档既有余量下，1920×1080 级分辨率的单次全屏合成远低于粒子仿真/绘制的帧预算占用，两组 40s 窗口全程贴 60.0（仅首窗 warmup 57.3–58.0，两组一致），无掉帧、无报错 |
| **全叠加**（导演层 + 速度拉伸 + CoC + afterImage 拖尾 + dither，全部同时在线，即代码当前正常运行态，无任何临时关闭分支） | 60.0（M2 基线，无 M3 特效） | 60.0 稳态（T9 终测：`ELECTRON_ENABLE_LOGGING=1 npm run dev`，WebGPUBackend / high 档 / 350000 粒子，40s 120BPM kick+pad 测试音喂系统混音，8 个 5s 滑窗打点：首窗 59.9 warmup，其余 7 窗全程 60.0，控制台无 error/exception） | ≈ 0（各项零边际总和一致） | **≥55fps 达标**（实测 60.0，余量充裕）。与上面 4 行单项测量互相印证——各项边际都在测量噪声内时，全部叠加的总边际也应仍在噪声内，T9 终测的连续 8 窗 60.0 稳态是对这条推论的直接验证，不是靠"零边际相加"的理论推断。无需按 brief 兜底条款裁剪任何一项 |

结论：导演层对 GPU 帧率零边际成本，符合预期——运镜全在 CPU 侧算好后只写 `camera.position/fov`，不触碰粒子仿真与后期。速度拉伸、CoC 散景同样零边际——量级都是"每粒子多几条 ALU 指令"，不是新增绘制通道或分辨率相关的 fill-rate 成本。afterImage 拖尾是本轮首个新增全屏绘制通道，边际仍落在噪声内——high 档（350k 粒子 WebGPU）帧预算余量比预期更宽裕，但**这条零边际结论不能外推到 low/mid 档或更高分辨率**：低档路径本就不构造 `NebulaPost`（`quality.bloom===false` 直接 `renderer.render`），拖尾/dither 天然不生效，未来若要在更弱后端开放本效果，需重新测一轮。**T9 全叠加终测**（全部特效同时在线，非临时关闭态）在 high 档稳定 60.0fps，≥55fps 门槛达标，边际成本总账收口，无需裁剪任何 P1 特效。

## 坑

- **GSAP 与 rAF 双时钟并存**：GSAP 有自己的内部 ticker，我们的场景用 host rAF 驱动 `scene.update`。纪律上让 GSAP **只 tween proxy 对象**（`sectionProxy {x,y,z,fov}` / `manualProxy {yaw,pitch,dist}`），每帧在 `update` 里把 proxy 读进 camera，绝不让 GSAP 直接改 `camera.position`——否则 GSAP ticker 的写入会与我们叠加的呼吸/微震/漂移/手动偏移在同一帧里打架（写入顺序不可控）。`gsap.ticker.lagSmoothing` 用默认即可，因为 GSAP 只算 proxy 的插值进度，真实相机变换由我们每帧统一组装。
- **`ease` 一律传 motion 曲线函数**：`ease: (t) => easeDrift(t)`，禁用 GSAP 内置 ease 名（'power2' 等），保持 Motion 宪法统一。
- **lookAt 会覆写 rotation**：相机每帧 `lookAt(0,0,0)`，所以「镜头微震/手持漂移/手动 yaw-pitch」不能直接写 `camera.rotation`（会被 lookAt 抹掉），改为把所有旋转折进一个 Euler，对「位置」绕原点 applyEuler（轨道式微旋），再 lookAt——与 M2 微视差同构，叠加顺序稳定。
- **dt 钳制沿用 M2**：喂 Spring 的 dt 钳 ≤1/30，防止大 dt 突刺让二阶弹簧发散（CAM_DT_CAP 纪律下移进 CameraDirector）。
- **dispose 清 tween**：`gsap.killTweensOf(sectionProxy/manualProxy)`，否则场景销毁后 GSAP ticker 仍持有 proxy 引用继续跑（内存/回调泄漏）。
- **`SpriteNodeMaterial.rotationNode`/`scaleNode` 在 three 0.183 无 API 漂移**：查 `node_modules/three/src/materials/nodes/SpriteNodeMaterial.js` 实测——`rotationNode` 是 `Node<float>`（弧度，`setupPositionView` 内 `float(rotationNode || materialRotation)` 直接参与 `rotate()`），`scaleNode` 是 `Node<vec2>`（`scale.mul(vec2(scaleNode))`，用于叠乘世界缩放）。`modelViewMatrix`、`atan(y, x)` 均在 `three/tsl` 正常导出（`atan` 两参数走 `atan2` 语义）。brief 骨架代码可直接落地，无需替代写法。
- **验收方式的机器状态前提**：真机验收若走"无头起 app + 控制台 fps 日志"路线没问题（GPU 合成器锁屏后仍继续跑，fps 数据可信）；但**截图**依赖屏幕解锁——`ioreg -r -d1 -k IOConsoleUsers` 查 `CGSSessionScreenIsLocked` 可提前确认，锁屏时 `screencapture`/`osascript activate` 只会拿到锁屏壁纸而非窗口内容，不能误当作有效截图。
- **`SpriteNodeMaterial.scaleNode` 里不能用内置 `positionView` 节点——会自引用递归**：T6 CoC 散景 brief 骨架写 `positionView.z.negate()` 算视深喂 `scaleNode`，真机冒烟第一次跑就炸：WGSL 编译报 `unable to parse right side of - expression`，生成代码里能看到字面量 `/* Recursion detected. */` 混进表达式。原因：`positionView` 这个内置节点的值是由 `SpriteNodeMaterial.setupPositionView()` 内部管线算出来的（billboard 展开等），而 `scaleNode` 恰恰是该管线的输入之一——于是 `position → 依赖 scaleNode → 依赖 positionView → 依赖 position`，成环。`colorNode`（片元阶段）里用 `positionView` 没事，因为片元阶段只是读一个已经算好的 varying，不参与顶点阶段自己的构建。**修复**：不要在任何参与 `SpriteNodeMaterial` 顶点位置管线的节点（`positionNode`/`scaleNode`/`rotationNode`）里引用内置 `positionView`；要用视空间坐标时，从材质已持有的 local 位置（本例是 `simPos = positions.element(instanceIndex)`）手算 `modelViewMatrix.mul(vec4(simPos, 1)).z`（与既有的 `velView` 手算模式同构）。这条坑对任何要在 SpriteNodeMaterial 顶点阶段用"深度/视空间坐标"做效果（雾化、近裁剪虚化等）的后续任务都适用。
- **`AfterImageNode`（T7 afterImage 拖尾）的 `damp` 是不可变 `ConstNode`，运行时改 `.value` 不生效**：`three/examples/jsm/tsl/display/AfterImageNode.js` 的工厂函数 `afterImage(node, damp) => new AfterImageNode(convertToTexture(node), nodeObject(damp))`——传纯数字时 `nodeObject(0.72)` 走 `ShaderNodeObject` 的 float 分支，落到 `getConstNode()`，生成的是 `ConstNode`（着色器里编译成字面量常量，`.value` 只是 JS 侧字段，改了也不会触发重新编译）。这与 `BloomNode` 形成鲜明对比——`BloomNode` 构造函数里显式 `this.strength = uniform(strength)`，所以 `bloomPass.strength.value = x` 天然生效。**修复**：自己先 `const trailDamp = uniform(0.72)` 建一个真正的 `UniformNode`，再传给 `afterImage(color, trailDamp)`——`nodeObject()` 对已经是 Node 的入参会原样返回（`getValueType(obj) === 'node'` 分支直接 `return obj`），所以 `afterImageNode.damp === trailDamp`，此后 `trailDamp.value = 0.9` 走的是 GPU uniform buffer 更新，不需要重新构建管线。**任何给 three 内置 TSL 效果节点传"运行时想动态改的数值参数"之前，先看它构造函数里是不是显式 `uniform(x)`；不是的话必须自己包一层，否则改值是静默失败（不报错、不报类型错，纯粹没反应）。**
- **`hash()`（three/tsl）只接受单个标量种子，不是 vec2**：brief 骨架 `hash(screenUV.mul(vec2(3840,2160)).add(uFrame))` 里塞进去的是 vec2——`three/src/nodes/math/Hash.js` 的 `hash = Fn(([seed]) => seed.toUint().mul(...)...)`，`seed` 若传 vec2 会导致内部标量运算（`toUint()`/位移/异或）在多数 three 版本里按分量广播成 vec2，返回值也变 vec2，和后续 `.sub(0.5).mul(2/255)` 拼起来仍是 vec2、加到 vec4 颜色上虽然能编译（vec2 + vec4 会走隐式类型提升规则，容易产生非预期的通道错位），**不是 brief 想要的标量 dither**。**修复**：手动把像素坐标线性化成一个标量种子——`screenUV.mul(screenSize)` 拿到像素坐标 `pixel`，`pixel.y.mul(screenSize.x).add(pixel.x)`（行主序线性索引，用实际 `screenSize` 而非硬编码 4K，适配任意窗口分辨率）再 `.add(frameId.toFloat())` 叠帧计数，喂给 `hash()` 得到标量 `[0,1)`。顺带发现 `frameId`（`three/tsl` 内置，`renderGroup` 挂载、每帧自动 `+1` 的 `UniformNode<uint>`）可以直接替代 brief 里"自建 uFrame 手动累加"的方案——不用在 `update()` 里再挂一个每帧自增的 uniform，省一处状态同步。
- **暗部 dither 必须接在色调映射之后，否则 AgX 把线性噪声压没**：`RenderPipeline` 默认 `outputColorTransform=true`，会在 `outputNode` **之后**自动套 `renderOutput(tone mapping + 色彩空间)`——也就是说默认情况下自己写的任何 `outputNode` 表达式都跑在 tone map **之前**的线性 HDR 空间。AgX 曲线对暗部有明显的非线性压缩（toe 区极平），线性空间加的 ±1/255 到了暗部会被压缩到远小于 1/255，起不到断色带的作用（这条本身没有报错也没有可见的 bug 现象——是"看起来能跑但达不到设计目的"的隐蔽坑，纯代码审查/单测都发现不了，只能靠理解 tone mapping 曲线的性质推出来）。**修复**：三本身提供了这个场景的官方写法（`RenderOutputNode` 类文档注释）——`pipeline.outputColorTransform = false` 关掉默认转换，手动 `renderOutput(withBloom)`（不传 toneMapping/outputColorSpace 参数，让它读 `RenderPipeline._update()` 塞进 `context` 的 renderer 当前值），dither 接在 `renderOutput()` 的结果后面。

## T9 视觉补验状态（2026-07-06）

- `ioreg -n Root -d1 | grep ScreenIsLocked` 实测 `CGSSessionScreenIsLocked=Yes`——**屏幕仍处于锁定状态**，未解锁。按坑记录"验收方式的机器状态前提"：锁屏时 `screencapture` 只会拿到锁屏壁纸，不能当作有效截图冒充验收证据。
- **视觉补验（光丝/散景/拖尾/角标可见性截图）待用户解锁后执行**，本轮未进行、也未用任何替代截图充数。T5/T6/T7/T8 四个任务遗留的"视觉待验"在此统一延后，不因文档收尾而视为已验收。
- fps 数据不受锁屏影响（GPU 合成器锁屏后仍继续跑），故 Step 3 全叠加终测正常执行，见上方"全叠加"行。

## M3 人工验收清单（写入待用户执行，非本任务可代为勾选）

- [ ] "哇塞"总验收：对照品牌故事——低频潮汐/碎光升起/鼓点雕刻/空间呼吸/黑暗舞台/宇宙爆炸，六条都能在一首歌里被"感受到"而非"识别出"
- [ ] 4.6 九条负面清单逐条 spot check（重点：⑤运镜段落级不晕、⑧角标显影感）
- [ ] 用户三点历史反馈复验：干脆利落的打击/多样的运动语言/背景融合
- [ ] 手动运镜：拖拽/滚轮/双击顺手，归位不突兀
- [ ] 挂机 30 分钟 + 快速切歌 10 次连击无异常
- [ ] 控制端视觉截图补验：光丝（速度拉伸）/散景（CoC）/拖尾（afterImage）/角标显影四项效果的真机截图确认——本轮（T9）因屏幕锁定未能完成，需用户解锁后由后续会话补拍（`/tmp/m3-final-{1,2,3}.png`，节奏音跑 60s，间隔 10s）

## 给 M4 的输入

- **场景层完成度**：M3 代码与自动化验证（测试/build/tsc/40s 全叠加 fps）全部通过；上面"M3 人工验收清单"5+1 项待用户执行后才算真正完成——尤其"哇塞"总验收和 4.6 负面清单 spot check 依赖真人主观判断，自动化测不出来。视觉截图补验（光丝/散景/拖尾/角标）因本轮屏幕锁定同样待补
- **M4 范围（设计第 5 节）**：首启引导（含 macOS 授权流程 UI）、置顶小窗、托盘、设置面板（性能档位/歌名开关/开机自启/小窗尺寸）、双平台安装包（不签名，附图文指引）
- **已知依赖**：media-control 需 brew install（分发时捆绑或引导安装——计划①遗留决策点）
- **工程债余额**：M2 终审 7 条中，M3-T1 清 2 条（host 重入守卫/失败路径释放）、M3-T2 清 3 条（RollingPeak 收口/trace 版本戳/quality 注释），共清 5 条；剩余 2 条未清——① `dispose` 不释放 4 个 storage buffer（M2-T6 记录，依赖"场景热切换"需求尚未到来，M4 若做多场景切换 UI 需先补）② 换歌中途 `targetColors` 瞬时色权重轻微跳变（M2-T11 记录，T9 人工验收此轮因视觉补验未能进行，是否可感知仍待验证，若可见再裁）
- **M3 各任务新记 Minor 遗留**：详见 `.superpowers/sdd/progress.md` "计划③" 段（M3-T1～M3-T8 共 8 条，含机位轮换滚轮累加死区、pointermove 绑 dom 非 window、CoC 视深不含 kick 位移、AfterImageNode 上游不 dispose 等）——均为已过审的 Minor 级别，不阻塞 M4 开工，建议 M4 排期时统一 triage 一次



## 终审记录（2026-07-06，Ready to merge）

必修三项已修（commit 18eef14）：①T4 苏醒调制结构性失效→AwakeningDirector 延迟决策（M2 基线起步+0.35s 观察窗定稿）；②drop 镜头包络上升沿触发；③滚轮 clamp。

**记账项（M4/后续 tuning）：**
- 炸歌冲量动态区间偏平（观察窗 0.35s 内能量包络仅爬 ~50%，kick 实际 0.60–0.62）——加大观察窗或用 instant 能量源是调参方向
- 非锚机位（OVERLOOK）滚轮有 ≤0.83 单位有界滞后
- index.ts kick 追加阈值 0.6 字面量与 M2_BASELINE 常量未共享
- M4 顺路清单：token 分支 dispose try、pointermove→setPointerCapture、hash01 第三份前收口、currentTrack 死字段
