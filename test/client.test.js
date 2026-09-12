import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('Swarm Mind OS exposes the official X account and Robinhood identity without wallet UI', async () => {
  const [html, js, css] = await Promise.all([
    source('index.html'),
    source('src/main.js'),
    source('src/style.css'),
  ]);

  assert.match(html, /<title>SWARM MIND OS<\/title>/);
  assert.match(html, /<a[^>]+class="outline social-link"[^>]+href="https:\/\/x\.com\/SwarmmindOS"[^>]+target="_blank"[^>]+rel="noopener noreferrer"[^>]*>\s*X\s*<span>↗<\/span>\s*<\/a>/);
  assert.match(html, /Robinhood Chain/);
  assert.doesNotMatch(html, /BNB|Binance|swarmOSterminal/i);
  assert.doesNotMatch(js, /BNB|Binance|swarmOSterminal/i);
  assert.doesNotMatch(html, /Connect wallet|walletBtn/i);
  assert.doesNotMatch(js, /window\.ethereum|eth_requestAccounts|wallet_switchEthereumChain|wallet_addEthereumChain|walletBtn/);
  assert.doesNotMatch(html, /ROBINHOOD ONLINE|agents active|real-time consensus|5 live|Liquidity found|simulation passed|Honeypot indicators|live neural activity|DEX route comparison is standing by/i);
  assert.match(html, /No live chain tools or transactions/);
  assert.match(css, /\.social-link\{/);
  assert.match(css, /@media\(max-width:1100px\)\{body\{overflow:auto\}/);
  assert.match(css, /@media\(max-width:620px\)\{\.online\{display:none\}\.social-link\{height:44px;/);
  assert.match(html, /id="amountInput"[^>]+max="1000000"/);
  assert.match(js, /MAX_RESEARCH_AMOUNT=1_000_000/);
  assert.match(js, /amount>MAX_RESEARCH_AMOUNT/);
});
