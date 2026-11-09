"""GATE 1 — FAR FROM WHAT 착장 사진 역이미지 검색(SerpApi Google Lens). 사진 3장 × 검색 3종 = 최대 9회.

    python gate1.py            → engine/reports/gate1-<시각>.json · .md

사진: ~/.walf-oss/gate1/ (저장소 밖)
  a_original_faceblur.jpg  원본(인물 얼굴 흐림)
  b_garment_crop.jpg       의류 크롭(턱 아래~밑단, 자막 겹침)
  c_upper_crop.jpg         상반신 크롭(칼라·가슴 지퍼 포켓)
정답·오답 표시는 결과를 다 받은 뒤에만 붙인다(검색에는 아무 단서도 넣지 않는다 — 블라인드).
"""
from __future__ import annotations

import json
import os
import re
import sys
import time

from lens import Lens, LensError

DIR = os.path.expanduser("~/.walf-oss/gate1")
IMAGES = [("원본(얼굴 흐림)", "a_original_faceblur.jpg"), ("의류 크롭", "b_garment_crop.jpg"), ("상반신 크롭", "c_upper_crop.jpg")]
TYPES = ["all", "visual_matches", "exact_matches"]
TARGET = re.compile(r"far\s*from\s*what|farfromwhat|fararchive|파프롬왓|far wool arm|arm[\s-]*cutline", re.I)
DECOY = re.compile(r"andros|안드로스", re.I)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reports")
LOG: list[str] = []


def log(*a):
    line = time.strftime("%H:%M:%S ") + " ".join(map(str, a))
    LOG.append(line)
    print(line, file=sys.stderr, flush=True)


def main():
    lens = Lens(log)
    if lens.ready() != "ready":
        print(lens.ready(), file=sys.stderr)
        sys.exit(2)
    runs = []
    for label, fn in IMAGES:
        path = os.path.join(DIR, fn)
        try:
            image_id = lens.upload(path)
            log(f"업로드 {label} → image_id")
        except LensError as e:
            runs.append({"image": label, "file": fn, "error": str(e)})
            log("업로드 실패", label, e)
            continue
        for kind in TYPES:
            try:
                r = lens.search(image_id, kind)
            except LensError as e:
                runs.append({"image": label, "file": fn, "type": kind, "error": str(e)})
                log("검색 실패", label, kind, e)
                if "상한" in str(e) or "429" in str(e):
                    break
                continue
            for i, x in enumerate(r["rows"]):
                blob = " ".join([x["title"], x["link"], x["source"]])
                x["rank"] = i + 1
                x["is_target"] = bool(TARGET.search(blob))
                x["is_decoy"] = bool(DECOY.search(blob))
            runs.append({"image": label, "file": fn, **r})
            time.sleep(2)
    os.makedirs(OUT, exist_ok=True)
    base = os.path.join(OUT, "gate1-" + time.strftime("%Y%m%d-%H%M"))
    json.dump({"at": time.strftime("%Y-%m-%d %H:%M"), "runs": runs, "calls": lens.calls}, open(base + ".json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    md = [f"# GATE 1 — SerpApi Google Lens 결과 · {time.strftime('%Y-%m-%d %H:%M')}", "", "| 사진 | 검색 종류 | 결과 수 | 정답(FAR FROM WHAT) 첫 순위 | 오답(ANDROS) 첫 순위 | 시간 |", "|---|---|---|---|---|---|"]
    for r in runs:
        if "error" in r:
            md.append(f"| {r['image']} | {r.get('type', '업로드')} | 실패 | — | — | {r['error'][:80]} |")
            continue
        t = next((x["rank"] for x in r["rows"] if x["is_target"]), None)
        d = next((x["rank"] for x in r["rows"] if x["is_decoy"]), None)
        md.append(f"| {r['image']} | {r['type']} | {len(r['rows'])} | {t or '없음'} | {d or '없음'} | {r['ms'] / 1000:.1f}초 |")
    for r in runs:
        if "error" in r:
            continue
        md += ["", f"## {r['image']} · {r['type']} — 상위 10건", ""]
        md += [f"{x['rank']}. {'**[정답]** ' if x['is_target'] else ''}{'**[ANDROS]** ' if x['is_decoy'] else ''}{x['title'][:70]} — {x['source']} — {x['link']}" + (f" · {x['price']}" if x['price'] else "") for x in r["rows"][:10]]
    md += ["", f"SerpApi 호출 {lens.calls}회(무료 250회/월 중)."]
    open(base + ".md", "w", encoding="utf-8").write("\n".join(md))
    open(base + ".log", "w", encoding="utf-8").write("\n".join(LOG))
    print(base + ".md")


if __name__ == "__main__":
    main()
