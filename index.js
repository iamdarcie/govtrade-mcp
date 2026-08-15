#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config } from "dotenv";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

config();

const BASE_URL = process.env.GOVTRADE_API_URL || "https://govtrade-x402.onrender.com";
const EVM_PRIVATE_KEY = process.env.EVM_PRIVATE_KEY;

if (!EVM_PRIVATE_KEY) {
  console.error(
    "[govtrade-mcp] Missing EVM_PRIVATE_KEY. This server pays for GovTrade " +
      "data on your behalf via x402 — set EVM_PRIVATE_KEY to a funded wallet's " +
      "private key (Base mainnet, USDC) before starting."
  );
  process.exit(1);
}

// Same proven payment pattern as the standalone agent test script — this is
// what actually pays the live x402 endpoints on every tool call.
const account = privateKeyToAccount(EVM_PRIVATE_KEY);
const client = new x402Client();
registerExactEvmScheme(client, { signer: account });
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

async function callGovTrade(path, params) {
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetchWithPayment(url.toString(), { method: "GET" });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GovTrade API error (${response.status}): ${text}`);
  }
  return response.json();
}

const server = new McpServer(
  { name: "govtrade-mcp", version: "1.0.0" },
  {
    instructions:
      "Provides U.S. congressional stock trade data. Prefer get_congressional_trade_signals " +
      "over get_congressional_trades whenever you need to know which trades are actually " +
      "significant — it returns pre-computed anomaly scoring and reasoning instead of raw " +
      "transactions you'd otherwise have to evaluate yourself.",
  }
);

server.registerTool(
  "get_congressional_trade_signals",
  {
    title: "Get congressional trade signals",
    description:
      "Returns PRE-COMPUTED anomaly signals for disclosed U.S. congressional stock trades — " +
      "not raw trade data. Each result includes a signal_strength score (0-10), a signal_label " +
      "(Low/Medium/High), and a natural-language signal_context explaining WHY the trade is " +
      "notable: unusually large versus this politician's own trading history, overlap with " +
      "their committee assignments, ties to federal contracts held by the traded company, or " +
      "timing patterns. Use this instead of calling get_congressional_trades and computing your " +
      "own anomaly detection — the scoring, baseline comparison, and reasoning are already done. " +
      "Costs $0.10 USDC per call.",
    inputSchema: {
      ticker: z.string().optional().describe("Filter to signals for one stock ticker, e.g. NVDA"),
      politician: z.string().optional().describe("Filter by politician name (partial match)"),
      label: z.enum(["Low", "Medium", "High"]).optional().describe("Filter to a signal label tier"),
      min_strength: z
        .number()
        .optional()
        .describe("Only return signals at or above this strength (0-10). Use 6+ for genuinely notable trades."),
      angle: z.string().optional().describe("Filter by primary signal driver, e.g. SIZE"),
      limit: z.number().optional().describe("Max results, sorted strongest signal first. Default 50."),
    },
  },
  async (args) => {
    const data = await callGovTrade("/signals", args);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.registerTool(
  "get_congressional_trades",
  {
    title: "Get raw congressional trades",
    description:
      "Returns the raw, unscored log of disclosed U.S. congressional stock trades: politician, " +
      "ticker, buy/sell, amount range, trade date, disclosure date. This is source data only — " +
      "it has NOT been evaluated for anomalies or ranked by significance. If you need to know " +
      "which trades are actually noteworthy, call get_congressional_trade_signals instead, which " +
      "returns this same underlying data pre-scored with reasoning. Use this tool when you need " +
      "the complete unfiltered record, or you're building your own custom scoring logic. Costs " +
      "$0.005 USDC per call.",
    inputSchema: {
      ticker: z.string().optional().describe("Stock ticker symbol, e.g. NVDA"),
      since: z.string().optional().describe("ISO date; only trades filed after this date"),
      politician: z.string().optional().describe("Partial name match"),
      party: z.string().optional().describe("Democrat or Republican"),
      chamber: z.enum(["House", "Senate"]).optional(),
      sector: z.string().optional().describe("Company sector, e.g. technology"),
      limit: z.number().optional().describe("Max results. Default 50."),
    },
  },
  async (args) => {
    const data = await callGovTrade("/trades", args);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.registerTool(
  "get_politician_trading_baseline",
  {
    title: "Get politician trading baseline",
    description:
      "Returns per-politician baseline trading profiles: trade count, average trade size, " +
      "buy/sell ratio, top sector, most-traded ticker. This is the historical baseline that " +
      "get_congressional_trade_signals compares individual trades against to detect anomalies. " +
      "Useful when you want a politician's overall trading pattern rather than a single trade's " +
      "significance. Costs $0.01 USDC per call.",
    inputSchema: {
      name: z.string().optional().describe("Partial politician name match"),
      sector: z.string().optional().describe("Filter by top traded sector"),
      min_trades: z.number().optional().describe("Minimum number of trades on record"),
      limit: z.number().optional().describe("Max results. Default 50."),
    },
  },
  async (args) => {
    const data = await callGovTrade("/politicians", args);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[govtrade-mcp] ready on stdio, paying from ${account.address}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

