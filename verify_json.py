import json
import sys

files = [
    r"d:/download/VRC-Worlds-Manager-v2-vrc-world-manager-v1.3.0-rc.0/locales/ja-JP.json",
    r"d:/download/VRC-Worlds-Manager-v2-vrc-world-manager-v1.3.0-rc.0/locales/en-US.json"
]

for f in files:
    try:
        with open(f, 'r', encoding='utf-8') as fp:
            json.load(fp)
        print(f"OK: {f}")
    except Exception as e:
        print(f"ERROR: {f}")
        print(e)
