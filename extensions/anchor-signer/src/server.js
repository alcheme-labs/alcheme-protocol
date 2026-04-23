#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const {
  Commitment,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} = require('@solana/web3.js');

const DEFAULT_MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const VALID_COMMITMENTS = new Set(['processed', 'confirmed', 'finalized']);
const VALID_ACTION = 'memo_anchor_submit';
const VALID_CHAIN = 'solana';

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

function parseBool(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === '1' || normalized === 'true') return true;
  if (normalized === '0' || normalized === 'false') return false;
  return fallback;
}

function parseIntInRange(raw, fallback, min, max) {
  const parsed = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

function expandHome(inputPath) {
  if (!inputPath.startsWith('~/')) return inputPath;
  return path.join(os.homedir(), inputPath.slice(2));
}

function parseCsv(raw) {
  return String(raw || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildConfig(env = process.env) {
  const bindHost = String(env.ANCHOR_SIGNER_BIND_HOST || '127.0.0.1').trim();
  const port = parseIntInRange(env.ANCHOR_SIGNER_PORT, 8787, 1, 65535);
  const keypairPath = expandHome(
    String(
      env.ANCHOR_SIGNER_KEYPAIR_PATH ||
        env.SOLANA_KEYPAIR_PATH ||
        path.join(os.homedir(), '.config', 'solana', 'id.json')
    ).trim()
  );
  const defaultRpcUrl = String(
    env.ANCHOR_SIGNER_DEFAULT_RPC_URL || env.RPC_ENDPOINT || env.SOLANA_RPC_URL || 'http://127.0.0.1:8899'
  ).trim();
  const forceRpcUrl = String(env.ANCHOR_SIGNER_FORCE_RPC_URL || '').trim() || null;
  const defaultCommitmentRaw = String(env.ANCHOR_SIGNER_DEFAULT_COMMITMENT || 'confirmed').trim().toLowerCase();
  const defaultCommitment = VALID_COMMITMENTS.has(defaultCommitmentRaw) ? defaultCommitmentRaw : 'confirmed';
  const maxMemoBytes = parseIntInRange(env.ANCHOR_SIGNER_MAX_MEMO_BYTES, 512, 64, 4096);
  const authToken = String(env.ANCHOR_SIGNER_AUTH_TOKEN || '').trim() || null;
  const allowedLabels = parseCsv(env.ANCHOR_SIGNER_ALLOWED_SIGNER_LABELS);
  const requestTimeoutMs = parseIntInRange(env.ANCHOR_SIGNER_REQUEST_TIMEOUT_MS, 20000, 1000, 180000);
  const strictChain = parseBool(env.ANCHOR_SIGNER_STRICT_CHAIN, true);

  return {
    bindHost,
    port,
    keypairPath,
    defaultRpcUrl,
    forceRpcUrl,
    defaultCommitment,
    maxMemoBytes,
    authToken,
    allowedLabels,
    requestTimeoutMs,
    strictChain,
  };
}

function loadKeypair(pathToKeypair) {
  const content = fs.readFileSync(pathToKeypair, 'utf8');
  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed) || parsed.length < 64) {
    throw new Error(`invalid keypair file: ${pathToKeypair}`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(parsed));
}

function safeJson(data) {
  try {
    return JSON.stringify(data);
  } catch {
    return '{"error":"serialization_failed"}';
  }
}

function sendJson(res, statusCode, payload) {
  const body = safeJson(payload);
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(body);
}

function log(level, message, extra) {
  const line = `[${new Date().toISOString()}] [anchor-signer] [${level}] ${message}`;
  if (extra === undefined) {
    console.log(line);
    return;
  }
  console.log(`${line} ${safeJson(extra)}`);
}

function secureTokenEquals(expected, actual) {
  const a = Buffer.from(String(expected || ''), 'utf8');
  const b = Buffer.from(String(actual || ''), 'utf8');
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new HttpError(413, `request body too large (>${maxBytes} bytes)`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        reject(new HttpError(400, 'empty request body'));
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new HttpError(400, 'request body must be a JSON object'));
          return;
        }
        resolve(parsed);
      } catch {
        reject(new HttpError(400, 'invalid JSON body'));
      }
    });

    req.on('error', (error) => {
      reject(error);
    });
  });
}

function parseCommitment(rawCommitment, fallback) {
  const normalized = String(rawCommitment || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (!VALID_COMMITMENTS.has(normalized)) {
    throw new HttpError(400, `invalid commitment: ${normalized}`);
  }
  return normalized;
}

function parseSignerLabel(raw) {
  const value = String(raw || 'anchor').trim();
  return value.slice(0, 64);
}

function normalizeSlot(slot) {
  if (!Number.isFinite(slot)) return null;
  const value = Math.floor(slot);
  if (value < 0) return null;
  return value;
}

async function submitMemoAnchor(input) {
  const txReadCommitment = input.commitment === 'finalized' ? 'finalized' : 'confirmed';
  const connection = new Connection(input.rpcUrl, input.commitment);
  const instruction = new TransactionInstruction({
    programId: input.memoProgramId,
    keys: [],
    data: Buffer.from(input.memoText, 'utf8'),
  });
  const tx = new Transaction().add(instruction);
  tx.feePayer = input.signer.publicKey;

  const latest = await connection.getLatestBlockhash(input.commitment);
  tx.recentBlockhash = latest.blockhash;
  tx.sign(input.signer);

  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: input.commitment,
    maxRetries: 3,
  });

  const confirmation = await connection.confirmTransaction(
    {
      signature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    input.commitment
  );
  if (confirmation.value.err) {
    throw new Error(`anchor transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  }

  const txInfo = await connection.getTransaction(signature, {
    commitment: txReadCommitment,
    maxSupportedTransactionVersion: 0,
  });
  return {
    signature,
    slot: normalizeSlot(txInfo && txInfo.slot),
  };
}

function validateRequestBody(body, cfg) {
  const action = String(body.action || '').trim();
  if (action !== VALID_ACTION) {
    throw new HttpError(400, `unsupported action: ${action || 'undefined'}`);
  }

  const chain = String(body.chain || VALID_CHAIN).trim().toLowerCase();
  if (cfg.strictChain && chain !== VALID_CHAIN) {
    throw new HttpError(400, `unsupported chain: ${chain}`);
  }

  const memoText = String(body.memoText || '');
  if (!memoText) {
    throw new HttpError(400, 'memoText is required');
  }
  const memoBytes = Buffer.byteLength(memoText, 'utf8');
  if (memoBytes > cfg.maxMemoBytes) {
    throw new HttpError(400, `memoText exceeds ${cfg.maxMemoBytes} bytes`);
  }

  const rpcUrl = String(cfg.forceRpcUrl || body.rpcUrl || cfg.defaultRpcUrl).trim();
  if (!rpcUrl) {
    throw new HttpError(400, 'rpcUrl is required');
  }

  const commitment = parseCommitment(body.commitment, cfg.defaultCommitment);
  const signerLabel = parseSignerLabel(body.signerLabel);
  if (cfg.allowedLabels.length > 0 && !cfg.allowedLabels.includes(signerLabel)) {
    throw new HttpError(403, `signerLabel not allowed: ${signerLabel}`);
  }

  const memoProgramIdRaw = String(body.memoProgramId || DEFAULT_MEMO_PROGRAM_ID).trim();
  let memoProgramId;
  try {
    memoProgramId = new PublicKey(memoProgramIdRaw);
  } catch {
    throw new HttpError(400, `invalid memoProgramId: ${memoProgramIdRaw}`);
  }

  return {
    rpcUrl,
    commitment,
    memoText,
    memoProgramId,
    signerLabel,
  };
}

function authorize(req, cfg) {
  if (!cfg.authToken) return true;
  const authHeader = String(req.headers.authorization || '');
  if (!authHeader.toLowerCase().startsWith('bearer ')) return false;
  const token = authHeader.slice(7).trim();
  return secureTokenEquals(cfg.authToken, token);
}

function withRequestTimeout(req, timeoutMs) {
  req.setTimeout(timeoutMs, () => {
    req.destroy(new HttpError(408, `request timeout after ${timeoutMs}ms`));
  });
}

async function main() {
  const cfg = buildConfig();
  if (!fs.existsSync(cfg.keypairPath)) {
    throw new Error(`signer keypair not found: ${cfg.keypairPath}`);
  }
  const signer = loadKeypair(cfg.keypairPath);
  const signerPubkey = signer.publicKey.toBase58();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        service: 'anchor-signer',
        signerPubkey,
      });
      return;
    }

    if (req.method !== 'POST' || (url.pathname !== '/sign' && url.pathname !== '/submit')) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }

    if (!authorize(req, cfg)) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }

    withRequestTimeout(req, cfg.requestTimeoutMs);

    try {
      const body = await readJsonBody(req, cfg.maxMemoBytes * 8);
      const parsed = validateRequestBody(body, cfg);
      const result = await submitMemoAnchor({
        signer,
        rpcUrl: parsed.rpcUrl,
        commitment: parsed.commitment,
        memoText: parsed.memoText,
        memoProgramId: parsed.memoProgramId,
      });
      log('info', 'memo anchor submitted', {
        signerLabel: parsed.signerLabel,
        rpcUrl: parsed.rpcUrl,
        commitment: parsed.commitment,
        signature: result.signature,
      });
      sendJson(res, 200, {
        signature: result.signature,
        slot: result.slot,
      });
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(res, error.statusCode, { error: error.message });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      log('error', 'request failed', { message });
      sendJson(res, 500, { error: 'internal_error', message: String(message).slice(0, 300) });
    }
  });

  server.listen(cfg.port, cfg.bindHost, () => {
    log('info', 'service started', {
      host: cfg.bindHost,
      port: cfg.port,
      signerPubkey,
      defaultRpcUrl: cfg.defaultRpcUrl,
      forceRpcUrl: cfg.forceRpcUrl,
      defaultCommitment: cfg.defaultCommitment,
      authEnabled: Boolean(cfg.authToken),
      allowedSignerLabels: cfg.allowedLabels,
    });
  });

  const shutdown = () => {
    log('info', 'shutdown requested');
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 3000).unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  log('error', 'fatal startup error', { message });
  process.exit(1);
});
