#!/usr/bin/env bash
cd "$(dirname "$0")"
python3 server.py &
PID=$!
sleep 1
open http://127.0.0.1:8123
wait $PID
