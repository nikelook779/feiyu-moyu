#!/bin/sh
# 肥鱼摸鱼大作战 —— 一键启动（macOS / Linux）
# 纯前端游戏，其实直接双击 index.html 也能玩；
# 这个脚本会起一个本地服务器再打开浏览器，兼容性更好。

cd "$(dirname "$0")" || exit 1

PORT=8899
URL="http://127.0.0.1:$PORT/index.html"

echo ""
echo "  ============================================"
echo "     肥鱼摸鱼大作战  -  正在启动..."
echo "  ============================================"
echo ""

PY=""
for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1; then PY="$c"; break; fi
done

if [ -z "$PY" ]; then
  echo "  [!] 没检测到 Python，直接用浏览器打开 index.html"
  if command -v open >/dev/null 2>&1; then open index.html
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open index.html
  else echo "      请手动打开 index.html"; fi
  exit 0
fi

echo "  正在启动本地服务器 (:$PORT)..."
"$PY" -m http.server "$PORT" --bind 127.0.0.1 &
SERVER_PID=$!
sleep 1

echo "  打开浏览器..."
if command -v open >/dev/null 2>&1; then open "$URL"
elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
else echo "  请手动访问 $URL"; fi

echo ""
echo "  ------------------------------------------------"
echo "   游戏已打开。按 Ctrl+C 结束服务器。"
echo "  ------------------------------------------------"
echo ""

trap 'kill $SERVER_PID 2>/dev/null; echo ""; echo "  服务器已停止，下次摸鱼见！"; exit 0' INT TERM
wait $SERVER_PID