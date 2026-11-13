#!/bin/sh
# 安全停止：点击只记录，不执行 agent.focus；等日志门禁验证后再打开。
target="$1"
log="$HOME/.config/herdr-app/notify-click.log"
FOCUS_ENABLED=1
case "$target" in
  ''|*[!A-Za-z0-9._:/-]*) exit 2 ;;
esac

if [ -f "$log" ] && [ "$(wc -c < "$log" 2>/dev/null || echo 0)" -gt 65536 ]; then
  tail -n 80 "$log" > "$log.tmp" 2>/dev/null && mv "$log.tmp" "$log" 2>/dev/null || true
fi

HERDR_APP="${HERDR_APP:-$HOME/.local/bin/herdr-app}"
if [ ! -x "$HERDR_APP" ]; then
  HERDR_APP="$(command -v herdr-app 2>/dev/null || true)"
fi

write_log() {
  printf '{"t":%s,"kind":"%s","target":"%s"}\n' "$(date +%s)000" "$1" "$target" >> "$log" 2>/dev/null || true
}

if [ "$FOCUS_ENABLED" = "1" ] && [ -n "$HERDR_APP" ] && [ -x "$HERDR_APP" ] && "$HERDR_APP" do agent.focus --terminal "$target" >/dev/null 2>&1; then
  write_log click-ok
else
  if [ "$FOCUS_ENABLED" = "0" ]; then
    write_log click-suppressed
    /usr/bin/osascript -e 'display notification "跳转已暂停，请回到 Herdr 处理" with title "Herdr 提醒"' >/dev/null 2>&1 || true
  else
    write_log click-failed
    /usr/bin/osascript -e 'display notification "跳转失败，请回到 Herdr 点击「前往」" with title "Herdr 提醒"' >/dev/null 2>&1 || true
  fi
fi
