#!/usr/bin/env python3
import sys
from runtime import run
map_path = sys.argv[1] if len(sys.argv) > 1 else None
if not map_path:
    raise SystemExit('usage: quick_validate.py MAP.json')
for command in (['validate', map_path], ['audit', map_path]):
    code = run(*command)
    if code:
        raise SystemExit(code)
print('PASS HexaMap quick validation')
