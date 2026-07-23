# Spike: WebGPU VideoTexture + TSL texture() 节点（视频背景 v2 T1）

## 结论：通

`THREE.VideoTexture` 在 WebGPURenderer 下逐帧自动更新成立；TSL `texture()` 节点接 `uv().mul(uUvScale).add(uUvOffset)` 变换、外层再 `.mul(uBright)` 乘 uniform 亮度——两条链路都正常工作，无需任何 fallback（`tex.needsUpdate` 手动置位分支未启用，也未观察到需要它的迹象）。Task 7（`show(id, kind)` 封装）可直接在此结论上继续，不用另设保险绳。

## 验证环境

- Electron 43.0.0（`node_modules/electron/dist/Electron.app`，`npx electron --version` 确认）
- three 0.183.2（`package.json` 锁定版本，与 M2/M3 spike 环境一致）
- electron-vite 5，`npm run dev` 开发模式
- macOS（Darwin 25.5.0，arm64）
- 与 M2/M3 spike 同一套真机环境，未见新增环境差异

## 验证手段

`canvas.captureStream(30)` + `MediaRecorder`（`video/webm`）自生成 3 秒变色视频（HSL hue 每 33ms +7，循环变色），录制完成后 `URL.createObjectURL` 喂给 `UserBackdrop.showVideoUrl()`，5 秒延迟自动触发（临时探针钩子，验证后已整块移除，`index.ts` 无残留）。零外部文件依赖。

**截图对比**（`npm run dev` 起 app，`showVideoUrl` 生效后用 `screencapture -x` 连续多次采样）：

| 采样对 | 时间间隔 | 观察颜色 |
|---|---|---|
| 第一组 | 2s | 橄榄绿 → 金棕色 |
| 第二组 | 1.5s | 蓝色 → 橄榄绿 |

两组独立采样均观察到背景整屏被单一 flat 颜色铺满（对应 canvas 生成视频里 `fillRect` 的整帧填色），且相邻采样点颜色明显不同、随时间连续变化——与 hue 每帧递增的生成逻辑吻合。这证明：
1. `VideoTexture` 确实在每一帧读取 `<video>` 当前播放位置的新画面（而不是首帧静态贴图或黑屏）。
2. 视频在 WebGPURenderer 场景里正常 `play()`/`loop`，没有因为跨进程/沙箱限制卡住解码。

（过程中一度因 Telegram 窗口遮挡、`osascript activate` 与其他前台应用抢焦点，导致前几张截图拍到了别的窗口——这是截图操作问题，非渲染问题；用 `System Events` 隐藏遮挡应用 + 反复 `activate` 后拿到的有效样本如上表。）

## 坑（本次未新增，复核 M2/M3 清单后确认可直接套用）

- 换贴图必须重建 `colorNode`（`texture()` 节点闭包持有旧 `tex` 引用）——`user-backdrop.ts` 图片路径（`show()`）与视频路径（`showVideoUrl()`）都遵循这条纪律，重建后设 `mat.needsUpdate = true`。
- uniform 字段禁止显式类型注解（`ReturnType<typeof uniform>` 塌 unknown 泛型坑，`user-backdrop.ts:36` 注释已记录）——`showVideoUrl` 复用既有 `uUvScale`/`uUvOffset`/`uBright`，未新增 uniform，未触发这条坑。
- 未触及 M2 坑清单里的 storage buffer / SpriteNodeMaterial 顶点管线相关坑（`VideoTexture` 走的是普通 `MeshBasicNodeMaterial.colorNode`，不涉及 `positionNode`/`scaleNode`），本次未发现新坑。

## 对 Task 7 的输入

- **无需 fallback**：`tex.needsUpdate = true` 手动置位分支不需要写进正式实现，`THREE.VideoTexture` 默认行为已经满足逐帧更新。
- `showVideoUrl(url)` 已落地在 `UserBackdrop`（`canplay` 才算就绪、失败/迟到自弃释放 `<video>`、`dispose()` 里补了 `releaseVideo()`），Task 7 可直接在其上包一层 `show(id, kind)` 做图片/视频分流，不用重新设计加载状态机。
- 遗留的唯一不确定项：本次只验证了自生成的纯色 webm（分辨率 640×360，无音轨），没有验证真实视频文件（更高分辨率/含音轨/不同编码）在同一路径下的表现——如果 Task 7 要接入用户实际上传的视频文件，建议开工前用一个真实 mp4/webm 样本跑一遍 `showVideoUrl`，确认 `canplay` 事件与 `videoWidth/videoHeight` 读取在真实文件上同样可靠（自生成 canvas 视频天然没有编码/容器兼容性问题，不能完全代表真实用户文件）。

## 代码改动摘要

- `src/scenes/nebula/user-backdrop.ts`：新增 `video` 私有字段、`showVideoUrl(url): Promise<boolean>`、`releaseVideo()`；`dispose()` 补 `releaseVideo()` 调用。
- `src/scenes/nebula/index.ts`：临时探针钩子（验证后已移除，无残留）。

## 亲验实锤补充（2026-07-22 真实 mp4 全黑排障结论——三层根因，缺一即黑）

探针只验了 MediaRecorder 自生成 webm（软解帧+blob URL 同源），真实 H.264 mp4 走 audelyra-bg:// 协议时三层全断：

1. **scheme 特权不足**：仅 `stream: true` 时，非 standard scheme 在渲染层不被当合法媒体源——`<video>` 直接 `MEDIA_ERR_SRC_NOT_SUPPORTED`，fetch 也 `Failed to fetch`。必须 `{ standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true }` 全家桶。
2. **net.fetch(file://) 无视 Range 头**：回 200 无 Content-Length 分块流，mp4 在媒体栈判不可用。协议 handler 必须手工实现 range 语义（stat 总长 + parseByteRange 纯函数 + 206/Content-Range/Content-Length + fs.createReadStream 切片流）。修后可观测到媒体栈发中段 range 寻址请求。
3. **跨源 taint**：协议对页面是跨源，能播但像素抽取全被拒——`VideoTexture` 每帧 `copyExternalImageToTexture(video元素)` 报 "fails extracting valid resource"，`new VideoFrame(video)` 报 "tainted sources"。必须协议响应带 `Access-Control-Allow-Origin: *` + video 元素 `crossOrigin='anonymous'` 成对出现（只加 ACAO 不设 crossOrigin 仍 taint；只设 crossOrigin 无 ACAO 则 CORS 失败回落）。

**渲染层最终形态**：弃 `VideoTexture`（元素抽帧路径对硬解帧不稳），用 `VideoFrameTexture` + `requestVideoFrameCallback` 泵帧（rvfc 时刻 `new VideoFrame(video)` 走 WebCodecs 拷贝路径，硬解 H.264 帧稳定上屏；上一帧在新帧落定后 close 防 GPU 句柄泄漏）。

**次级缺陷**：缩略图在 loadeddata 直画常得黑帧（黑场淡入开头+硬解首帧未必可抽）——seek 0.5s 等 seeked 再画。
