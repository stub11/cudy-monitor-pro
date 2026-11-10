'use strict';
/**
 * Cudyapp: topic-only, privacy-minimizing Telegram Bot API webhook.
 * Existing release-announcement workflow remains independent.
 * No user message text or tokens are written to logs or persistent storage.
 */
const crypto = require('node:crypto');
const config = require('../config.json');
const { checkMessage, selectReaction } = require('../lib/moderation.js');

const SECRET_SALT = '|cudyapp-topic-webhook-v1';

function webhookSecret(token) {
  return crypto.createHash('sha256').update(token + SECRET_SALT).digest('hex');
}
function equalSecret(a, b) {
  if (typeof a !== 'string' || !/^[0-9a-f]{64}$/.test(a)) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}
function targetChat(chat) {
  if (!chat || !['supergroup', 'group'].includes(chat.type)) return false;
  const expected = String(process.env.CUDY_TELEGRAM_CHAT_ID || '@zapret2keenetic');
  if (/^-?\d+$/.test(expected)) return String(chat.id) === expected;
  return (chat.username || '').toLowerCase() === expected.replace(/^@/, '').toLowerCase();
}
function targetTopic(message) {
  return message && Number(message.message_thread_id) === Number(
    process.env.CUDY_TELEGRAM_TOPIC_ID || config.topic_id
  );
}
async function api(method, payload, token) {
  const url = 'https://api.telegram.org/bot' + token + '/' + method;
  const reply = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(6500)
  });
  const data = await reply.json();
  if (!reply.ok || !data.ok) throw new Error('Telegram API ' + method + ' rejected request');
  return data.result;
}
async function redis(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const key = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !key) return null;
  const response = await fetch(url.replace(/\/$/, ''), {
    method: 'POST',
    headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(3000)
  });
  if (!response.ok) throw new Error('Rate-limit storage unavailable');
  const data = await response.json();
  if (data.error) throw new Error('Rate-limit storage rejected command');
  return data.result;
}
async function once(key, ttl) {
  const value = await redis(['SET', key, '1', 'EX', ttl, 'NX']);
  return value === 'OK';
}
async function rollingCounter(key, windowSeconds, messageId, timestampMs = Date.now()) {
  // One atomic Redis operation: count only the preceding windowSeconds.
  // Unique message IDs prevent retries from inflating the user's count.
  const script = [
    "redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',ARGV[1])",
    "redis.call('ZADD',KEYS[1],ARGV[2],ARGV[3])",
    "redis.call('EXPIRE',KEYS[1],ARGV[4])",
    "return redis.call('ZCARD',KEYS[1])"
  ].join('; ');
  const cutoff = timestampMs - windowSeconds * 1000;
  return Number(await redis(['EVAL', script, '1', key, String(cutoff),
    String(timestampMs), String(messageId), String(windowSeconds + 2)]));
}
function hasRedis() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}
async function warn(message, text, token, name) {
  if (!config.moderation.warnings.enabled || !hasRedis()) return;
  const uid = message.from.id;
  const key = 'cudy:warn:' + message.chat.id + ':' + uid;
  if (!await once(key, config.moderation.warnings.cooldown_seconds)) return;
  await api('sendMessage', {
    chat_id: message.chat.id,
    message_thread_id: message.message_thread_id,
    text: '⚠️ ' + htmlEscape(name) + ', ' + htmlEscape(text) + ' Пожалуйста, соблюдайте правила темы.',
    parse_mode: 'HTML', disable_notification: true
  }, token);
}
async function react(message, reaction, token) {
  const payload = {
    chat_id: message.chat.id, message_thread_id: message.message_thread_id,
    reply_to_message_id: message.message_id, allow_sending_without_reply: true,
    disable_notification: true
  };
  if (reaction.sticker_file_id) {
    await api('sendSticker', { ...payload, sticker: reaction.sticker_file_id }, token);
  } else if (reaction.animation_url) {
    await api('sendAnimation', { ...payload, animation: reaction.animation_url,
      caption: String(reaction.text || '').slice(0, 500) }, token);
  } else if (reaction.photo_url) {
    await api('sendPhoto', { ...payload, photo: reaction.photo_url,
      caption: String(reaction.text || '').slice(0, 500) }, token);
  } else {
    await api('sendMessage', { ...payload,
      text: String(reaction.text || reaction.emoji || '😄').slice(0, 500) }, token);
  }
}
async function processUpdate(update, token) {
  const message = update.message || update.edited_message;
  if (!message || !targetChat(message.chat) || !targetTopic(message)) return;
  if (!message.from || message.from.is_bot || !config.enabled) return;
  const text = message.text || message.caption || '';
  const named = (message.from.first_name || 'Участник').slice(0, 40);
  // Do not store message contents, only minimal ephemeral counter keys.
  let bad = config.moderation.enabled ? checkMessage(text, config.moderation) : null;
  if (!bad && hasRedis() && config.moderation.enabled && config.moderation.flood.enabled &&
      update.message) {
    const rule = config.moderation.flood;
    const key = 'cudy:flood:v2:' + message.chat.id + ':' +
      message.message_thread_id + ':' + message.from.id;
    try {
      const count = await rollingCounter(key, rule.window_seconds, message.message_id);
      if (count > rule.limit) bad = { reason: 'flood' };
    } catch {
      // Fail open on rate-limit store errors to avoid deleting innocent messages.
    }
  }
  if (bad) {
    // Never moderate group owners or other administrators automatically.
    // If membership cannot be confirmed, fail open instead of deleting.
    try {
      const membership = await api('getChatMember', {
        chat_id: message.chat.id, user_id: message.from.id
      }, token);
      if (!membership || ['creator', 'administrator'].includes(membership.status)) return;
    } catch { return; }
    try {
      await api('deleteMessage', {
        chat_id: message.chat.id, message_id: message.message_id
      }, token);
    } catch {
      // Missing admin permission or already deleted. Do not ban/mute.
      return;
    }
    const reason = bad.reason === 'flood' ? 'не отправляйте много сообщений подряд.' :
      'без мата и оскорблений.';
    try { await warn(message, reason, token, named); } catch { /* best effort */ }
    return;
  }
  if (!update.message || !config.reactions.enabled || !hasRedis()) return;
  const reaction = selectReaction(text, config.reactions.triggers, update.update_id || message.message_id);
  if (!reaction) return;
  const throttle = 'cudy:reaction:' + message.chat.id + ':' + message.message_thread_id;
  try {
    if (!await once(throttle, config.reactions.cooldown_seconds)) return;
    await react(message, reaction, token);
  } catch { /* media may be unavailable; never disrupt ordinary chat */ }
}
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405; res.setHeader('Allow', 'POST'); res.end('Method Not Allowed'); return;
  }
  const token = process.env.CUDY_TELEGRAM_BOT_TOKEN;
  if (!token) { res.statusCode = 503; res.end('Not configured'); return; }
  const secret = webhookSecret(token);
  const claimed = req.headers['x-telegram-bot-api-secret-token'];
  if (!equalSecret(claimed, secret)) { res.statusCode = 401; res.end('Unauthorized'); return; }
  const update = req.body;
  if (!update || typeof update !== 'object' || !Number.isSafeInteger(update.update_id)) {
    res.statusCode = 400; res.end('Invalid update'); return;
  }
  if (hasRedis()) {
    try {
      if (!await once('cudy:update:' + update.update_id, 86400)) {
        res.statusCode = 200; res.end('OK'); return;
      }
    } catch {
      res.statusCode = 503; res.end('Storage unavailable'); return;
    }
  }
  try {
    await processUpdate(update, token);
  } catch {
    // Do not reveal token, messages or update contents in public logs.
    res.statusCode = 503; res.end('Temporary failure'); return;
  }
  res.statusCode = 200; res.end('OK');
};
module.exports._test = { webhookSecret, equalSecret, targetChat, targetTopic, processUpdate };
