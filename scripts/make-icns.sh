#!/bin/bash
# build/icon-src.png（1024×1024）→ build/icon.icns（sips+iconutil 纯系统工具，无新依赖）
# 无素材时静默跳过——electron-builder 会用默认图标出包，图标素材到位后重跑本脚本再 dist
set -e
cd "$(dirname "$0")/.."
SRC="build/icon-src.png"
[ -f "$SRC" ] || { echo "缺 $SRC（1024×1024 PNG），跳过图标生成"; exit 0; }
ICONSET="build/icon.iconset"
rm -rf "$ICONSET"; mkdir -p "$ICONSET"
for s in 16 32 64 128 256 512; do
  sips -z $s $s "$SRC" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s*2))
  sips -z $d $d "$SRC" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o build/icon.icns
rm -rf "$ICONSET"
echo "built build/icon.icns"
