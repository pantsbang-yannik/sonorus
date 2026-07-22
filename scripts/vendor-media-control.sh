#!/bin/bash
# 把 Homebrew 安装的 media-control 全套复制进 vendor/（保持 FindBin 相对布局，原样可运行）
# 升级 vendored 版本时重跑本脚本再提交即可
set -e
cd "$(dirname "$0")/.."
SRC="$(brew --prefix)/Cellar/media-control"
[ -d "$SRC" ] || { echo "本机未装 media-control：brew install media-control"; exit 1; }
VER="$(ls "$SRC" | sort -V | tail -1)"
DST="vendor/media-control"
rm -rf "$DST"
mkdir -p "$DST"
cp -R "$SRC/$VER/bin" "$SRC/$VER/lib" "$SRC/$VER/Frameworks" "$DST/"
cp "$SRC/$VER/README.md" "$DST/"
echo "vendored media-control $VER -> $DST"
