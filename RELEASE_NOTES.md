# HiveIdentity MCP Server — v1.0.0

## Overview

Initial scaffold for `hive-mcp-identity`. The MCP server is structurally complete: `tools/list`, `/health`, and `/.well-known/mcp.json` are operational. The hivemorph backend for this vertical is not yet built. All `tools/call` requests return HTTP 503 — no mock data, no simulated responses.

---

## Tools

| Tool | Description |
|---|---|
| `resolve_did` | Resolves a DID to its public profile: display name, verification methods, service endpoints, and Hive trust metadata. Conforms to W3C DID spec. Backend pending (Q3 2026). |
| `get_trust_score` | Returns the Hive trust score (0-100) for a DID. Factors: on-chain activity, attestation count, repayment history, peer endorsements. Backend pending (Q3 2026). |
| `verify_attestation` | Verifies whether a specific attestation (by hash) was issued to a DID and is currently valid. Returns boolean. Backend pending (Q3 2026). |
| `list_attestations` | Lists all attestations associated with a DID — issued, received, and expired. Returns array of attestation metadata. Backend pending (Q3 2026). |

---

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/identity/resolve` | DID → public profile (W3C spec) |
| `GET` | `/v1/identity/trust` | Trust score (0-100) from Hive trust graph |
| `GET` | `/v1/identity/attestations/verify` | Verify attestation hash against DID |
| `GET` | `/v1/identity/attestations` | List all attestations for a DID |

---

## Settlement

No direct settlement in this vertical. Trust scores and attestations are read operations. DID registration (when backend is live) will use USDC on Base, Ethereum, or Solana via x402.

---

## Status

- **Backend:** v0.1 — pending hivemorph build (Q3 2026 spec)
- **Council:** R4
- **`tools/list`:** operational
- **`/health`:** operational
- **`/.well-known/mcp.json`:** operational
- **`tools/call`:** returns HTTP 503

```json
{
  "error": "feature gating: backend pending; submit interest at hive-mcp-connector",
  "backend_status": "v0.1 — pending hivemorph backend build (Q3 2026 spec)",
  "service": "hive-mcp-identity",
  "interest_url": "https://hive-mcp-connector.thehiveryiq.com"
}
```

---

## Constraints

- No mock data, no simulated settlement at any point
- Brand gold: Pantone 1245 C / `#C08D23`
- No energy futures, GAS-PERP, GPU-PERP, or HASHRATE-PERP
- LLM calls route only through `https://hivecompute-g2g7.onrender.com/v1/compute/chat/completions`
- hivemorph remains private; this repository is the public surface
