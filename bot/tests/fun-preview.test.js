'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const handler=require('../api/webhook.js');
test('fun command stays admin-only and topic-only',async()=>{
 const keys=['CUDY_TELEGRAM_BOT_TOKEN','CUDY_TELEGRAM_CHAT_ID','CUDY_TELEGRAM_TOPIC_ID','STORAGE_KV_REST_API_URL','STORAGE_KV_REST_API_TOKEN'];
 const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]])); const orig=global.fetch;
 process.env.CUDY_TELEGRAM_BOT_TOKEN='fixture';
 process.env.CUDY_TELEGRAM_CHAT_ID='-1003834368989';
 process.env.CUDY_TELEGRAM_TOPIC_ID='87621';
 process.env.STORAGE_KV_REST_API_URL='https://redis.test.invalid';
 process.env.STORAGE_KV_REST_API_TOKEN='fake';
 const secret=crypto.createHash('sha256').update('fixture|cudyapp-topic-webhook-v1').digest('hex');
 let role='member'; const sent=[];
 global.fetch=async(url,o)=>{
  if(url.includes('redis.test.invalid'))return {ok:true,json:async()=>({result:'OK'})};
  const method=url.split('/').at(-1);sent.push(method);
  return {ok:true,json:async()=>({ok:true,result:method==='getChatMember'?{status:role}:true})};
 };
 const run=async(topic)=>{const res={statusCode:200,setHeader(){},end(){}};
 await handler({method:'POST',headers:{'x-telegram-bot-api-secret-token':secret},body:{
 update_id:501,message:{message_id:42,message_thread_id:topic,text:'/cudy_fun',
 from:{id:7,is_bot:false},chat:{id:-1003834368989,type:'supergroup'}}
 }},res);return res.statusCode;};
 try{
  assert.equal(await run(87621),200);assert.equal(sent.includes('sendMessage'),false);
  sent.length=0;role='administrator';
  await run(87622);assert.equal(sent.length,0);
  await run(87621);assert.equal(sent.includes('sendMessage'),true);
 }finally{global.fetch=orig;for(const[k,v]of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});