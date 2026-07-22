#!/bin/bash
# 包内容审计（发布前必跑门禁）：防泄漏 + 捆绑完整性 + 签名 + 调试剥离四关
set -e
cd "$(dirname "$0")/.."
APP="dist/mac-arm64/Sonorus.app"
[ -d "$APP" ] || { echo "先 npm run dist"; exit 1; }
ASAR="$APP/Contents/Resources/app.asar"
LIST="$(npx --yes @electron/asar list "$ASAR")"

echo "== ① 防泄漏：asar 内不得出现开发内容 =="
LEAKS=$(echo "$LIST" | grep -iE "docs/|tests/|CLAUDE\.md|shapes-src|scripts/|native/|\.map$|^/node_modules" || true)
[ -z "$LEAKS" ] && echo "OK 无泄漏" || { echo "泄漏内容："; echo "$LEAKS"; exit 1; }

echo "== ② 捆绑完整性：Resources 必备文件 =="
for f in sonorus-tap media-control/bin/media-control media-control/lib/media-control/mediaremote-adapter.pl \
         media-control/Frameworks/MediaRemoteAdapter.framework assets/shapes/statue.bin assets/shapes/heart.bin \
         assets/licenses/media-control.txt; do
  [ -e "$APP/Contents/Resources/$f" ] && echo "OK $f" || { echo "缺 $f"; exit 1; }
done

echo "== ③ 签名 =="
codesign -dv "$APP" 2>&1 | grep -E "Signature|Identifier"

echo "== ④ 调试剥离：生产包不得含 debug/trace chunk =="
DBG=$(echo "$LIST" | grep -iE "^/out/.*debug|^/out/.*trace-controls" || true)
[ -z "$DBG" ] && echo "OK 已剥离" || { echo "含调试产物："; echo "$DBG"; exit 1; }

echo "✅ 审计通过"
