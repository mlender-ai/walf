#!/bin/zsh
# WALF 오픈소스 탐색 엔진 준비 — Ollama(로컬 사진 분석)와 SearXNG(검색)를 띄운다. 몇 번 실행해도 같다.
# 사용: ./engine/start.sh
set -euo pipefail
HERE=${0:A:h}
HOME_OSS=${WALF_OSS_HOME:-$HOME/.walf-oss}
MODEL=${WALF_OSS_VLM:-qwen3-vl:8b}
mkdir -p "$HOME_OSS/searxng"

# 1) Python 가상환경(Crawl4AI)
if [ ! -x "$HOME_OSS/venv/bin/python" ]; then
  python3 -m venv "$HOME_OSS/venv"
  "$HOME_OSS/venv/bin/pip" install -q crawl4ai httpx pillow
  "$HOME_OSS/venv/bin/crawl4ai-setup"
fi

# 2) Ollama — 로그인할 때마다 자동으로 켜지게 brew 서비스로
command -v ollama >/dev/null || brew install ollama
brew services list | grep -q '^ollama.*started' || brew services start ollama
for i in {1..20}; do curl -sf localhost:11434/api/version >/dev/null && break; sleep 1; done
ollama list | grep -q "^${MODEL} " || ollama pull "$MODEL"

# 3) SearXNG — 이 맥에서만 열리는 8888 포트. 비밀값은 저장소 밖(~/.walf-oss/searxng/secret)에 둔다.
cp "$HERE/searxng/settings.yml" "$HOME_OSS/searxng/settings.yml"
[ -s "$HOME_OSS/searxng/secret" ] || openssl rand -hex 32 > "$HOME_OSS/searxng/secret"
if ! docker ps --format '{{.Names}}' | grep -q '^walf-searxng$'; then
  docker rm -f walf-searxng >/dev/null 2>&1 || true
  docker run -d --name walf-searxng --restart unless-stopped -p 127.0.0.1:8888:8080 \
    -v "$HOME_OSS/searxng:/etc/searxng" -e SEARXNG_SECRET="$(cat "$HOME_OSS/searxng/secret")" \
    searxng/searxng:latest >/dev/null
fi
for i in {1..30}; do curl -sf 'localhost:8888/healthz' >/dev/null && break; sleep 1; done
echo "Ollama  $(curl -s localhost:11434/api/version) · 모델 $MODEL"
echo "SearXNG $(curl -s -o /dev/null -w '%{http_code}' 'localhost:8888/search?q=test&format=json') (200이면 정상)"
