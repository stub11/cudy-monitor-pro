'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const webhook=require('../api/webhook.js');
test('inline diagnostic buttons are limited to validated options and the target topic',()=>{
 const fn=webhook._test.diagnosticKeyboard;
 assert.deepEqual(fn('platform').inline_keyboard[0][0],{text:'🟢 OpenWrt',callback_data:'cd:platform:openwrt'});
 assert.equal(fn('symptom').inline_keyboard.length,6);
 assert.equal(fn('tried').inline_keyboard.length,5);
 assert.equal(fn(null,true).inline_keyboard[0][0].callback_data,'cd:describe:yes');
 assert.equal(fn(null,true).inline_keyboard[1][0].callback_data,'cd:report:yes');
 assert.equal(fn('unknown'),undefined);
});
test('callback selections require existing per-user session and never publish issues',async()=>{
 const names=['CUDY_TELEGRAM_BOT_TOKEN','CUDY_TELEGRAM_CHAT_ID','CUDY_TELEGRAM_TOPIC_ID',
 'STORAGE_KV_REST_API_URL','STORAGE_KV_REST_API_TOKEN',
 'CUDY_ISSUE_REPORTS_ENABLED','CUDY_GITHUB_ISSUE_TOKEN',
 'UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN'];
 const previous=Object.fromEntries(names.map(k=>[k,process.env[k]])),oldFetch=global.fetch;
 process.env.CUDY_TELEGRAM_BOT_TOKEN='fixture';
 process.env.CUDY_TELEGRAM_CHAT_ID='-1003834368989';
 process.env.CUDY_TELEGRAM_TOPIC_ID='87621';
 process.env.STORAGE_KV_REST_API_URL='https://redis.invalid';
 process.env.STORAGE_KV_REST_API_TOKEN='not-a-real-token';
 delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
 delete process.env.CUDY_GITHUB_ISSUE_TOKEN;delete process.env.CUDY_ISSUE_REPORTS_ENABLED;
 const seen=[],store=new Map();
 global.fetch=async(url,o)=>{
   const data=JSON.parse(o.body);
   if(url==='https://redis.invalid'){
     const [cmd,key,...args]=data;let result=null;
     if(cmd==='GET')result=store.get(key)??null;
     if(cmd==='SET'){store.set(key,args[0]);result='OK';}
     if(cmd==='DEL'){store.delete(key);result=1;}
     return {ok:true,json:async()=>({result})};
   }
   seen.push({method:url.split('/').at(-1),data});
   return {ok:true,json:async()=>({ok:true,result:true})};
 };
 let updateId=2000;
 const key=crypto.createHash('sha256').update('fixture|cudyapp-topic-webhook-v1').digest('hex');
 async function invoke(body){
  const response={statusCode:200,setHeader(){},end(){}};
  await webhook({method:'POST',headers:{'x-telegram-bot-api-secret-token':key},
   body:{update_id:++updateId,...body}},response);
  assert.equal(response.statusCode,200);
 }
 const callback=(data,thread=87621,uid=8)=>({callback_query:{
  id:'cb'+(++updateId),data,from:{id:uid,is_bot:false},
  message:{message_id:501,message_thread_id:thread,chat:{id:-1003834368989,type:'supergroup'}}
 }});
 const msg=text=>({message:{message_id:++updateId,text,message_thread_id:87621,
  from:{id:8,is_bot:false},chat:{id:-1003834368989,type:'supergroup'}}});
 try{
  await invoke(callback('cd:platform:keenetic')); // inactive session
  assert.equal(seen.filter(v=>v.method==='sendMessage').length,0);
  await invoke(msg('/cudy_problem'));
  assert.ok(seen.find(v=>v.method==='sendMessage')?.data.reply_markup?.inline_keyboard);
  await invoke(callback('cd:platform:keenetic',87622));
  assert.equal(seen.filter(v=>v.method==='sendMessage').length,1,'other topics excluded');
  await invoke(callback('cd:platform:keenetic',87621,9));
  assert.equal(seen.filter(v=>v.method==='sendMessage').length,1,'other user has no session');
  await invoke(callback('cd:platform:keenetic'));
  await invoke(callback('cd:symptom:panel'));
  await invoke(callback('cd:tried:docs'));
  const messages=seen.filter(v=>v.method==='sendMessage');
  assert.equal(messages.length,4);
  assert.match(messages.at(-1).data.text,/параметры и|обезличенн|технических параметра/u);
  assert.equal(messages.at(-1).data.reply_markup.inline_keyboard[1][0].callback_data,'cd:report:yes');
  await invoke(callback('cd:report:yes'));
  assert.equal(seen.some(v=>v.method==='issues'),false);
  assert.equal(seen.some(v=>v.method==='sendMessage'&&/отправка в GitHub пока не настроена/u.test(v.data.text)),true);
  assert.equal(seen.filter(v=>v.method==='answerCallbackQuery').length>=5,true);
 } finally {
  global.fetch=oldFetch;
  for(const[k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 }
});