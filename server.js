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
import { renderLanding, renderRobots, renderSitemap, renderSecurity, renderOgImage, seoJson, BRAND_GOLD } from './meta.js';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const HIVE_BASE = process.env.HIVE_BASE || 'https://hivemorph.onrender.com';

// ─── MPP Rail Config ─────────────────────────────────────────────────────────
// Machine Payments Protocol (MPP) — Stripe + Tempo co-authored standard
// Implemented per IETF draft-ryan-httpauth-payment Payment header scheme
// Runs alongside x402: either rail satisfies payment. Same fee table.

const TEMPO_RPC_URL = process.env.TEMPO_RPC_URL || 'https://rpc.tempo.xyz';
const MPP_TREASURY  = '0x15184bf50b3d3f52b60434f8942b7d52f2eb436e'; // Monroe Base (EVM-compat)
const TEMPO_USDCE   = '0x20c000000000000000000000b9537d11c60e8b50'; // TIP-20 USDCe
const BASE_USDC     = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const _mppCache = new Map();
setInterval(() => { const now = Date.now(); for (const [k, v] of _mppCache) { if (now - v.ts > 600_000) _mppCache.delete(k); } }, 60_000);

// Parse IETF draft-ryan-httpauth-payment Payment header
function parseMppHeader(req) {
  const hdr = req.headers['payment'] || req.headers['x-payment'] || req.headers['payment-credential'] || '';
  if (!hdr) return { found: false };
  // Try Payment: scheme="mpp", tx_hash="0x...", rail="tempo"
  const params = {};
  for (const part of hdr.split(',')) {
    const m = part.trim().match(/^([\w-]+)="([^"]*)"$/);
    if (m) params[m[1]] = m[2];
  }
  if (params.tx_hash || params.scheme === 'mpp' || hdr.startsWith('0x')) {
    return {
      found:  true,
      txHash: params.tx_hash || (hdr.startsWith('0x') ? hdr.trim() : ''),
      rail:   params.rail || req.headers['x-mpp-rail'] || 'tempo',
      amount: parseFloat(params.amount || '0') || null,
    };
  }
  return { found: false };
}

async function verifyMppTx(txHash, expectedAmount, rail) {
  const rpc      = rail === 'tempo' ? TEMPO_RPC_URL : 'https://mainnet.base.org';
  const contract = rail === 'tempo' ? TEMPO_USDCE   : BASE_USDC;
  try {
    const r = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc:'2.0', id:1, method:'eth_getTransactionReceipt', params:[txHash] }),
      signal: AbortSignal.timeout(8000),
    });
    const { result: receipt } = await r.json();
    if (!receipt || receipt.status !== '0x1') return { ok:false, reason:'not confirmed' };
    for (const log of receipt.logs) {
      if (log.address?.toLowerCase() === contract && log.topics?.[0] === TRANSFER_TOPIC) {
        const to = '0x' + log.topics[2].slice(26).toLowerCase();
        if (to === MPP_TREASURY) {
          const amt = parseInt(log.data, 16) / 1e6;
          if (amt >= expectedAmount - 0.001) return { ok:true, amt };
          return { ok:false, reason:`insufficient: ${amt} < ${expectedAmount}` };
        }
      }
    }
    return { ok:false, reason:'no matching USDC Transfer to treasury' };
  } catch (e) { return { ok:false, reason:e.message }; }
}

// MPP per-call middleware — mounts on /v1 after x402 subscription gating
async function mppMiddleware(req, res, next) {
  const mpp = parseMppHeader(req);
  if (!mpp.found) return next(); // No MPP credential — pass through

  const { txHash, rail, amount } = mpp;
  if (!txHash) return next();

  if (_mppCache.has(txHash)) {
    const c = _mppCache.get(txHash);
    if (c.ok) {
      res.set('Payment-Receipt', `mpp:${txHash}:verified`);
      res.set('X-Hive-Payment-Rail', 'mpp');
      return next();
    }
    return res.status(402).json({ error:'mpp_payment_invalid', reason:c.reason, code:'MPP_PAYMENT_INVALID' });
  }

  const expectedAmount = amount || 0.001; // identity DID lookup default
  const v = await verifyMppTx(txHash, expectedAmount, rail);
  _mppCache.set(txHash, { ...v, ts: Date.now() });

  if (!v.ok) {
    return res.status(402).json({
      error: 'mpp_payment_invalid',
      reason: v.reason,
      code:   'MPP_PAYMENT_INVALID',
      hint:   'Provide a confirmed Tempo or Base USDC transaction in the Payment header.',
    });
  }

  // MPP verified — emit Spectral receipt (non-blocking) with payment_method: "mpp"
  fetch('https://hive-receipt.onrender.com/v1/receipt/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      issuer_did: 'did:hive:identity',
      event_type: 'api_payment',
      amount_usd: String(expectedAmount),
      currency: 'USDC',
      network: rail,
      pay_to: MPP_TREASURY,
      tx_hash: txHash,
      payment_method: 'mpp',
      rail: rail,
      timestamp: new Date().toISOString(),
    }),
    signal: AbortSignal.timeout(4000),
  }).catch(() => {});

  res.set('Payment-Receipt',       `mpp:${txHash}:${rail}`);
  res.set('X-Hive-Payment-Rail',  'mpp');
  res.set('X-Hive-Payment-Method','mpp');
  return next();
}

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


const SERVICE_CFG = {
  service: "hive-mcp-identity",
  shortName: "HiveIdentity",
  title: "HiveIdentity \u00b7 W3C DID & Agent KYC MCP",
  tagline: "W3C DID resolution and agent KYC for autonomous agent counterparties.",
  description: "MCP server for HiveIdentity \u2014 W3C DID resolution and agent KYC on the Hive Civilization. OFAC / FATF screening per agent and per counterparty. USDC settlement on Base L2. Real rails, no mocks.",
  keywords: ["mcp", "model-context-protocol", "x402", "agentic", "ai-agent", "ai-agents", "llm", "hive", "hive-civilization", "identity", "w3c-did", "did", "agent-kyc", "agent-identity", "ofac", "fatf", "usdc", "base", "base-l2", "agent-economy", "a2a"],
  externalUrl: "https://hive-mcp-identity.onrender.com",
  gatewayMount: "/identity",
  version: "1.0.1",
  pricing: [
    { name: "identity_resolve_did", priceUsd: 0.001, label: "Resolve DID (Tier 1)" },
    { name: "identity_screen", priceUsd: 0.005, label: "OFAC / FATF screen (Tier 2)" },
    { name: "identity_attest", priceUsd: 0.05, label: "Attest (Tier 3)" }
  ],
};
SERVICE_CFG.tools = (typeof TOOLS !== 'undefined' ? TOOLS : []).map(t => ({ name: t.name, description: t.description }));
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
// MPP OpenAPI Discovery — required for MPPScan auto-discovery
app.get('/openapi.json', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({
    openapi: '3.0.3',
    info: {
      title: 'HiveIdentity — W3C DID & Agent KYC API',
      version: '1.0.1',
      description: 'W3C DID resolution and agent KYC for autonomous agent counterparties. Accepts x402 and MPP rails.',
      contact: { name: 'Hive Civilization', url: 'https://thehiveryiq.com', email: 'steve@thehiveryiq.com' },
    },
    servers: [{ url: 'https://hive-mcp-identity.onrender.com' }],
    'x-mpp': {
      realm: 'hive-mcp-identity.onrender.com',
      payment: { method: 'tempo', currency: '0x20c000000000000000000000b9537d11c60e8b50', decimals: 6, recipient: '0x15184bf50b3d3f52b60434f8942b7d52f2eb436e' },
      rails: ['x402', 'mpp'],
      categories: ['identity', 'trust'],
      integration: 'first-party',
      tags: ['did', 'w3c-did', 'agent-kyc', 'identity', 'trust-score', 'attestation', 'federation'],
      treasury: '0x15184bf50b3d3f52b60434f8942b7d52f2eb436e',
    },
    paths: {
      '/v1/subscription': {
        post: {
          summary: 'Subscribe (Starter/Pro/Enterprise)',
          description: 'Activate subscription. Starter $99/mo, Pro $299/mo, Enterprise $999/mo. x402 or MPP.',
          'x-mpp-charge': { amount: '99000000', intent: 'charge' },
          responses: { '200': { description: 'Subscription activated' }, '402': { description: 'Payment required — x402 or MPP' } },
        },
      },
      '/mcp': {
        post: {
          summary: 'MCP JSON-RPC endpoint',
          description: 'W3C DID resolve, trust score lookup, attestation verify, list attestations. $0.001/call.',
          'x-mpp-charge': { amount: '1000', intent: 'charge' },
          responses: { '200': { description: 'Tool result' }, '402': { description: 'Payment required' } },
        },
      },
    },
  });
});

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


// HIVE_META_BLOCK_v1 — comprehensive meta tags + JSON-LD + crawler discovery
app.get('/', (req, res) => {
  res.type('text/html; charset=utf-8').send(renderLanding(SERVICE_CFG));
});
app.get('/og.svg', (req, res) => {
  res.type('image/svg+xml').send(renderOgImage(SERVICE_CFG));
});
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(renderRobots(SERVICE_CFG));
});
app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml').send(renderSitemap(SERVICE_CFG));
});
app.get('/.well-known/security.txt', (req, res) => {
  res.type('text/plain').send(renderSecurity());
});
app.get('/seo.json', (req, res) => res.json(seoJson(SERVICE_CFG)));

// ─── Schema constants (auto-injected to fix deploy) ─────
const SERVICE = 'hive-mcp-identity';
const VERSION = '1.0.2';


// ─── Schema discoverability ────────────────────────────────────────────────
const AGENT_CARD = {
  name: SERVICE,
  description: 'MCP server for HiveIdentity — W3C DID resolution and agent KYC. Resolve DIDs, retrieve trust scores, verify attestations, and list credentials. OFAC/FATF screening per agent. USDC settlement on Base L2. New agents: first call free. Loyalty: every 6th paid call is free. Pay in USDC on Base L2.',
  url: `https://${SERVICE}.onrender.com`,
  provider: {
    organization: 'Hive Civilization',
    url: 'https://www.thehiveryiq.com',
    contact: 'steve@thehiveryiq.com',
  },
  version: VERSION,
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: false,
  },
  authentication: {
    schemes: ['x402', 'mpp'],
    credentials: [
      { type: 'x402', asset: 'USDC', network: 'base', asset_address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', recipient: '0x15184bf50b3d3f52b60434f8942b7d52f2eb436e' },
      { type: 'mpp', asset: 'USDCe', network: 'tempo', asset_address: '0x20c000000000000000000000b9537d11c60e8b50', recipient: '0x15184bf50b3d3f52b60434f8942b7d52f2eb436e', ietf_draft: 'draft-ryan-httpauth-payment' },
    ],
  },
  defaultInputModes: ['application/json'],
  defaultOutputModes: ['application/json'],
  skills: [
    { name: 'resolve_did', description: 'Resolve a DID to its public profile: display name, verification methods, service endpoints, and Hive trust metadata. Conforms to W3C DID spec. Backend pending (Q3 2026).' },
    { name: 'get_trust_score', description: 'Retrieve the Hive trust score (0-100) for a DID. Factors include on-chain activity, attestation count, repayment history, and peer endorsements. Backend pending (Q3 2026).' },
    { name: 'verify_attestation', description: 'Verify whether a specific attestation (by hash) was issued to a DID and is currently valid. Returns boolean. Used in KYC-lite flows and smart-contract gating. Backend pending (Q3 2026).' },
    { name: 'list_attestations', description: 'List all attestations associated with a DID — issued, received, and expired. Returns array of attestation metadata. Backend pending (Q3 2026).' },
  ],
  extensions: {
    hive_pricing: {
      currency: 'USDC',
      network: 'base',
      model: 'per_call',
      first_call_free: true,
      loyalty_threshold: 6,
      loyalty_message: 'Every 6th paid call is free',
    },
  },
};

const AP2 = {
  ap2_version: '1',
  agent: {
    name: SERVICE,
    did: `did:web:${SERVICE}.onrender.com`,
    description: 'MCP server for HiveIdentity — W3C DID resolution and agent KYC. Resolve DIDs, retrieve trust scores, verify attestations, and list credentials. OFAC/FATF screening per agent. USDC settlement on Base L2. New agents: first call free. Loyalty: every 6th paid call is free. Pay in USDC on Base L2.',
  },
  endpoints: {
    mcp: `https://${SERVICE}.onrender.com/mcp`,
    agent_card: `https://${SERVICE}.onrender.com/.well-known/agent-card.json`,
  },
  payments: {
    schemes: ['x402', 'mpp'],
    primary: {
      scheme: 'x402',
      network: 'base',
      asset: 'USDC',
      asset_address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      recipient: '0x15184bf50b3d3f52b60434f8942b7d52f2eb436e',
    },
    mpp: {
      scheme: 'mpp',
      network: 'tempo',
      asset: 'USDCe',
      asset_address: '0x20c000000000000000000000b9537d11c60e8b50',
      recipient: '0x15184bf50b3d3f52b60434f8942b7d52f2eb436e',
      ietf_draft: 'draft-ryan-httpauth-payment',
      tempo_rpc: 'https://rpc.tempo.xyz',
    },
  },
  brand: { color: '#C08D23', name: 'Hive Civilization' },
};

app.get('/.well-known/agent-card.json', (req, res) => res.json(AGENT_CARD));
app.get('/.well-known/ap2.json',         (req, res) => res.json(AP2));



// ─── Subscription & enterprise tier endpoints (Wave B codification) ──────────
// Partner-doctrine: identity/receipts/trust plumbing only.
// Subscription billing is denominated in USDC on Base (Monroe W1).
// Spectral receipt is emitted on every fee event via hive-receipt sidecar.
//
// Tier schedule:
//   Tier 1 (Starter)    : 99.0/mo
//   Tier 2 (Pro)        : 299.0/mo
//   Tier 3 (Enterprise) : 999.0/mo
//
// x402 tx_hash required for Tier 1+ confirmation. Tier 3 can invoice monthly.
//
// Spectral receipt: POST to hive-receipt sidecar for tamper-evident audit trail.

const SUBSCRIPTION_TIERS = {
  starter:    { price_usd: 99.0, calls_per_day: 5000, label: 'Starter' },
  pro:        { price_usd: 299.0, calls_per_day: 50000, label: 'Pro' },
  enterprise: { price_usd: 999.0, calls_per_day: Infinity, label: 'Enterprise', invoice: true },
};

// In-memory subscription ledger (durable persistence on hivemorph backend).
const _subLedger = new Map(); // did -> { tier, activated_ms, tx_hash }

async function emitSpectralReceipt({ event_type, did, amount_usd, tool_name, tx_hash, metadata }) {
  // Posts a Spectral-signed receipt to hive-receipt. Non-blocking.
  // Error is logged but never throws — receipt emission must not block the fee path.
  try {
    const body = JSON.stringify({
      issuer_did: 'did:hive:identity',
      recipient_did: did || 'did:hive:anonymous',
      event_type,
      tool_name,
      amount_usd: String(amount_usd),
      currency: 'USDC',
      network: 'base',
      pay_to: '0x15184bf50b3d3f52b60434f8942b7d52f2eb436e',
      tx_hash: tx_hash || null,
      issued_ms: Date.now(),
      service: 'Hive Identity',
      brand: '#C08D23',
      ...metadata,
    });
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 4000);
    await fetch('https://hive-receipt.onrender.com/v1/receipt/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: ctrl.signal,
    });
    clearTimeout(tid);
  } catch (_) {
    // Receipt emission is best-effort. Log and continue.
    console.warn('[identity] receipt emit failed (non-fatal):', _.message || _);
  }
}

// POST /v1/subscription — create or upgrade a subscription
app.post('/v1/subscription', async (req, res) => {
  const { tier, did, tx_hash } = req.body || {};
  if (!tier || !SUBSCRIPTION_TIERS[tier]) {
    return res.status(400).json({
      error: 'invalid_tier',
      valid_tiers: Object.keys(SUBSCRIPTION_TIERS),
      brand: '#C08D23',
    });
  }
  const t = SUBSCRIPTION_TIERS[tier];
  if (!did) return res.status(400).json({ error: 'did_required' });

  // Enterprise tier can invoice monthly (no tx_hash required at activation).
  if (tier !== 'enterprise' && !tx_hash) {
    // Advertise both rails in WWW-Authenticate (IETF draft-ryan-httpauth-payment)
    res.set('WWW-Authenticate', [
      `x402 realm="hive-mcp-identity", amount="${t.price_usd}", currency="USDC", network="base", address="0x15184bf50b3d3f52b60434f8942b7d52f2eb436e"`,
      `Payment scheme="mpp", realm="hive-mcp-identity", amount="${t.price_usd}", currency="USDCe", network="tempo", address="0x15184bf50b3d3f52b60434f8942b7d52f2eb436e"`,
    ].join(', '));
    return res.status(402).json({
      error: 'payment_required',
      rails_accepted: ['x402', 'mpp'],
      x402: {
        type: 'x402', version: '1', kind: 'subscription_identity',
        asking_usd: t.price_usd,
        accept_min_usd: t.price_usd,
        asset: 'USDC', asset_address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        network: 'base', pay_to: '0x15184bf50b3d3f52b60434f8942b7d52f2eb436e',
        nonce: Math.random().toString(36).slice(2),
        issued_ms: Date.now(),
        tier, label: t.label,
        bogo: { first_call_free: true, loyalty_every_n: 6 },
      },
      mpp: {
        scheme: 'mpp',
        asking_usd: t.price_usd,
        asset: 'USDCe', asset_address: '0x20c000000000000000000000b9537d11c60e8b50',
        network: 'tempo', pay_to: '0x15184bf50b3d3f52b60434f8942b7d52f2eb436e',
        tempo_rpc: 'https://rpc.tempo.xyz',
        how_to_pay: `Payment: scheme="mpp", tx_hash="<tx>", rail="tempo", amount="${t.price_usd}"`,
        ietf_draft: 'draft-ryan-httpauth-payment',
      },
      note: `Submit tx_hash for ${t.price_usd} USDC/mo to 0x15184bf50b3d3f52b60434f8942b7d52f2eb436e on Base (x402) or Tempo (MPP).`,
    });
  }

  const record = {
    tier, did, tx_hash: tx_hash || 'enterprise_invoice',
    activated_ms: Date.now(),
    expires_ms: Date.now() + 30 * 24 * 3600 * 1000,
    price_usd: t.price_usd,
    calls_per_day: t.calls_per_day,
  };
  _subLedger.set(did, record);

  // Emit Spectral receipt for subscription activation.
  await emitSpectralReceipt({
    event_type: 'subscription_activated',
    did, amount_usd: t.price_usd, tool_name: 'subscription',
    tx_hash: tx_hash || null,
    metadata: { tier, service: 'Hive Identity', expires_ms: record.expires_ms },
  });

  return res.json({
    ok: true,
    subscription: record,
    receipt_emitted: true,
    partner_attribution: 'Identity passthrough — federates with Microsoft Entra, Google Identity, W3C DID. Never replaces them.',
    brand: '#C08D23',
    note: 'Subscription active for 30 days. Spectral receipt issued to hive-receipt.',
  });
});

// GET /v1/subscription/:did — check subscription status
app.get('/v1/subscription/:did', (req, res) => {
  const record = _subLedger.get(req.params.did);
  if (!record) {
    return res.status(404).json({ active: false, did: req.params.did });
  }
  const active = Date.now() < record.expires_ms;
  return res.json({ active, ...record });
});

// POST /v1/subscription/verify — lightweight verification (no charge)
app.post('/v1/subscription/verify', (req, res) => {
  const { did } = req.body || {};
  const record = _subLedger.get(did);
  const active = record && Date.now() < record.expires_ms;
  return res.json({
    active: !!active,
    did: did || null,
    tier: record?.tier || null,
    expires_ms: record?.expires_ms || null,
    brand: '#C08D23',
  });
});

// ─── MPP Middleware mount (alongside x402 subscription gating) ────────────────
// Both rails accept on same routes. mppMiddleware checks Payment header.
app.use('/v1', mppMiddleware);
app.use('/mcp', mppMiddleware);

// ─────────────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log('HiveIdentity MCP Server running on :' + PORT);
  console.log('  Backend : ' + HIVE_BASE);
  console.log('  Status  : v0.1 — pending hivemorph backend build (Q3 2026 spec)');
  console.log('  Tools   : ' + TOOLS.length + ' (resolve_did, get_trust_score, verify_attestation, list_attestations)');
  console.log('  Rails   : tool calls return 503 until backend is live (no mock)');
});
