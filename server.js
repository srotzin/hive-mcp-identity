#!/usr/bin/env node
/**
 * HiveIdentity MCP Server
 * Agent identity verification — DID resolution, KYC-lite, trust-score lookup, and attestation management
 *
 * Backend  : https://hivemorph.onrender.com
 * Status   : v0.1 — pending hivemorph backend build (Q3 2026 spec)
 * Spec     : MCP 2024-11-05 / Streamable-HTTP / JSON-RPC 2.0
 * Brand    : Hive Civilization gold #C08D23 (Pantone 1245 C)
 *
 * RAILS RULE 1 — NO MOCK RESPONSES.
 * All tool calls return HTTP 503 until the backend is live.
 * Agents receive: { "error": "feature gating: backend pending; submit interest at hive-mcp-connector" }
 */

import express from 'express';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const HIVE_BASE = process.env.HIVE_BASE || 'https://hivemorph.onrender.com';

// ─── Tool definitions ────────────────────────────────────────────────────────
const TOOLS = [
    {
      name: 'resolve_did',
      description: 'Resolve a DID to its public profile: display name, verification methods, service endpoints, and Hive trust metadata. Conforms to W3C DID spec. Backend pending (Q3 2026).',
      inputSchema: {
        type: 'object',
        required: ["did"],
properties: {
          did: { type: 'string', description: 'Decentralized Identifier (DID) to resolve (e.g. did:hive:0x...)' }
        },
      },
    },    {
      name: 'get_trust_score',
      description: 'Retrieve the Hive trust score (0-100) for a DID. Factors include on-chain activity, attestation count, repayment history, and peer endorsements. Backend pending (Q3 2026).',
      inputSchema: {
        type: 'object',
        required: ["did"],
properties: {
          did: { type: 'string', description: 'DID to retrieve trust score for' }
        },
      },
    },    {
      name: 'verify_attestation',
      description: 'Verify whether a specific attestation (by hash) was issued to a DID and is currently valid. Returns boolean. Used in KYC-lite flows and smart-contract gating. Backend pending (Q3 2026).',
      inputSchema: {
        type: 'object',
        required: ["did", "attestation_hash"],
properties: {
          did: { type: 'string', description: 'DID to verify attestation for' },
  attestation_hash: { type: 'string', description: 'SHA-256 hash of the attestation to verify' }
        },
      },
    },    {
      name: 'list_attestations',
      description: 'List all attestations associated with a DID — issued, received, and expired. Returns array of attestation metadata. Backend pending (Q3 2026).',
      inputSchema: {
        type: 'object',
        required: ["did"],
properties: {
          did: { type: 'string', description: 'DID to list attestations for' }
        },
      },
    }
];

// ─── Feature-gate response (Rails Rule 1 — no mock) ──────────────────────────
function featureGate(res) {
  return res.status(503).json({
    error: 'feature gating: backend pending; submit interest at hive-mcp-connector',
    backend_status: 'v0.1 — pending hivemorph backend build (Q3 2026 spec)',
    service: 'hive-mcp-identity',
    interest_url: 'https://hive-mcp-connector.thehiveryiq.com',
  });
}

// ─── MCP JSON-RPC handler ────────────────────────────────────────────────────
app.post('/mcp', async (req, res) => {
  const { jsonrpc, id, method, params } = req.body || {};
  if (jsonrpc !== '2.0') {
    return res.json({ jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid JSON-RPC' } });
  }
  try {
    switch (method) {
      case 'initialize':
        return res.json({ jsonrpc: '2.0', id, result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { listChanged: false } },
          serverInfo: {
            name: 'hive-mcp-identity',
            version: '1.0.0',
            description: 'Agent identity verification — DID resolution, KYC-lite, trust-score lookup, and attestation management',
            backendStatus: 'v0.1 — pending hivemorph backend build (Q3 2026 spec)',
          },
        } });
      case 'tools/list':
        return res.json({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      case 'tools/call':
        // Rails Rule 1: backend not yet live — return honest 503, no mock data.
        return featureGate(res);
      case 'ping':
        return res.json({ jsonrpc: '2.0', id, result: {} });
      default:
        return res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  } catch (err) {
    return res.json({ jsonrpc: '2.0', id, error: { code: -32000, message: err.message } });
  }
});

// ─── Discovery + health ──────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({
  status: 'ok',
  service: 'hive-mcp-identity',
  version: '1.0.0',
  backend: HIVE_BASE,
  backendStatus: 'v0.1 — pending hivemorph backend build (Q3 2026 spec)',
  toolCount: TOOLS.length,
  brand: '#C08D23',
}));

app.get('/.well-known/mcp.json', (req, res) => res.json({
  name: 'hive-mcp-identity',
  endpoint: '/mcp',
  transport: 'streamable-http',
  protocol: '2024-11-05',
  backendStatus: 'v0.1 — pending hivemorph backend build (Q3 2026 spec)',
  tools: TOOLS.map(t => ({ name: t.name, description: t.description })),
}));

app.listen(PORT, () => {
  console.log('HiveIdentity MCP Server running on :' + PORT);
  console.log('  Backend : ' + HIVE_BASE);
  console.log('  Status  : v0.1 — pending hivemorph backend build (Q3 2026 spec)');
  console.log('  Tools   : ' + TOOLS.length + ' (resolve_did, get_trust_score, verify_attestation, list_attestations)');
  console.log('  Rails   : tool calls return 503 until backend is live (no mock)');
});
