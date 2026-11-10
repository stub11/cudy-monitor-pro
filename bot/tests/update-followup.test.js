'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const handler=require('../api/webhook.js');
const followup=require('../lib/update-followup.js');

test('classify only reports of failed updates, never ordinary conversation',()=>{
 assert.equal(followup.looksLikeOtaProblem('Кнопка обновить не активна'),true);
 assert.equal(followup.looksLikeOtaProblem('Версия не меняется уже минут 5'),true);
 assert.equal(followup.looksLikeOtaProblem('Монитор после обновления не работает'),true);
 assert.equal(followup.looksLikeOtaProblem('Сделал обновление, всё работает отлично'),false);
 assert.equal(followup.looksLikeOtaProblem('Привет, как интернет?'),false);
 assert.match(followup.QUESTION,/\/usr\/bin\/cudy-monitor-pro --version/);
 for(const k of ['IP','пароли','токены','/api/update/check']) assert.ok(followup.QUESTION.includes(k));
});

test('admin directs followup only to replied tester message, never other topics, cooldown for repeated requests',async()=>{
 const keys=['CUDY_TELEGRAM_BOT_TOKEN','CUDY_TELEGRAM_CHAT_ID','CUDY_TELEGRAM_TOPIC_ID',
  'STORAGE_KV_REST_API_URL','STORAGE_KV_REST_API_TOKEN','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN'];
 const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));const previousFetch=global.fetch;
 Object.assign(process.env,{CUDY_TELEGRAM_BOT_TOKEN:'fixture',CUDY_TELEGRAM_CHAT_ID:'-1003834368989',
 CUDY_TELEGRAM_TOPIC_ID:'87621',STORAGE_KV_REST_API_URL:'https://redis.fixture.invalid',
 STORAGE_KV_REST_API_TOKEN:'fixture'});
 delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
 const stored=new Map(),out=[];let role='member',serial=86000;
 global.fetch=async(url,opts)=>{
  const data=JSON.parse(opts.body);
  if(url==='https://redis.fixture.invalid'){
   const [cmd,key,...args]=data;let result=null;
   if(cmd==='SET'){
    if(args.includes('NX')&&stored.has(key))result=null;
    else{stored.set(key,args[0]);result='OK';}
   }else if(cmd==='GET')result=stored.get(key)||null;
   else if(cmd==='DEL'){stored.delete(key);result=1;}
   else if(cmd==='EVAL')result=1;
   return {ok:true,json:async()=>({result})};
  }
  const method=url.split('/').at(-1);
  out.push({method,data});
  return {ok:true,json:async()=>({ok:true,result:method==='getChatMember'?{status:role}:true})};
 };
 const secret=crypto.createHash('sha256').update('fixture|cudyapp-topic-webhook-v1').digest('hex');
 async function say(text,options={}){
  const id=++serial;
  const msg={message_id:id,message_thread_id:options.topic||87621,text,
    chat:{id:options.chat||-1003834368989,type:'supergroup'},
    from:{id:options.user||12,is_bot:false}};
  if(options.replyTo)msg.reply_to_message={
   message_id:options.replyTo,message_thread_id:options.originalTopic||87621,
   from:{id:77,is_bot:false},text:'Кнопка обновить не активна'
  };
  const response={statusCode:200,setHeader(){},end(){}};
  await handler({method:'POST',headers:{'x-telegram-bot-api-secret-token':secret},
    body:{update_id:id,message:msg}},response);
  assert.equal(response.statusCode,200);
 }
 try{
  await say('/cudy_ask_update',{replyTo:43210});
  assert.equal(out.some(x=>x.method==='sendMessage'),false,'ordinary members cannot target another tester');
  role='administrator';
  await say('/cudy_ask_update',{replyTo:43210,topic:87622,originalTopic:87622});
  assert.equal(out.some(x=>x.method==='sendMessage'),false,'other topics must remain untouched');
  await say('/cudy_ask_update',{replyTo:43210});
  const sent=out.filter(x=>x.method==='sendMessage');
  assert.equal(sent.length,1);
  assert.equal(sent[0].data.reply_to_message_id,43210,'exact tester message gets the reply');
  assert.equal(sent[0].data.message_thread_id,87621);
  assert.equal(sent[0].data.disable_notification,true);
  assert.ok(!sent[0].data.text.includes('192.168.'),'bot does not request private IP');
  await say('/cudy_ask_update',{replyTo:43210});
  assert.equal(out.filter(x=>x.method==='sendMessage').length,1,'dedupe repeated admin prompts');
  await say('Кнопка обновить не активна',{user:55});
  assert.equal(out.filter(x=>x.method==='sendMessage').length,2,'auto asks new genuine tester');
  const auto=out.filter(x=>x.method==='sendMessage')[1];
  assert.equal(auto.data.reply_to_message_id,serial);
  await say('Версия не меняется уже минут 5',{user:55});
  assert.equal(out.filter(x=>x.method==='sendMessage').length,2,'auto same user limited to once a week');
 }finally{
  global.fetch=previousFetch;
  for(const [k,v] of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 }
});
