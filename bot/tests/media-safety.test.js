'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const bot=require('../api/webhook.js');
const intake=require('../lib/problem-intake.js');

test('reject obscene and vague user problem descriptions before publication',()=>{
 const examples=['нихуя не работает','Вся эта херня не работает','Монитор блядский вообще не открывается','что-то не работает'];
 for(const example of examples) assert.equal(intake.scrubDescription(example),null,example);
 assert.equal(intake.scrubDescription('После обновления монитора график трафика пустой, хотя интернет работает.'),
  'После обновления монитора график трафика пустой, хотя интернет работает.');
});

test('media commands parse only bounded, explicit categories',()=>{
 const parse=bot._test.mediaCommand;
 assert.deepEqual(parse('/cudy_media add 1'),{action:'add',index:0});
 assert.deepEqual(parse('/cudy_media remove 33'),{action:'remove',index:32});
 assert.deepEqual(parse('/cudy_media list'),{action:'list',index:null});
 assert.equal(parse('/cudy_media add 34'),null);
 assert.equal(parse('/cudy_media add 0'),null);
 assert.equal(parse('/cudy_media add 1 extra'),null);
 assert.equal(parse('/cudy_media add -1'),null);
});

test('only group administrator in specified topic can save Telegram-hosted sticker',async()=>{
 const env=['CUDY_TELEGRAM_BOT_TOKEN','CUDY_TELEGRAM_CHAT_ID','CUDY_TELEGRAM_TOPIC_ID','STORAGE_KV_REST_API_URL','STORAGE_KV_REST_API_TOKEN','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN'];
 const prev=Object.fromEntries(env.map(k=>[k,process.env[k]]));const oldFetch=global.fetch;
 Object.assign(process.env,{CUDY_TELEGRAM_BOT_TOKEN:'fake-bot',CUDY_TELEGRAM_CHAT_ID:'-1003834368989',
 CUDY_TELEGRAM_TOPIC_ID:'87621',STORAGE_KV_REST_API_URL:'https://redis.test.invalid',
 STORAGE_KV_REST_API_TOKEN:'fixture'});delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
 const store=new Map(),sent=[];let role='member';
 global.fetch=async(url,opts)=>{
  const payload=JSON.parse(opts.body);
  if(url==='https://redis.test.invalid'){
   const [cmd,key,...a]=payload;let result=null;
   if(cmd==='SET'){store.set(key,a[0]);result='OK';}
   if(cmd==='GET')result=store.get(key)||null;
   if(cmd==='DEL'){store.delete(key);result=1;}
   if(cmd==='EVAL')result=1;
   return {ok:true,json:async()=>({result})};
  }
  const method=url.split('/').at(-1);sent.push({method,payload});
  return {ok:true,json:async()=>({ok:true,result:method==='getChatMember'?{status:role}:true})};
 };
 let seq=12340;const secret=crypto.createHash('sha256').update('fake-bot|cudyapp-topic-webhook-v1').digest('hex');
 async function invoke(thread=87621,replyId='CAACAgIAAxkBAIexample_file_ID_123456789'){
  const id=++seq;const res={statusCode:200,setHeader(){},end(){}};
  await bot({method:'POST',headers:{'x-telegram-bot-api-secret-token':secret},body:{
   update_id:id,message:{message_id:id,message_thread_id:thread,text:'/cudy_media add 1',
    chat:{id:-1003834368989,type:'supergroup'},from:{id:52,is_bot:false},
    reply_to_message:{message_id:id-1,message_thread_id:thread,sticker:{file_id:replyId}}}
  }},res);assert.equal(res.statusCode,200);
 }
 try{
  await invoke();assert.equal([...store.keys()].some(k=>k.startsWith('cudy:media')),false,'members cannot add');
  role='administrator';
  await invoke(87622);assert.equal([...store.keys()].some(k=>k.startsWith('cudy:media')),false,'wrong topic cannot add');
  await invoke();assert.ok([...store.keys()].some(k=>k.startsWith('cudy:media')),'admin saves sticker');
  assert.equal(sent.filter(x=>x.method==='sendMessage').at(-1).payload.message_thread_id,87621);
  assert.equal(sent.some(x=>x.method==='sendSticker'),false,'configuration never auto sends media');
 }finally{
  global.fetch=oldFetch;
  for(const[k,v]of Object.entries(prev)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 }
});
