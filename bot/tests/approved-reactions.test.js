'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../config.json');
const {selectReaction} = require('../lib/moderation.js');
const {allowReaction, targetChat, targetTopic} = require('../api/webhook.js')._test;

test('exact approved reaction inventory: 33 groups and 82 expressions', () => {
  const rules = config.reactions.triggers;
  assert.equal(rules.length, 33);
  assert.equal(rules.flatMap(r => r.words).length, 82);
  assert.equal(config.reactions.cooldown_seconds, 40);
  assert.equal(config.reactions.probability, 0.35);
  assert.equal(config.reactions.media_mode, 'mixed');
  assert.ok(rules.every(r => r.responses.length === 1 && typeof r.responses[0].text === 'string'));
  assert.equal(new Set(rules.flatMap(r => r.words)).size, 82, 'duplicate triggers cause confusing priorities');
  for (const rule of rules) {
    for (const expression of rule.words) {
      assert.equal(selectReaction(expression, rules)?.text, rule.responses[0].text, expression);
      assert.equal(selectReaction('Ой! '+expression.toUpperCase()+'!',rules)?.text,rule.responses[0].text);
    }
  }
});

test('whole-word matches: short abbreviations cannot fire inside common words', () => {
  const rules = config.reactions.triggers;
  for (const fragment of ['кукушка','пингвин','какие','багет','фрукт','стимулятор','прошивками','договор']) {
    assert.equal(selectReaction(fragment, rules), null, fragment);
  }
  assert.equal(selectReaction('Приветик!',rules)?.text, '🦊 О, ещё один пакет данных прибыл!');
  assert.equal(selectReaction('Это НЕ РАБОТАЕТ',rules)?.text,'🔧 Сейчас главное — не сделать ещё интереснее.');
  assert.equal(selectReaction('привет',[],0),null);
});

test('probability is bounded, deterministic and respects full shutdown', () => {
  assert.equal(allowReaction(17, 'sample', 0),false);
  assert.equal(allowReaction(17, 'sample', 1),true);
  assert.equal(allowReaction(17, 'sample',NaN),false);
  assert.equal(allowReaction(100, 'sample',0.35),allowReaction(100,'sample',0.35));
  const allowed = Array.from({length:1000},(_,i)=>allowReaction(i+1,'fixture',0.35)).filter(Boolean).length;
  assert.ok(allowed>275 && allowed<425,'probability should be approximately 35%');
});

test('topic and group restrictions still reject unrelated messages', () => {
  const oldChat=process.env.CUDY_TELEGRAM_CHAT_ID, oldTopic=process.env.CUDY_TELEGRAM_TOPIC_ID;
  process.env.CUDY_TELEGRAM_CHAT_ID='-1003834368989';
  process.env.CUDY_TELEGRAM_TOPIC_ID='87621';
  try {
    assert.equal(targetChat({id:-1003834368989,type:'supergroup'}),true);
    assert.equal(targetChat({id:-1003834368988,type:'supergroup'}),false);
    assert.equal(targetTopic({message_thread_id:87621}),true);
    assert.equal(targetTopic({message_thread_id:87622}),false);
    assert.equal(targetTopic({}),false);
  } finally {
    if(oldChat===undefined)delete process.env.CUDY_TELEGRAM_CHAT_ID;
    else process.env.CUDY_TELEGRAM_CHAT_ID=oldChat;
    if(oldTopic===undefined)delete process.env.CUDY_TELEGRAM_TOPIC_ID;
    else process.env.CUDY_TELEGRAM_TOPIC_ID=oldTopic;
  }
});
