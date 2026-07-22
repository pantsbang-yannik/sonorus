# morph-particles 调研笔记（未来采样生成器的参考）

> 日期：2026-07-10 · 调研对象：https://github.com/MisterPrada/morph-particles（demo: https://christmas.misterprada.com）
> 触发：B1 亲验期用户提供；「碎散聚」切换编排（B1-fb3, 91435d3）已借用其思路

## ⚠️ 使用红线

- **仓库无 license（license: null）**：版权保留，**任何代码不得复制进本仓库**。本文档只记录思路与手法，全部用自己的话与我们的术语转述。
- 技术栈不通用：它是 WebGL + GLSL + FBO/GPGPU 数据贴图；我们是 WebGPU + TSL + instancedArray storage buffer。照抄在技术上也不成立。

## 一、它的架构（拆解）

**总路线：纯插值动画，无物理。** 每个形状预烘焙成一张「位置数据贴图」（FloatType + NearestFilter，一像素=一粒子坐标），仿真 pass 里按滚动进度在两张贴图间 `mix`，粒子直线奔向目标。果断、精准，但粒子不对任何外部信号（音乐/流场）做反应。

### 概念对照表（它 ↔ 我们）

| morph-particles | Sonorus 等价物 | 备注 |
|---|---|---|
| 每形状一张 DATA texture | `targets` storage buffer + `setTargets(cloud)` | 我们只存「当前目标」，切换时整体重写——等价且更省显存 |
| uScroll 分段选形状对 | `ShapeSettings.current` + 仲裁 resolveShape | 它是滚动驱动连续插值，我们是事件驱动切换 |
| `random(vUv)` 逐粒子随机 | `hash(instanceIndex)` | 同一目的：逐粒子去相关 |
| 仿真 pass 纯 mix 插值 | 弹簧物理（grip × 刚度） | **路线分歧点**，见「反面结论」 |

## 二、可借的三个手法

### 1. 逐粒子过渡窗口错开（stagger）——已借用 ✅

它「利落又不机械」的关键：每个粒子的过渡窗口被随机偏移约 20%——伪码语义（自述，非原码）：

```
r = perParticleRandom() * 0.2          // 每粒子固定随机数
t = remap(clamp(progress - r*0.5, 0, 段长 - r), 0, 段长 - r, 0, 1)
pos = mix(shapeA, shapeB, smooth(t))   // 有的粒子先启程/先到站
```

整体读起来像「碎开再汇聚」，其实没有真散开。**B1-fb3 的借用方式**：碎散聚编排里，炸开方向 `hash(i+31/37/41)` 与聚合刚度参差 `0.7+hash(i+47)*0.6`（uGather stagger）承接同一思想，但走我们的物理路径（冲量+刚度）而非插值路径。

### 2. 模型/几何体 → 粒子点云（未来采样生成器的核心参考）⭐

它的 `makeTexture(geometry)` 手法（语义转述）：

1. **顶点直取**：`geometry.attributes.position` 的顶点坐标就是粒子坐标（不重采样）。贴图尺寸 = `ceil(sqrt(顶点数))` 平方铺开。
2. **按三洗牌（关键细节）**：把顶点数组按 xyz 三元组做 Fisher-Yates 洗牌——**打断粒子索引与网格拓扑的相关性**。不洗牌的话，morph 时相邻粒子来自模型同一区域，过渡会出现「整块撕裂平移」的机械感；洗牌后每个粒子的起点/终点随机配对，过渡自然成「弥漫重组」。
3. 形状间顶点数不同 → 贴图容量取最大，不足处留空/复用。

**移植到我们的 ShapeDef.generate 时的适配清单**：

- 接口天然兼容：`generate(count): ShapePointCloud` 就是「生成 count×3 的 positions」——GLTF/文字轮廓/Logo 的采样生成器只是新的 generate 实现，架构零改动。
- **顶点直取 vs 表面均匀采样**：顶点直取密度跟着网格布线走（密集处粒子堆积）；对艺术模型建议用 three 的 `MeshSurfaceSampler` 按面积均匀采样到恰好 count 个点——顺带解决顶点数≠count 的适配（我们 setTargets 的 `i%n` 取模复用只适合点数相近的场合）。
- **洗牌必做，但要确定性**：用我们的 `makeXorshift(seed)`（shapes/rand.ts）替代 Math.random 做 Fisher-Yates——同一形状每次生成结果一致（记忆化缓存与测试都依赖确定性，这是它没有而我们必须有的约束）。
- 文字形状可走另一条现成路：Canvas 画字 → `sampleCoverPoints`（cover-points.ts）像素采样——封面管线直接复用，连颜色都有。
- 坐标域约束记得套：软边界半径（低能量收至 1.8），参考 wave.ts 的 |x|≤1.7 处理与包络单测。

### 3. 减速插值曲线

它用 `t*t*(3-2t)`（smoothstep 形）做过渡减速——到站前收油，避免戛然而止。我们的 easeStandard/easeImpact 体系已覆盖，无需引入，仅记录印证：**「果断」≠ 匀速，是快启动+软到站**。

## 三、反面结论（明确不借的）

- **不换插值架构**：它的粒子不受音乐/流场/鼓点影响——那是我们的命根子。Sonorus 的果断感由「切换窗口内冲量 + 临时高刚度」在物理框架内实现（B1-fb3），律动零损失。
- **不引入 FBO/数据贴图多形状常驻**：我们事件驱动切换 + (id,count) 记忆化已等价，常驻 N 张贴图是它滚动连续插值才需要的。

## 四、落地状态

- 已借用：stagger 思想 + 直接位移的果断感 → B1-fb3 碎散聚（uShatter/uGather，commit 91435d3，零代码引入）。
- 待借用（形状库扩张时）：§二.2 的采样生成器适配清单——做「文字/Logo/任意模型」形状卡片时按此执行。
