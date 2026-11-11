'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const webhook = require('../api/webhook.js');
const { checkMessage, selectReaction } = require('../lib/moderation.js');

const TOKEN = 'test-token-not-a-secret';
const CHAT = -1003834368989;
const TOPIC = 87621;
const secret = crypto.createHash('sha256')
  .update(TOKEN + '|cudyapp-topic-webhook-v1').digest('hex');

function request(update, header = secret) {
  const req = { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': header }, body: update };
  const res = {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k] = v; },
    end(v = '') { this.body = v; }
  };
  return webhook(req, res).then(() => res);
}
function message(topic = TOPIC, text = 'безобидный текст') {
  return { update_id: 500, message: {
    message_id: 70, message_thread_id: topic, text,
    chat: { id: CHAT, type: 'supergroup', username: 'zapret2keenetic' },
    from: { id: 123, first_name: 'Tester', is_bot: false }
  } };
}
test('secure webhook and exact topic matching', async () => {
  const oldEnv = {
    token: process.env.CUDY_TELEGRAM_BOT_TOKEN,
    chat: process.env.CUDY_TELEGRAM_CHAT_ID,
    topic: process.env.CUDY_TELEGRAM_TOPIC_ID,
    redisUrl: process.env.UPSTASH_REDIS_REST_URL,
    redisToken: process.env.UPSTASH_REDIS_REST_TOKEN
  };
  const oldFetch = global.fetch;
  const calls = [];
  process.env.CUDY_TELEGRAM_BOT_TOKEN = TOKEN;
  process.env.CUDY_TELEGRAM_CHAT_ID = String(CHAT);
  process.env.CUDY_TELEGRAM_TOPIC_ID = String(TOPIC);
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  global.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ ok: true, result: { status: 'member' } }) };
  };
  try {
    assert.equal((await request(message(), 'bad-secret')).statusCode, 401);
    assert.equal(calls.length, 0);
    assert.equal((await request(message(TOPIC + 1, 'сука'))).statusCode, 200);
    assert.equal(calls.length, 0, 'never moderate other topics');
    assert.equal((await request({ ...message(TOPIC, 'сука'), message: {
      ...message(TOPIC, 'сука').message,
      chat: { id: CHAT + 1, type: 'supergroup' }
    } })).statusCode, 200);
    assert.equal(calls.length, 0, 'never moderate other chats');
    assert.equal((await request(message(TOPIC, 'сука'))).statusCode, 200);
    assert.deepEqual(calls.map(c => c.url.split('/').at(-1)), ['getChatMember', 'deleteMessage']);
    assert.equal(calls[1].body.chat_id, CHAT);
    assert.equal(calls[1].body.message_id, 70);
    calls.length = 0;
    assert.equal((await request(message(TOPIC, 'Привет!'))).statusCode, 200);
    assert.equal(calls.length, 0, 'no unsolicited reaction without configured triggers');
  } finally {
    global.fetch = oldFetch;
    for (const [key, value] of Object.entries({
      CUDY_TELEGRAM_BOT_TOKEN: oldEnv.token,
      CUDY_TELEGRAM_CHAT_ID: oldEnv.chat,
      CUDY_TELEGRAM_TOPIC_ID: oldEnv.topic,
      UPSTASH_REDIS_REST_URL: oldEnv.redisUrl,
      UPSTASH_REDIS_REST_TOKEN: oldEnv.redisToken
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
test('conservative moderation and empty reaction list', () => {
  assert.equal(checkMessage('обычная техническая беседа', {delete_profanity:true,delete_explicit_insults:true}), null);
  assert.equal(checkMessage('ты идиот', {delete_profanity:false,delete_explicit_insults:true})?.reason, 'insult');
  assert.equal(selectReaction('привет', []), null);
  assert.equal(selectReaction('привет', [{words:['привет'],responses:[{text:'Привет!'}]}])?.text, 'Привет!');
});
