'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const ota=require('../lib/update-followup.js');
const webhook=require('../api/webhook.js');

test('parse only whitelisted technical fields, no free text or secrets',()=>{
 assert.deepEqual(ota.partialTechnicalFields('version: 1.2.10'),{running:'1.2.10'});
 assert.deepEqual(ota.partialTechnicalFields('режим: native_apk'),{mode:'native_apk'});
 assert.deepEqual(ota.partialTechnicalFields('current: 1.2.11 latest: 1.2.11 available: false'),
 {installed:'1.2.11',latest:'1.2.11',available:false});
 assert.deepEqual(ota.partialTechnicalFields('cudy-monitor-pro 1.2.11'),{installed:'1.2.11'});
 assert.equal(ota.partialTechnicalFields('пароль=some-secret version: 1.2.11'),null);
 assert.equal(ota.partialTechnicalFields('Смотрю телевизор'),null);
 assert.equal(ota.partialTechnicalFields('https://router.local/?key=1 version: 1.2.11'),null);
 assert.equal(ota.partialTechnicalFields('/cudy_problem version: 1.2.11'),null);
 assert.match(ota.explainPartial({mode:'native_apk'}),/версия.*работающего/u);
 assert.match(ota.explainPartial({mode:'native_apk',running:'1.2.10',installed:'1.2.11',
  latest:'1.2.11',available:false}),/отличается от установленного файла/u);
});

test('after addressed question bot asks next missing datum then interprets exact tester response',async()=>{
 const envKeys=['CUDY_TELEGRAM_BOT_TOKEN','CUDY_TELEGRAM_CHAT_ID','CUDY_TELEGRAM_TOPIC_ID',
  'STORAGE_KV_REST_API_URL','STORAGE_KV_REST_API_TOKEN','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN'];
 const old=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));const originalFetch=global.fetch;
 Object.assign(process.env,{CUDY_TELEGRAM_BOT_TOKEN:'fixture',CUDY_TELEGRAM_CHAT_ID:'-1003834368989',
 CUDY_TELEGRAM_TOPIC_ID:'87621',STORAGE_KV_REST_API_URL:'https://redis.invalid',
 STORAGE_KV_REST_API_TOKEN:'fixture'});
 delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
 let seq=123450,admin=true;
 const store=new Map(),out=[];
 global.fetch=async(url,opts)=>{
  const input=JSON.parse(opts.body);
  if(url==='https://redis.invalid'){
   const [cmd,key,...args]=input;let result=null;
   if(cmd==='GET')result=store.get(key)||null;
   if(cmd==='SET'){if(args.includes('NX')&&store.has(key))result=null;
     else{store.set(key,args[0]);result='OK';}}
   if(cmd==='DEL'){store.delete(key);result=1;}
   if(cmd==='EVAL')result=1;
   return {ok:true,json:async()=>({result})};
  }
  const method=url.split('/').at(-1);
  out.push({method,input});
  return {ok:true,json:async()=>({ok:true,result:method==='getChatMember'?{status:admin?'administrator':'member'}:{message_id:out.length+100}})};
 };
 const secret=crypto.createHash('sha256').update('fixture|cudyapp-topic-webhook-v1').digest('hex');
 async function say(text,user=77,topic=87621,reply=null){
  const id=++seq, res={statusCode:200,setHeader(){},end(){}};
  const message={message_id:id,message_thread_id:topic,text,from:{id:user,is_bot:false},
    chat:{id:-1003834368989,type:'supergroup'}};
  if(reply)message.reply_to_message={message_id:reply,message_thread_id:topic,
    from:{id:77,is_bot:false},text:'Обновление не работает'};
  await webhook({method:'POST',headers:{'x-telegram-bot-api-secret-token':secret},
    body:{update_id:id,message}},res);
  assert.equal(res.statusCode,200);
 }
 try {
  await say('/cudy_ask_update',55,87621,8888);
  const send=()=>out.filter(x=>x.method==='sendMessage').map(x=>x.input);
  assert.equal(send().length,1);
  assert.equal(send()[0].reply_to_message_id,8888);
  await say('version: 1.2.10',56); // different member must not be assigned session
  assert.equal(send().length,1);
  await say('update_mode: native_apk',77);
  assert.match(send().at(-1).text,/версия.*работающего/u);
  await say('version: 1.2.10',77);
  assert.match(send().at(-1).text,/установленного файла/u);
  await say('cudy-monitor-pro 1.2.11',77);
  assert.match(send().at(-1).text,/latest/u);
  await say('latest: 1.2.11',77);
  assert.match(send().at(-1).text,/available/u);
  await say('available: false',77);
  assert.match(send().at(-1).text,/отличается от установленного файла/u);
  assert.equal(send().at(-1).reply_to_message_id,seq);
  assert.equal(send().at(-1).message_thread_id,87621);
  assert.equal([...store.values()].some(x=>typeof x==='string'&&x.includes('Обновление не работает')),false);
  const count=send().length;
  await say('latest: 1.2.11',99,87622);
  assert.equal(send().length,count,'another topic must remain untouched');
  await say('пароль=demo version: 1.2.10',77);
  assert.equal(send().length,count,'messages with possible secrets are not handled');
 } finally {
  global.fetch=originalFetch;
  for(const [key,value]of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});
