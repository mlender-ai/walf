"""역이미지 검색 — SerpApi Google Lens(공식 API, 무료 250회/월).

흐름: 로컬 사진 업로드(POST https://serpapi.com/image, 500KB 이하, image_id 10분 유효)
     → GET https://serpapi.com/search?engine=google_lens&image_id=…&type=all|visual_matches|exact_matches
결과마다 순위·제목·주소(link: 이미지가 실린 페이지)·출처·썸네일·가격 표기를 그대로 남긴다.
돈이 나가지 않게: 키는 ~/.walf-oss/keys.env 의 WALF_SERPAPI_KEY, 스스로 정한 월 상한(sources.LIMITS),
오류·한도 응답이 오면 그 실행을 멈춘다. 유료 플랜·자동 갱신은 쓰지 않는다.
"""
from __future__ import annotations

import os
import time

import httpx

import sources

UPLOAD = "https://serpapi.com/image"
SEARCH = "https://serpapi.com/search"


class LensError(Exception):
    pass


class Lens:
    def __init__(self, log=print):
        self.key = sources.load_keys().get("WALF_SERPAPI_KEY")
        self.log = log
        self.client = httpx.Client(timeout=60)
        self.calls = 0

    def ready(self) -> str:
        return "ready" if self.key else "키 없음(~/.walf-oss/keys.env 의 WALF_SERPAPI_KEY)"

    def upload(self, path: str) -> str:
        if os.path.getsize(path) > 500_000:
            raise LensError(f"{os.path.basename(path)} 가 500KB 를 넘어요")
        with open(path, "rb") as f:
            r = self.client.post(UPLOAD, data={"api_key": self.key}, files={"image": (os.path.basename(path), f, "image/jpeg")})
        d = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        if r.status_code != 200 or "image_id" not in d:
            raise LensError(f"업로드 실패 HTTP {r.status_code} {str(d.get('error') or r.text)[:160]}")
        return d["image_id"]

    def search(self, image_id: str, kind: str, *, hl: str = "ko", country: str = "kr") -> dict:
        if sources.over_cap("serpapi"):
            raise LensError("스스로 정한 SerpApi 월 상한에 닿아 멈춤")
        t0 = time.monotonic()
        r = self.client.get(SEARCH, params={"engine": "google_lens", "image_id": image_id, "type": kind, "hl": hl, "country": country, "api_key": self.key})
        ms = int((time.monotonic() - t0) * 1000)
        d = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        cached = (d.get("search_metadata") or {}).get("status") == "Success" and (d.get("search_information") or {}).get("cached") is True
        if not cached:
            sources._count("serpapi")
        self.calls += 1
        if r.status_code != 200 or d.get("error"):
            raise LensError(f"검색 실패({kind}) HTTP {r.status_code} {str(d.get('error') or r.text)[:200]}")
        rows = []
        for key in ("exact_matches", "visual_matches"):
            for x in d.get(key) or []:
                rows.append({"list": key, "position": x.get("position"), "title": x.get("title", ""), "link": x.get("link", ""), "source": x.get("source", ""),
                             "thumbnail": x.get("thumbnail", ""), "image": x.get("image", ""), "price": x.get("price") if isinstance(x.get("price"), str) else (x.get("price") or {}).get("value"),
                             "in_stock": x.get("in_stock"), "date": x.get("date")})
        self.log(f"  [lens:{kind}] {len(rows)}건 · {ms}ms{' (캐시)' if cached else ''}")
        return {"type": kind, "ms": ms, "cached": cached, "rows": rows, "search_id": (d.get("search_metadata") or {}).get("id"),
                "related": [x.get("title") for x in (d.get("related_content") or [])][:10]}
