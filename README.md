# GovTrade MCP Server

Wraps the live GovTrade x402 API as MCP tools any agent can call directly —
`get_congressional_trade_signals`, `get_congressional_trades`, and
`get_politician_trading_baseline`.

## Important: who pays

This server pays your live x402 endpoints on every tool call, using the
wallet whose private key you provide in `.env` — the exact same pattern as
the `agent-payment-test` script from earlier tonight. That means:

- **Whoever runs this MCP server needs a funded wallet** (USDC on Base) —
  either you (if you host it and offer it for free to build reputation), or
  each individual agent operator (if they run it themselves with their own
  key, which is the more common ecosystem pattern for paid MCP tools).
- Your underlying `/trades`, `/signals`, `/politicians` endpoints still get
  paid exactly as before — this is a wrapper, not a bypass.

Most paid MCP tools in the wild expect the *installer* (the agent's
operator) to supply their own funded key — that's the model this is built
for. Worth deciding deliberately before publishing widely.

## Setup

1. `npm install`
2. `cp .env.example .env` and fill in a funded wallet's private key
3. Test it locally first — the fastest way is the **MCP Inspector**:
   ```
   npx @modelcontextprotocol/inspector node index.js
   ```
   This opens a browser UI where you can call each tool manually and see
   the real response, before wiring it into any client or registry.

## Testing in Claude Desktop

Add to your Claude Desktop config (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "govtrade": {
      "command": "node",
      "args": ["/full/path/to/govtrade-mcp/index.js"],
      "env": {
        "EVM_PRIVATE_KEY": "0xYourKey"
      }
    }
  }
}
```
Restart Claude Desktop — the three tools should appear as available.

## Listing on registries

This is two separate tracks:

**1. The official MCP Registry** (feeds the other directories over time)
- Requires a `server.json` manifest and a reverse-DNS name you can prove
  ownership of (e.g. `com.yourdomain/govtrade-mcp`) via GitHub or domain
  verification
- Published via the `mcp-publisher` CLI

**2. Discovery directories people actually browse**
- **Smithery**: `npx @smithery/cli publish <your-repo-url>` (or via their
  publisher platform) — needs the repo public on GitHub first
- **mcp.so**: submit via their form — wants server name, one-sentence
  description, tool count (3, here), transport type (stdio), GitHub repo
  URL
- **Glama**: crawls automatically once your repo is public; claim the
  listing afterward to get verified status

**Before any of this**: push this server to its own public GitHub repo
first (separate from `govtrade-x402`, or as a subfolder — either works,
but a dedicated repo is cleaner for registry submission forms that ask
for "the GitHub repo URL").
