# 形状阵容打磨期·第一期阵容调研与定稿（2026-07-11）

> 本文是形状阵容打磨期的立项输入：外部调研（deep-research，5 角度 ×15+ 来源）× 内部现状（代码摸底）合成，
> 阵容名单已经用户拍板定稿。方言配置按纲领（spec Phase C §9：每形状专属运动约束）逐个后配。

## 一、定稿阵容（7 卡）

| 卡位 | 形状 | 处置 | 专属运动约束方向（方言期落地） |
|---|---|---|---|
| 1 | 星云 nebula | 保留 | 自由态 curl 漂浮（已有） |
| 2 | 星球 sphere | 保留 | 区域呼吸沿球心径向（已有，fb1 定稿） |
| 3 | 线框晶体 | 新增 | 粒子沿二十面体棱边采样；鼓点→棱边法线尖刺、内核亮度打拍、波前沿棱边传播 |
| 4 | 涡旋星系 | 新增 | 多吸引子力场；涡旋拧转=spinning 强度绑音频、蓄力=引力收缩、drop=外抛 |
| 5 | 同心环阵 | 新增 | 多层全息环（FUI）；逐环错峰打拍（cell id 相位偏移）、蓄力=环收拢 |
| 6 | 正弦雕塑 | 新增 | 嵌套正弦波扭曲球体；变形波振幅/频率直接绑音频包络 |
| 7 | 轮廓粒子 | 新增 | 3D 模型表面采样；外形稳定＋表面法线浮雕（鼓面模式推广到任意曲面）、drop=崩解重聚 |
| — | 波形 wave / 星环 ring | **淘汰** | 用户 2026-07-11 拍板（造型不美观，环阵=星环升维替代） |

**轮廓粒子题材（用户拍板）**：第一期先跑通 **人形雕塑 + 心脏** 两个模型，其他题材（宇航员/手/文字 Logo）后续拓展。
采样管线通用，模型可替换。

## 二、关键技术判断

- **全部 7 卡留在粒子范式**：同一 40 万点云吸附不同目标点集，共用 morph/碎散聚切换体系。新形状=生成器 + 注册表一行 + 剪影 SVG（`src/scenes/nebula/shapes/index.ts`）。
- **轮廓粒子的真增量**：
  - 几何：GLTF 加载 + `MeshSurfaceSampler` 表面采样 → Float32Array（离线/启动时一次）。
  - 运动：需**逐粒子法线 buffer**（现只有 `uTargetPlanar` 平面法线模式）——把封面鼓面模式推广到任意曲面，是纲领要求的每形状约束，不是绕路。
  - 资产：需 CC0 授权模型（人形雕塑、解剖心脏）。Smithsonian 3D / Sketchfab CC0 是候选源。
  - **morph-particles（MisterPrada）无 license，只借思路不抄代码**——见 `2026-07-10-morph-particles-study.md`。
- **SDF/raymarching（液态融球、Mandelbulb）判为二期**：TSL 写 raymarch 已被业界验证同栈可行（Codrops 液态教程），但需另立渲染管线 + 跨范式切换机制，作为未来"英雄形态"独立立项。

## 三、调研提炼：未来感三路线（阵容各占一席）

| 路线 | 本阵容代表 | 来源 |
|---|---|---|
| 体积/全息态（"体积化设计=暗示先进科技的主流手法"） | 星云、涡旋星系、轮廓粒子 | Territory Studio（攻壳/普罗米修斯 FUI）访谈 |
| 有机生命感（形态自带运动人格） | 正弦雕塑、轮廓粒子 | Universal Everything《Tribes》《Portrait II》 |
| FUI 几何硬边（环/刻度盘/线框） | 线框晶体、同心环阵 | HUDS+GUIS 档案库 |

## 四、运动设计公理（业界验证，方言期直接引用）

1. **三段式**：蓄力→命中→消散（"凭空出现的法术不好看——它要生长和脉动"）——与叙事三幕同构。
2. **双层驱动**：拍点 impulse + 慢变形底噪 rhythm（MilkDrop 二十年传统）——与 curl 底色+事件波前同构。
3. **每形态专属剪影+专属运动约束**保证一瞬可读（游戏 VFX 教条）——即纲领。
4. **防拧散稳定器**：速度阻尼 + maxSpeed 钳制（three.js 官方吸引子示例）——对应封面被拧散教训（C2-fb2/fb3）。

## 五、可落地参考源（实现期抄作业清单）

| 形状 | 参考 | 链接 |
|---|---|---|
| 线框晶体 | Codrops 2025 教程（icosahedron 线框+内发光核，audioLevel×噪声沿法线位移） | https://tympanus.net/codrops/2025/06/18/coding-a-3d-audio-visualizer-with-three-js-gsap-web-audio-api/ |
| 涡旋星系 | three.js 官方 WebGPU TSL 吸引子示例（262k 粒子，spinningForce/阻尼/钳速全套） | https://threejs.org/examples/webgpu_tsl_compute_attractors_particles.html |
| 同心环阵 | iq 域重复+cell id 相位偏移；HUDS+GUIS 形态语汇 | https://iquilezles.org/articles/raymarchingdf/ |
| 正弦雕塑 | iq Sculpture 系列（sin 嵌套扭曲球体）；可逆动画函数防纹理游动 | 同上 |
| 轮廓粒子 | morph-particles（只借思路）+ Wawa Sensei TSL GPGPU 模型 morph 课 + NIBI 开源引擎（同栈，13 流场+16 成形动画库结构） | https://github.com/monoton-music/nibi |
| 方言分层架构佐证 | Territory「设计行为封装 widget」= 我们方言库架构；NIBI 四阶段状态机（流动→成形→驻留→释放） | docs 本文 §三、§四 |

原始调研材料（24 组搜索/声明提取）本次会话已消化进上表，未单独入库。
