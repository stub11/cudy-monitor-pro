'use strict';
/**
 * Cudyapp: topic-only, privacy-minimizing Telegram Bot API webhook.
 * Existing release-announcement workflow remains independent.
 * No user message text or tokens are written to logs or persistent storage.
 */
const crypto = require('node:crypto');
const config = require('../config.json');
const { checkMessage, selectReaction } = require('../lib/moderation.js');
const { answerPublicQuestion } = require('../lib/public-faq.js');
const issueIntake = require('../lib/problem-intake.js');

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
function redisCredentials() {
  // Vercel Upstash Marketplace uses STORAGE_KV_REST_API_* by default.
  // Existing standalone Upstash installs use UPSTASH_REDIS_REST_*.
  return {
    url: process.env.UPSTASH_REDIS_REST_URL || process.env.STORAGE_KV_REST_API_URL,
    key: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.STORAGE_KV_REST_API_TOKEN
  };
}
async function redis(command) {
  const { url, key } = redisCredentials();
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
function allowReaction(updateId, token, probability = 1) {
  const chance = Number(probability);
  if (!Number.isFinite(chance) || chance <= 0) return false;
  if (chance >= 1) return true;
  const digest = crypto.createHash('sha256')
    .update(String(updateId) + '|' + token).digest();
  return digest.readUInt32BE(0) / 0x100000000 < chance;
}
function hasRedis() {
  const { url, key } = redisCredentials();
  return Boolean(url && key);
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
function diagnosticKeyboard(step, complete = false) {
  const choices = {
    platform: [['🟢 OpenWrt','openwrt'],['🔵 Keenetic Ported','keenetic'],['❔ Другая система','other']],
    symptom: [['📦 Установка','install'],['🌐 Панель','panel'],['⬆️ Обновление','update'],['📈 Мониторинг сети','network'],['❔ Другое','other']],
    tried: [['📖 Читал README','docs'],['🔄 Повторил запуск','restart'],['🆕 Ещё ничего','nothing'],['❔ Другое','other']]
  };
  if (complete) return {inline_keyboard: [
    [{text:'✍️ Добавить или изменить описание',callback_data:'cd:describe:yes'}],
    [{text:'📤 Опубликовать после проверки',callback_data:'cd:report:yes'}],
    [{text:'❌ Отмена',callback_data:'cd:cancel:yes'}]
  ]};
  if (!choices[step]) return undefined;
  return {inline_keyboard: [
    ...choices[step].map(([text,value])=>[{text,callback_data:'cd:'+step+':'+value}]),
    [{text:'❌ Отмена',callback_data:'cd:cancel:yes'}]
  ]};
}
async function problemReply(message, text, token, keyboard) {
  await api('sendMessage', {
    chat_id: message.chat.id, message_thread_id: message.message_thread_id,
    reply_to_message_id: message.message_id,
    disable_notification: true, disable_web_page_preview: true,
    text, ...(keyboard ? {reply_markup: keyboard} : {})
  }, token);
}
async function publishSanitizedIssue(state) {
  // Disabled until the owner configures a dedicated least-privilege GitHub token.
  if (process.env.CUDY_ISSUE_REPORTS_ENABLED !== 'true') return false;
  const token = process.env.CUDY_GITHUB_ISSUE_TOKEN;
  if (!token) return false;
  const report = issueIntake.buildIssue(state);
  if (!report) return false;
  // A public issue is generated solely from whitelisted enums, never user text.
  const response = await fetch('https://api.github.com/repos/stub11/cudy-monitor-pro/issues', {
    method: 'POST',
    headers: {
      'authorization': 'Bearer ' + token,
      'accept': 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'cudyapp-sanitized-diagnostics',
      'content-type': 'application/json'
    },
    body: JSON.stringify(report),
    signal: AbortSignal.timeout(6000)
  });
  return response.status === 201;
}
async function handleProblem(message, text, token) {
  if (!hasRedis()) return false;
  // Do not spend a Redis GET for every ordinary group message.
  if (!issueIntake.startsProblem(text) &&
      !/^\/cudy_(?:platform|symptom|tried|report|cancel|describe)/iu.test(String(text).trim())) return false;
  const key = 'cudy:problem:' + message.chat.id + ':' +
    message.message_thread_id + ':' + message.from.id;
  const command = String(text).trim().toLowerCase();
  const activeRaw = await redis(['GET', key]);
  let state = {};
  if (typeof activeRaw === 'string') {
    try { const parsed = JSON.parse(activeRaw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) state = parsed;
    } catch { state = {}; }
  }
  if (/^\/cudy_cancel(?:@cudyapp)?\s*$/u.test(command)) {
    if (!activeRaw) return false;
    await redis(['DEL', key]);
    await problemReply(message, 'Опрос отменён. Никакой отчёт не опубликован.', token);
    return true;
  }
  if (issueIntake.startsProblem(text)) {
    await redis(['SET', key, JSON.stringify({}), 'EX', '1800']);
    await problemReply(message, issueIntake.prompt('platform'), token, diagnosticKeyboard('platform'));
    return true;
  }
  if (!activeRaw) return false;
  const step = issueIntake.nextStep(state);
  if (/^\/cudy_describe(?:@cudyapp)?(?:\s|$)/u.test(command) && !step) {
    const raw = String(text).replace(/^\/cudy_describe(?:@Cudyapp)?\s*/iu,'');
    const cleaned = issueIntake.scrubDescription(raw);
    if (!cleaned) {
      await problemReply(message,'Описание слишком короткое или длинное. Нужно 10–1500 символов, без паролей, IP и токенов.\n'+issueIntake.descriptionPrompt(),token);
      return true;
    }
    state.description = cleaned;
    await redis(['SET',key,JSON.stringify(state),'EX','1800']);
    await problemReply(message,'🔎 Проверьте текст, который попадёт в ПУБЛИЧНЫЙ GitHub Issue:\n\n'+
      issueIntake.buildIssue(state).body+'\n\nАвтоматическая очистка может пропустить личные данные. '+
      'Для исправления отправьте /cudy_describe с новым текстом. Для публикации нажмите кнопку ниже.',
      token,diagnosticKeyboard(null,true));
    return true;
  }
  if (/^\/cudy_report(?:@cudyapp)?\s*$/u.test(command) && !step) {
    const report = issueIntake.buildIssue(state);
    if (!report) return true;
    // Always show exact public payload before publication when user opted
    // to attach free-form text. A separate final confirmation is required.
    const expectedDigest = crypto.createHash('sha256').update(report.body).digest('hex');
    if (state.description && state.previewDigest !== expectedDigest) {
      state.previewDigest = expectedDigest;
      await redis(['SET',key,JSON.stringify(state),'EX','1800']);
      await problemReply(message,'🔎 Финальная проверка публичного отчёта:\n\n'+report.body+
        '\nПроверьте текст. Если он безопасен, нажмите «📤 Опубликовать после проверки» ещё раз.',
        token,diagnosticKeyboard(null,true));
      return true;
    }
    if (process.env.CUDY_ISSUE_REPORTS_ENABLED !== 'true' ||
        !process.env.CUDY_GITHUB_ISSUE_TOKEN) {
      await problemReply(message,
        'Отчёт подготовлен, но отправка в GitHub пока не настроена. Данные не переданы. '+
        'Ознакомьтесь с публичным README: https://github.com/stub11/cudy-monitor-pro#readme', token);
      return true;
    }
    // Deduplicate only successful publications. An in-flight lock prevents
    // simultaneous submissions but must be released after GitHub rejects a request.
    const digest = crypto.createHash('sha256').update(JSON.stringify(report)).digest('hex');
    const completedKey = 'cudy:issue-report:sent:v2:' + digest;
    const lockKey = 'cudy:issue-report:lock:v2:' + digest;
    if (await redis(['GET', completedKey])) {
      await redis(['DEL', key]);
      return true;
    }
    if (!await once(lockKey, 60)) {
      // A different consented report of the same category is already processing.
      return true;
    }
    let published = false;
    try {
      published = await publishSanitizedIssue(state);
      if (published) {
        await redis(['SET', completedKey, '1', 'EX', 86400]);
        await redis(['DEL', key]);
      }
    } finally {
      await redis(['DEL', lockKey]);
    }
    if (!published) {
      await problemReply(message, 'Отправить обезличенный отчёт не получилось. '+
        'Попробуйте позднее или сообщите об ошибке через '+
        'https://github.com/stub11/cudy-monitor-pro/issues/new/choose', token);
    }
    return true;
  }
  if (step) {
    const value = issueIntake.option(text,step);
    if (!value) {
      // Ignore unrelated discussion rather than hijacking every user message.
      return /^\/cudy_(?:platform|symptom|tried|report)/u.test(command);
    }
    state[step] = value;
    await redis(['SET', key, JSON.stringify(state), 'EX', '1800']);
    const next = issueIntake.nextStep(state);
    await problemReply(message, next ? issueIntake.prompt(next) :
      issueIntake.summarize(state)+'\n\n'+issueIntake.descriptionPrompt(),
      token,next ? diagnosticKeyboard(next) : diagnosticKeyboard(null,true));
    return true;
  }
  return false;
}
async function handleDiagnosticCallback(callback, token) {
  const m = callback.message;
  if (!m || !targetChat(m.chat) || !targetTopic(m) ||
      !callback.from || callback.from.is_bot || !config.enabled) return;
  const match = /^cd:(platform|symptom|tried|cancel|report|describe):([a-z]+)$/u.exec(
    String(callback.data || ''));
  if (!match) return;
  const step=match[1], value=match[2];
  if (step==='describe' && value==='yes') {
    // This button only displays instructions: text must be submitted explicitly.
    await api('answerCallbackQuery',{callback_query_id:callback.id,
      text:'✍️ Отправьте /cudy_describe и текст одним сообщением',show_alert:true},token);
    return;
  }
  const data = (step==='report' || step==='cancel')
    ? (value==='yes' ? '/cudy_'+step : null)
    : (issueIntake.OPTIONS[step]?.includes(value) ? '/cudy_'+step+' '+value : null);
  if (!data || !hasRedis()) return;
  const userMessage = { ...m, from:callback.from };
  try {
    const accepted=await handleProblem(userMessage,data,token);
    // Always acknowledge so the Telegram client stops displaying its spinner.
    await api('answerCallbackQuery',{
      callback_query_id:callback.id,
      text:accepted?'✅ Принято':'ℹ️ Опрос неактивен. Начните /cudy_problem',
      show_alert:false
    },token);
  } catch {
    try {await api('answerCallbackQuery',{callback_query_id:callback.id,
      text:'Не получилось обработать выбор. Попробуйте ещё раз.',
      show_alert:false},token);}catch{}
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
  // Only process diagnostic intake after moderation and within the target topic.
  if (update.message && hasRedis()) {
    try {
      if (await handleProblem(message, text, token)) return;
    } catch { /* no personal logs, diagnostics fail open */ }
  }
  // Public documentation support precedes humorous reactions. No remote model,
  // no private files, and no README fetching at request time.
  if (update.message && hasRedis()) {
    const faqAnswer = answerPublicQuestion(text);
    if (faqAnswer) {
      try {
        const faqKey = 'cudy:public-faq:' + message.chat.id + ':' +
          message.message_thread_id + ':' + message.from.id;
        // Prevent identical answers flooding the whole topic when several
        // people ask the same question within a short interval.
        const faqDigest = crypto.createHash('sha256').update(faqAnswer).digest('hex').slice(0, 24);
        const sameAnswerKey = 'cudy:public-faq:shared:' +
          message.chat.id + ':' + message.message_thread_id + ':' + faqDigest;
        if (await once(faqKey, 90) && await once(sameAnswerKey, 30)) {
          await api('sendMessage', {
            chat_id: message.chat.id,
            message_thread_id: message.message_thread_id,
            reply_to_message_id: message.message_id,
            text: faqAnswer,
            disable_notification: true,
            disable_web_page_preview: true
          }, token);
        }
      } catch { /* FAQ errors must not interrupt discussion. */ }
      return;
    }
  }
  if (!update.message || !config.reactions.enabled || !hasRedis()) return;
  const reaction = selectReaction(text, config.reactions.triggers, update.update_id || message.message_id);
  if (!reaction || !allowReaction(update.update_id || message.message_id, token,
      config.reactions.probability ?? 1)) return;
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
    if (update.callback_query) await handleDiagnosticCallback(update.callback_query, token);
    else await processUpdate(update, token);
  } catch {
    // Do not reveal token, messages or update contents in public logs.
    res.statusCode = 503; res.end('Temporary failure'); return;
  }
  res.statusCode = 200; res.end('OK');
};
module.exports._test = { webhookSecret, equalSecret, targetChat, targetTopic, processUpdate, allowReaction, diagnosticKeyboard, handleDiagnosticCallback };
