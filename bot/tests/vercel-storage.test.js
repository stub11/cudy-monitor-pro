'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const handler = require('../api/webhook.js');
const token = 'fixture-only';
const secret = crypto.createHash('sha256').update(token+'|cudyapp-topic-webhook-v1').digest('hex');

test('Vercel Marketplace STORAGE_KV credentials enable flood storage', async () => {
  const keys = ['UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN',
    'STORAGE_KV_REST_API_URL','STORAGE_KV_REST_API_TOKEN',
    'CUDY_TELEGRAM_BOT_TOKEN','CUDY_TELEGRAM_CHAT_ID','CUDY_TELEGRAM_TOPIC_ID'];
  const before = Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  const oldFetch=global.fetch;
  const calls=[];
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.STORAGE_KV_REST_API_URL='https://storage-test.invalid';
  process.env.STORAGE_KV_REST_API_TOKEN='test-key';
  process.env.CUDY_TELEGRAM_BOT_TOKEN=token;
  process.env.CUDY_TELEGRAM_CHAT_ID='-1003834368989';
  process.env.CUDY_TELEGRAM_TOPIC_ID='87621';
  global.fetch=async(url,opts)=>{
    calls.push({url,auth:opts.headers.authorization,body:JSON.parse(opts.body)});
    if(url==='https://storage-test.invalid')
      return {ok:true,json:async()=>({result:opts.body.includes('"EVAL"')?1:'OK'})};
    return {ok:true,json:async()=>({ok:true,result:true})};
  };
  try {
    const update={update_id:99001,message:{message_id:8081,message_thread_id:87621,
      text:'Привет',chat:{id:-1003834368989,type:'supergroup'},
      from:{id:42,first_name:'test',is_bot:false}}};
    const res={statusCode:200,setHeader(){},end(){}};
    await handler({method:'POST',headers:{'x-telegram-bot-api-secret-token':secret},body:update},res);
    assert.equal(res.statusCode,200);
    assert.equal(calls.filter(x=>x.url==='https://storage-test.invalid').length,2,
      'deduplication and flood counter must both use Vercel Redis');
    assert.ok(calls.filter(x=>x.url==='https://storage-test.invalid').every(x=>x.auth==='Bearer test-key'));
  } finally {
    global.fetch=oldFetch;
    for(const [k,v] of Object.entries(before)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
  }
});
