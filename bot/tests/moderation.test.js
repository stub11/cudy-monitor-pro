'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkMessage, selectReaction } = require('../lib/moderation.js');
const webhook = require('../api/webhook.js');

test('filters only explicit profanity and targeted insults', () => {
  const policy = { delete_profanity: true, delete_explicit_insults: true };
  assert.equal(checkMessage('Привет! Хороший монитор', policy), null);
  assert.equal(checkMessage('На улице сука собаки', { ...policy, delete_profanity: false }), null);
  assert.equal(checkMessage('ты дебил!', policy).reason, 'insult');
  assert.equal(checkMessage('Сука, опять лаги', policy).reason, 'profanity');
  assert.equal(checkMessage('Плохое решение', policy), null);
});

test('triggers are empty by default and exact word boundaries are respected', () => {
  assert.equal(selectReaction('привет', [], 1), null);
  const triggers = [{
    words: ['кот'], responses: [
      { text: '🐈 Мяу!' },
      { sticker_file_id: 'CAACAgIAAxkBA-example' }
    ]
  }];
  assert.equal(selectReaction('Кот пришёл', triggers, 0).text, '🐈 Мяу!');
  assert.equal(selectReaction('кот', triggers, 1).sticker_file_id, 'CAACAgIAAxkBA-example');
  assert.equal(selectReaction('котлета', triggers, 0), null);
});

test('webhook secret is derived without disclosing bot token', () => {
  const token = 'FAKE_BOT_TOKEN_FOR_TEST';
  const secret = webhook._test.webhookSecret(token);
  assert.match(secret, /^[0-9a-f]{64}$/);
  assert.equal(webhook._test.equalSecret(secret, secret), true);
  assert.equal(webhook._test.equalSecret('wrong', secret), false);
});

test('only configured group and topic are processed', () => {
  const chat = { type: 'supergroup', username: 'zapret2keenetic', id: -1001 };
  const old = process.env.CUDY_TELEGRAM_CHAT_ID;
  process.env.CUDY_TELEGRAM_CHAT_ID = '@zapret2keenetic';
  try {
    assert.equal(webhook._test.targetChat(chat), true);
    assert.equal(webhook._test.targetChat({ ...chat, username: 'other' }), false);
    assert.equal(webhook._test.targetTopic({ message_thread_id: 87621 }), true);
    assert.equal(webhook._test.targetTopic({ message_thread_id: 999 }), false);
  } finally {
    if (old === undefined) delete process.env.CUDY_TELEGRAM_CHAT_ID;
    else process.env.CUDY_TELEGRAM_CHAT_ID = old;
  }
});

function fakeResponse() {
  return {
    statusCode: 200, headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    end(body) { this.body = body; }
  };
}
test('webhook rejects missing secret and invalid HTTP method', async () => {
  const old = process.env.CUDY_TELEGRAM_BOT_TOKEN;
  process.env.CUDY_TELEGRAM_BOT_TOKEN = 'FAKE-DO-NOT-USE';
  try {
    let response = fakeResponse();
    await webhook({ method: 'GET', headers: {} }, response);
    assert.equal(response.statusCode, 405);
    response = fakeResponse();
    await webhook({ method: 'POST', headers: {}, body: { update_id: 1 } }, response);
    assert.equal(response.statusCode, 401);
  } finally {
    if (old === undefined) delete process.env.CUDY_TELEGRAM_BOT_TOKEN;
    else process.env.CUDY_TELEGRAM_BOT_TOKEN = old;
  }
});
test('webhook does not process messages in another topic', async () => {
  const old = process.env.CUDY_TELEGRAM_BOT_TOKEN;
  const oldUrl = process.env.UPSTASH_REDIS_REST_URL;
  const oldKey = process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.CUDY_TELEGRAM_BOT_TOKEN = 'FAKE-DO-NOT-USE';
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const secret = webhook._test.webhookSecret(process.env.CUDY_TELEGRAM_BOT_TOKEN);
  const prev = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; throw Error('should not send'); };
  try {
    const response = fakeResponse();
    await webhook({
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': secret },
      body: { update_id: 99, message: {
        chat: { type: 'supergroup', username: 'zapret2keenetic', id: -1001 },
        message_id: 4, message_thread_id: 999, from: { id: 12, is_bot: false },
        text: 'сука'
      } }
    }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(calls, 0);
  } finally {
    global.fetch = prev;
    if (old === undefined) delete process.env.CUDY_TELEGRAM_BOT_TOKEN;
    else process.env.CUDY_TELEGRAM_BOT_TOKEN = old;
    if (oldUrl !== undefined) process.env.UPSTASH_REDIS_REST_URL = oldUrl;
    if (oldKey !== undefined) process.env.UPSTASH_REDIS_REST_TOKEN = oldKey;
  }
});
