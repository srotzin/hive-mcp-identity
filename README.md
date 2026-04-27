# HiveIdentity

**DID resolution, trust scoring, and attestation management on Hive Civilization rails**

`hive-mcp-identity` is an MCP server for the Hive Identity platform. Agents resolve DIDs to public profiles, retrieve trust scores (0-100) from the Hive trust graph, verify specific attestations by hash, and list all attestations issued to or by a DID. Conforms to the W3C DID spec and integrates with the Hive HAHS legal attestation layer.

> **Backend status:** The hivemorph backend for this vertical is not yet built. All `tools/call` requests return HTTP 503 — no mock data is returned. Backend target: Q3 2026.

> Council R4 — staged for Q3 2026 backend build

---

## Backend Status

All `tools/call` requests return HTTP 503:
```json
{ "error": "feature gating: backend pending; submit interest at hive-mcp-connector" }
```
`tools/list`, `/health`, and `/.well-known/mcp.json` are operational and return the full tool catalog.
No mock data is returned at any point.

---

## Protocol

- **Spec:** MCP 2024-11-05 over Streamable-HTTP / JSON-RPC 2.0
- **Transport:** `POST /mcp`
- **Discovery:** `GET /.well-known/mcp.json`
- **Health:** `GET /health`
- **Settlement:** USDC on Base, Ethereum, Solana via x402 (real rails only, for write operations when backend is live)
- **Brand gold:** Pantone 1245 C / `#C08D23`
- **Tools:** 4

---

## Tools

| Tool | Description |
|---|---|
| `resolve_did` | Resolves a DID to its public profile: display name, verification methods, service endpoints, and Hive trust metadata. Conforms to W3C DID spec. Backend pending (Q3 2026). |
| `get_trust_score` | Returns the Hive trust score (0-100) for a DID. Factors: on-chain activity, attestation count, repayment history, peer endorsements. Backend pending (Q3 2026). |
| `verify_attestation` | Verifies whether a specific attestation (by hash) was issued to a DID and is currently valid. Returns boolean. Backend pending (Q3 2026). |
| `list_attestations` | Lists all attestations associated with a DID — issued, received, and expired. Returns array of attestation metadata. Backend pending (Q3 2026). |

---

## Backend Endpoints (pending Q3 2026)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/identity/resolve` | DID → public profile (W3C spec) |
| `GET` | `/v1/identity/trust` | Trust score (0-100) from Hive trust graph |
| `GET` | `/v1/identity/attestations/verify` | Verify attestation hash against DID |
| `GET` | `/v1/identity/attestations` | List all attestations for a DID |

---

## Run Locally

```bash
git clone https://github.com/srotzin/hive-mcp-identity.git
cd hive-mcp-identity
npm install
npm start
# Server on http://localhost:3000
# tools/list returns tool catalog; tools/call returns 503 (backend pending)
curl http://localhost:3000/health
curl http://localhost:3000/.well-known/mcp.json
curl -s -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq .result.tools[].name
```

---

## Connect from an MCP Client

Add to your `mcp.json`:

```json
{
  "mcpServers": {
    "hive_mcp_identity": {
      "command": "npx",
      "args": ["-y", "mcp-remote@latest", "https://your-deployed-host/mcp"]
    }
  }
}
```

---

## Hive Civilization

Part of the [Hive Civilization](https://www.thehiveryiq.com) — sovereign DID, USDC settlement, HAHS legal contracts, agent-to-agent rails.

## License

MIT (c) 2026 Steve Rotzin / Hive Civilization
