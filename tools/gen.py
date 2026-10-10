#!/usr/bin/env python
"""生图工具：调用 ark seedream，支持文生图与图生图(base64)。
用法:
  python gen.py t2i <out_name> <size> "<prompt>"
  python gen.py i2i <out_name> <size> "<ref_image>" "<prompt>"
"""
import sys, json, base64, io, os, time
import urllib.request
from PIL import Image

# API Key 从环境变量 ARK_API_KEY 读取，不要硬编码进代码或提交到 Git。
KEY = os.environ.get("ARK_API_KEY", "")
if not KEY:
    print("请先设置环境变量 ARK_API_KEY：")
    print('  Windows:  set ARK_API_KEY=ark-xxxx')
    print('  mac/Linux: export ARK_API_KEY=ark-xxxx')
    sys.exit(1)

URL = "https://ark.cn-beijing.volces.com/api/v3/images/generations"
MODEL = os.environ.get("ARK_IMAGE_MODEL", "doubao-seedream-4-0-20260415")


def call(payload, retries=2):
    for i in range(retries + 1):
        req = urllib.request.Request(
            URL, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            if i == retries:
                raise
            time.sleep(3)
            print(f"  retry {i+1}: {e}", file=sys.stderr)


def as_data_uri(path, maxside=1024, quality=88):
    im = Image.open(path).convert("RGB")
    im.thumbnail((maxside, maxside))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=quality)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def main():
    mode = sys.argv[1]
    name = sys.argv[2]
    size = sys.argv[3]
    if mode == "t2i":
        prompt = sys.argv[4]
        payload = {"model": MODEL, "prompt": prompt, "response_format": "url",
                   "size": size, "stream": False, "watermark": False}
    else:
        ref = as_data_uri(sys.argv[4])
        prompt = sys.argv[5]
        payload = {"model": MODEL, "prompt": prompt, "image": [ref],
                   "response_format": "url", "size": size, "stream": False, "watermark": False}

    d = call(payload)
    if "data" not in d:
        print("FAIL:", json.dumps(d, ensure_ascii=False)[:500])
        sys.exit(1)
    url = d["data"][0]["url"]
    out = os.path.join("assets", f"{name}.jpg")
    os.makedirs("assets", exist_ok=True)
    with urllib.request.urlopen(url, timeout=120) as r:
        open(out, "wb").write(r.read())
    print(f"OK {out} {Image.open(out).size}")


if __name__ == "__main__":
    main()