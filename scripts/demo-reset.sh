#!/bin/bash
# 新用户态模拟（录屏/演示用）：备份 → 重置 → 录完恢复。
# 重置的是 userData（settings.json / history / custom-shapes / backgrounds），不碰代码与系统权限。
# 铁律：任何 reset 前自动全量备份，恢复只需 restore <备份目录>。
set -e

DATA="$HOME/Library/Application Support/audelyra"
BACKUP_ROOT="$HOME/Library/Application Support/audelyra-demo-backups"

# 重置目标：用户可见的"痕迹"四件套（Cache/GPUCache 等 Electron 内部件不动——
# 清了只会让录屏首帧变卡，与新用户观感无关）
TARGETS=(settings.json history custom-shapes backgrounds)

usage() {
  cat <<'EOF'
用法：
  bash scripts/demo-reset.sh backup                   仅备份当前数据
  bash scripts/demo-reset.sh reset [--keep-history]   备份后重置为新用户态
                                                      --keep-history 保留听歌历史（星系图鉴不空）
  bash scripts/demo-reset.sh restore <备份目录>        回滚到某次备份
  bash scripts/demo-reset.sh list                     列出所有备份

录屏流程：reset → npm run dev 录制 → restore <刚才的备份目录>
EOF
}

assert_app_closed() {
  # 应用退出时会把内存里的 settings 写回磁盘，跑着重置等于白重置
  if pgrep -f "Audelyra|electron.*audelyra" > /dev/null 2>&1; then
    echo "⛔ Audelyra / dev 进程还在跑——请先完全退出（⌘Q）再重置，否则退出时会覆盖回旧设置"
    exit 1
  fi
}

do_backup() {
  local stamp dest
  stamp="$(date +%Y%m%d-%H%M%S)"
  dest="$BACKUP_ROOT/$stamp"
  mkdir -p "$dest"
  for t in "${TARGETS[@]}"; do
    [ -e "$DATA/$t" ] && cp -R "$DATA/$t" "$dest/" || true
  done
  echo "$dest"
}

case "${1:-}" in
  backup)
    [ -d "$DATA" ] || { echo "没有 userData 目录，应用还没跑过？"; exit 1; }
    echo "✅ 已备份到：$(do_backup)"
    ;;

  reset)
    [ -d "$DATA" ] || { echo "没有 userData 目录——本来就是新用户态，直接 npm run dev 即可"; exit 0; }
    assert_app_closed
    KEEP_HISTORY=0
    [ "${2:-}" = "--keep-history" ] && KEEP_HISTORY=1
    BACKUP="$(do_backup)"
    echo "✅ 已备份到：$BACKUP"
    for t in "${TARGETS[@]}"; do
      [ "$t" = "history" ] && [ "$KEEP_HISTORY" = "1" ] && { echo "   保留 history（--keep-history）"; continue; }
      rm -rf "$DATA/${t:?}"
      echo "   已清 $t"
    done
    echo ""
    echo "🎬 现在是新用户态：settings 全默认（onboarded=false → 首启引导序幕会播）"
    [ "$KEEP_HISTORY" = "1" ] && echo "   听歌历史保留，星系图鉴有内容"
    echo "   录完回滚： bash scripts/demo-reset.sh restore $BACKUP"
    ;;

  restore)
    DIR="${2:-}"
    [ -d "$DIR" ] || { echo "⛔ 备份目录不存在：$DIR"; echo; usage; exit 1; }
    assert_app_closed
    for t in "${TARGETS[@]}"; do
      rm -rf "$DATA/${t:?}"
      [ -e "$DIR/$t" ] && cp -R "$DIR/$t" "$DATA/" || true
    done
    echo "✅ 已恢复自：$DIR"
    ;;

  list)
    ls -1 "$BACKUP_ROOT" 2>/dev/null || echo "还没有备份"
    ;;

  *)
    usage
    ;;
esac
