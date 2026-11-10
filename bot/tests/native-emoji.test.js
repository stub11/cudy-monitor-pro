'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const handler=require('../api/webhook.js');
test('native emoji mapping is limited to approved phrase groups',()=>{
 const fn=handler._test.nativeEmojiForText;
 assert.equal(fn('привет, друзья'),'👍');
 assert.equal(fn('у меня всё работает'),'🎉');
 assert.equal(fn('релиз новой версии'),'🎉');
 assert.equal(fn('просто сообщение без триггеров'),null);
});
test('Telegram native reaction uses one allowed emoji and falls back to text on API failure',async()=>{
 const keys=['CUDY_TELEGRAM_BOT_TOKEN','CUDY_TELEGRAM_CHAT_ID','CUDY_TELEGRAM_TOPIC_ID',
 'STORAGE_KV_REST_API_URL','STORAGE_KV_REST_API_TOKEN','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN'];
 const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));const previousFetch=global.fetch;
 Object.assign(process.env,{CUDY_TELEGRAM_BOT_TOKEN:'fixture',
 CUDY_TELEGRAM_CHAT_ID:'-1003834368989',CUDY_TELEGRAM_TOPIC_ID:'87621',
 STORAGE_KV_REST_API_URL:'https://redis.invalid',STORAGE_KV_REST_API_TOKEN:'fake'});
 delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
 const token='fixture',seen=[],redis=new Map();
 let reject=false;
 global.fetch=async(url,opts)=>{
  const payload=JSON.parse(opts.body);
  if(url==='https://redis.invalid'){
   const [cmd,key,...a]=payload;let result=null;
   if(cmd==='GET')result=redis.get(key)||null;
   if(cmd==='SET'){if(a.includes('NX')&&redis.has(key))result=null;else{redis.set(key,a[0]);result='OK';}}
   if(cmd==='EVAL')result=1;
   return {ok:true,json:async()=>({result})};
  }
  const method=url.split('/').at(-1);seen.push({method,payload});
  if(reject&&method==='setMessageReaction')return {ok:false,json:async()=>({ok:false})};
  return {ok:true,json:async()=>({ok:true,result:true})};
 };
 const secret=crypto.createHash('sha256').update(token+'|cudyapp-topic-webhook-v1').digest('hex');
 const selected=Array.from({length:20000},(_,i)=>i+30000).find(i=>
  handler._test.allowReaction(i,token,0.35)&&
  handler._test.allowReaction(i,token+'|native',0.20)&&
  !handler._test.allowReaction(i,token+'|media',0.45));
 assert.ok(selected,'test can find eligible native reaction update');
 const invoke=async(id,topic=87621)=>{
  const res={statusCode:200,setHeader(){},end(){}};
  await handler({method:'POST',headers:{'x-telegram-bot-api-secret-token':secret},body:{
   update_id:id,message:{message_id:id,message_thread_id:topic,text:'привет',
   chat:{id:-1003834368989,type:'supergroup'},from:{id:50,is_bot:false}}
  }},res);
  assert.equal(res.statusCode,200);
 };
 try{
  await invoke(selected,87622);
  assert.equal(seen.length,0,'other topics never emit native reactions');
  await invoke(selected);
  const reaction=seen.find(x=>x.method==='setMessageReaction');
  assert.deepEqual(reaction?.payload.reaction,[{type:'emoji',emoji:'👍'}]);
  assert.equal(seen.some(x=>x.method==='sendMessage'),false);
  redis.clear();seen.length=0;reject=true;
  await invoke(selected+20000);
  // The second chosen id may not select native path, so test fallback directly with a new selected candidate.
  const id=Array.from({length:20000},(_,i)=>i+60000).find(i=>
   handler._test.allowReaction(i,token,0.35)&&
   handler._test.allowReaction(i,token+'|native',0.20)&&
   !handler._test.allowReaction(i,token+'|media',0.45));
  redis.clear();seen.length=0;
  await invoke(id);
  assert.equal(seen.some(x=>x.method==='setMessageReaction'),true);
  assert.equal(seen.some(x=>x.method==='sendMessage'),true,'text fallback on Telegram emoji rejection');
 }finally{
  global.fetch=previousFetch;
  for(const [k,v] of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 }
});
