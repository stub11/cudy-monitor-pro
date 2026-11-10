'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {answerPublicQuestion,faq} = require('../lib/public-faq.js');
const webhook = require('../api/webhook.js');

test('FAQ comes exclusively from fixed public documentation answers',()=>{
  assert.ok(faq.length >= 10);
  const questions = [
    'Как установить монитор?',
    'Какие роутеры поддерживаются?',
    'Как обновить монитор?',
    'Как открыть панель?',
    'Как удалить монитор?',
    'Какие функции монитора?',
    'Где посмотреть логи монитора?',
    'Какая лицензия у монитора?',
    '/cudy_help'
  ];
  for (const question of questions) {
    const answer=answerPublicQuestion(question);
    assert.ok(answer && answer.includes('https://github.com/stub11/cudy-monitor-pro'),question);
    assert.ok(!/keenetic\s*:\s*\S+|bot\d+:\S+/ui.test(answer),'no private credentials');
  }
  assert.equal(answerPublicQuestion('привет, как дела?'), null);
  assert.equal(answerPublicQuestion('почему не работает домашний интернет?'),null);
  assert.equal(answerPublicQuestion('Напиши мне пароль от роутера'),null);
  assert.equal(answerPublicQuestion('ку'),null);
  assert.equal(answerPublicQuestion('Какие роутеры поддерживаются'),null);
  assert.equal(answerPublicQuestion('A'.repeat(1001)+'?'),null);
  assert.equal(answerPublicQuestion('/cudy_help'),answerPublicQuestion('/cudy_help@Cudyapp'));
});
test('FAQ is limited to target chat/topic, and never replies to a bot', async()=>{
  const keys=['CUDY_TELEGRAM_BOT_TOKEN','CUDY_TELEGRAM_CHAT_ID','CUDY_TELEGRAM_TOPIC_ID','STORAGE_KV_REST_API_URL','STORAGE_KV_REST_API_TOKEN','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN'];
  const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]])),original=global.fetch;
  const token='test-only', secret=crypto.createHash('sha256').update(token+'|cudyapp-topic-webhook-v1').digest('hex');
  process.env.CUDY_TELEGRAM_BOT_TOKEN=token;
  process.env.CUDY_TELEGRAM_CHAT_ID='-1003834368989';
  process.env.CUDY_TELEGRAM_TOPIC_ID='87621';
  process.env.STORAGE_KV_REST_API_URL='https://fake-redis.invalid';
  process.env.STORAGE_KV_REST_API_TOKEN='test';
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const sent=[];
  global.fetch=async(url,opts)=>{
    if(url==='https://fake-redis.invalid')
      return {ok:true,json:async()=>({result:'OK'})};
    const method=url.split('/').at(-1),payload=JSON.parse(opts.body);
    sent.push({method,payload});
    return {ok:true,json:async()=>({ok:true,result:true})};
  };
  let id=20;
  const request=async({topic=87621,chat=-1003834368989,isBot=false,text='Как установить монитор?'}={})=>{
    const res={statusCode:200,setHeader(){},end(){}};
    await webhook({method:'POST',headers:{'x-telegram-bot-api-secret-token':secret},body:{
      update_id:9000+(++id),message:{
        message_id:id,message_thread_id:topic,text,
        chat:{id:chat,type:'supergroup'},from:{id:31,is_bot:isBot}
      }
    }},res);
    return res.statusCode;
  };
  try{
    assert.equal(await request({topic:87622}),200);
    assert.equal(await request({chat:-1003834368988}),200);
    assert.equal(await request({isBot:true}),200);
    assert.equal(sent.length,0,'no Telegram messages outside scope');
    assert.equal(await request(),200);
    assert.equal(sent.length,1,'answer once');
    assert.equal(sent[0].method,'sendMessage');
    assert.equal(sent[0].payload.message_thread_id,87621);
    assert.equal(sent[0].payload.disable_notification,true);
    assert.equal(sent[0].payload.disable_web_page_preview,true);
    assert.equal(sent[0].payload.text.includes('https://github.com/stub11/cudy-monitor-pro'),true);
    assert.equal(sent[0].payload.text.includes('test-only'),false);
  } finally {
    global.fetch=original;
    for(const[k,v] of Object.entries(saved)) {if(v===undefined)delete process.env[k];else process.env[k]=v;}
  }
});
