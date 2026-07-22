# trace fixtures 口径说明

## v1（`zilaishui.jsonl` / `tiaowu.jsonl` / `qimeidi.jsonl`）

真机采集的原始回放，`bands`/`spectrum` 是麦克风原始特征场，**可信、长期复用**。
但 `energy`(e) / `onBeat`(ob) / `beat.strength`(bs) / `drop`(dr) 这几个字段是**旧引擎的成品输出**
（校准前，`e` 长期饱和在 ≈0.998）——只作耻辱柱基线，不代表当前引擎行为。
`tests/engine/calibration-*.test.ts` 只吃这三份的 `bands`/`spectrum` 原始场，在测试里用新引擎重新算
`e`/`ob`/`dr`，不读文件里已经存好的旧成品字段。

回放消费纪律：energy/drop/silence 请一律经当前 EnergyTracker 重算（见 calibration-drop/calibration-narrative 的 replay 口径）——fixture 烤死的 e/dr/si 字段是录制时旧判据的产物，不作输入。

## v2（`zilaishui-v2.jsonl` / `tiaowu-v2.jsonl` / `qimeidi-v2.jsonl`）

拿 v1 同一份 `bands`/`spectrum` 原始场，喂给 T2-T4 标定后的新引擎（`EnergyTracker`/`BeatDetector`，
与 `calibration-*.test.ts` 同款 `specLoud` 公式/采样率/HOP）重新算出 `e`/`ob`/`bs`/`dr`/`bpm`，
其余字段（`bands`/`spectrum`/`loudness`/`silence`/`t`）原样保留。用于 `TracePlayer` 拖拽回放亲验——
是目前唯一「读起来就是新引擎真实节奏密度」的三份 fixture。

`t` 字段沿用 v1 的绝对时间戳（三首歌是同一次连续采集会话中依次录的，起始秒数非 0），
`TracePlayer` 按首帧 `t` 归一化播放，不影响回放；时长仍以每份自身的首尾差为准。

## 量化格式

每行一个 JSON：`v` 版本戳，`t/li/ls/bl/bm/bh/ob/bs/bpm/e/dr/si` 为标量字段（缩写见
`src/engine/trace.ts` 的 `serializeSignal`），`sm/sd` 是频谱按峰值归一化后的 Uint8 + base64（512 bins）。
