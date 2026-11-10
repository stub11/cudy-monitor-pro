'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const handler = require('../api/webhook.js');
const TOKEN = 'fixture-not-real-token';
const SECRET = crypto.createHash('sha256').update(TOKEN+'|cudyapp-topic-webhook-v1').digest('hex');
const GROUP = '-1003834368989';
const TOPIC = 87621;
function fixture(messageId) {
  return {update_id: 5000+messageId, message:{
    message_id:messageId,message_thread_id:TOPIC,text:'Обычное сообщение',
    chat:{id:Number(GROUP),type:'supergroup'},
    from:{id:123,first_name:'Tester',is_bot:false}
  }};
}
async function run(update) {
  const res={statusCode:200,setHeader(){},end(){}};
  await handler({method:'POST',
    headers:{'x-telegram-bot-api-secret-token':SECRET},
    body:update},res);
  return res.statusCode;
}
test('rolling window counts exact topic and removes seventh message without text storage', async () => {
  const saved = {};
  const env = {
    CUDY_TELEGRAM_BOT_TOKEN:TOKEN,
    CUDY_TELEGRAM_CHAT_ID:GROUP,
    CUDY_TELEGRAM_TOPIC_ID:String(TOPIC),
    UPSTASH_REDIS_REST_URL:'https://mock-upstash.invalid',
    UPSTASH_REDIS_REST_TOKEN:'fake-test-secret'
  };
  for(const key of Object.keys(env)){saved[key]=process.env[key];process.env[key]=env[key];}
  const oldFetch=global.fetch;
  let count=0, deletes=0, evalCalls=0;
  const commands=[];
  global.fetch=async(url,options)=>{
    const command=JSON.parse(options.body);
    if(url==='https://mock-upstash.invalid'){
      commands.push(command);
      if(command[0]==='EVAL') {
        evalCalls++;
        return {ok:true,json:async()=>({result:++count})};
      }
      return {ok:true,json:async()=>({result:'OK'})};
    }
    const method=url.split('/').at(-1);
    if(method==='deleteMessage')deletes++;
    return {ok:true,json:async()=>({ok:true,result:method==='getChatMember'?{status:'member'}:true})};
  };
  try {
    for(let i=1;i<=7;i++)assert.equal(await run(fixture(i)),200);
    assert.equal(evalCalls,7);
    assert.equal(deletes,1,'only seventh message should be removed');
    const evalCommands=commands.filter(c=>c[0]==='EVAL');
    assert.ok(evalCommands.every(c=>c[2]==='1'));
    assert.ok(evalCommands.every(c=>c[3].includes(':87621:123')));
    assert.ok(evalCommands.every(c=>c[1].includes('ZREMRANGEBYSCORE')));
    assert.ok(evalCommands.every(c=>c[1].includes('ZCARD')));
    assert.equal(new Set(evalCommands.map(c=>c[6])).size,7,'unique per-message markers');
    assert.ok(!JSON.stringify(commands).includes('Обычное сообщение'),'content must not be stored');
    const invalid=fixture(8);invalid.message.message_thread_id=TOPIC+1;
    assert.equal(await run(invalid),200);
    assert.equal(evalCalls,7,'other topics never hit Redis');
  } finally {
    global.fetch=oldFetch;
    for(const key of Object.keys(env)){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}
  }
});
