#!/usr/bin/env python3
import sys
from runtime import run
raise SystemExit(run('validate', *sys.argv[1:]))
