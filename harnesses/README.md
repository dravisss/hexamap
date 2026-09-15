# Harness integration

HexMap uses two portable surfaces:

1. install the four skills with `hexmap skills install --target DIRECTORY`;
2. register `hexmap-mcp` as a local stdio MCP server.

`mcp-config.json` follows the common Claude/Codex/OpenCode MCP shape. Hermes can
use the equivalent `hermes.yaml` fragment. Gemini clients that support local
stdio MCP use the same command. Harness-specific identity or profile paths are
deliberately absent.

`certify_harnesses.py` verifies executable discovery, MCP initialization,
tool discovery and a read-only tool call. This is a protocol conformance test;
it does not claim that every model will make identical editorial choices.
