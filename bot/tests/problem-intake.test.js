'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const intake=require('../lib/problem-intake.js');
test('guided diagnostic accepts only predefined technical values',()=>{
 assert.equal(intake.startsProblem('У меня панель не открывается'),true);
 assert.equal(intake.startsProblem('/cudy_problem'),true);
 assert.equal(intake.startsProblem('просто привет'),false);
 assert.equal(intake.option('/cudy_platform keenetic','platform'),'keenetic');
 assert.equal(intake.option('/cudy_symptom panel','symptom'),'panel');
 assert.equal(intake.option('/cudy_tried docs','tried'),'docs');
 for(const secret of ['root','123456','192.168.1.1','https://bad.test/','telegram_id']) {
   assert.equal(intake.option('/cudy_platform '+secret,'platform'),null);
 }
 assert.equal(intake.nextStep({platform:'openwrt'}),'symptom');
 assert.equal(intake.nextStep({platform:'openwrt',symptom:'panel',tried:'docs'}),null);
});
test('public issue is enum-only: no identities, IPs, or free-form messages',()=>{
 const state={platform:'openwrt',symptom:'panel',tried:'docs',
  username:'secret-user',chat_id:-100123,ip:'1.2.3.4',text:'private customer message'};
 const report=intake.buildIssue(state);
 assert.ok(report);
 const payload=JSON.stringify(report);
 for(const fragment of ['secret-user','100123','1.2.3.4','private customer message']){
  assert.equal(payload.includes(fragment),false,fragment);
 }
 assert.equal(intake.buildIssue({platform:'openwrt',symptom:'private',tried:'docs'}),null);
 assert.match(intake.prompt('platform'),/согласия/u);
 assert.match(intake.summarize(state),/публичн/u);
});
test('no unauthorized report or reply outside CM Aurora topic',async()=>{
 const crypto=require('node:crypto');
 const webhook=require('../api/webhook.js');
 const keys=['CUDY_TELEGRAM_BOT_TOKEN','CUDY_TELEGRAM_CHAT_ID','CUDY_TELEGRAM_TOPIC_ID',
  'STORAGE_KV_REST_API_URL','STORAGE_KV_REST_API_TOKEN','CUDY_GITHUB_ISSUE_TOKEN','CUDY_ISSUE_REPORTS_ENABLED'];
 const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 const beforeFetch=global.fetch;
 process.env.CUDY_TELEGRAM_BOT_TOKEN='fixture';
 process.env.CUDY_TELEGRAM_CHAT_ID='-1003834368989';
 process.env.CUDY_TELEGRAM_TOPIC_ID='87621';
 process.env.STORAGE_KV_REST_API_URL='https://redis.test.invalid';
 process.env.STORAGE_KV_REST_API_TOKEN='not-real';
 delete process.env.CUDY_GITHUB_ISSUE_TOKEN;
 delete process.env.CUDY_ISSUE_REPORTS_ENABLED;
 const secret=crypto.createHash('sha256').update('fixture|cudyapp-topic-webhook-v1').digest('hex');
 const records=new Map(),calls=[];
 global.fetch=async(url,options)=>{
   const payload=JSON.parse(options.body);
   if(url==='https://redis.test.invalid'){
     let result=null;const [cmd,key,...args]=payload;
     if(cmd==='GET')result=records.get(key)??null;
     else if(cmd==='SET'){records.set(key,args[0]);result='OK';}
     else if(cmd==='DEL'){records.delete(key);result=1;}
     return {ok:true,json:async()=>({result})};
   }
   calls.push({url,payload});
   return {ok:true,json:async()=>({ok:true,result:true})};
 };
 let idx=100;
 const run=async(text,thread=87621)=>{
  const res={statusCode:200,setHeader(){},end(){}};
  await webhook({method:'POST',headers:{'x-telegram-bot-api-secret-token':secret},body:{
    update_id:++idx,message:{message_id:idx,message_thread_id:thread,text,
      chat:{id:-1003834368989,type:'supergroup'},from:{id:99,is_bot:false}}
  }},res);
  return res.statusCode;
 };
 try {
   await run('/cudy_problem',87622);
   assert.equal(calls.length,0);
   await run('/cudy_problem');
   await run('/cudy_platform openwrt');
   await run('/cudy_symptom panel');
   await run('/cudy_tried docs');
   await run('/cudy_report');
   assert.equal(calls.some(c=>c.url.includes('api.github.com')),false,'no public posting without credentials');
   assert.ok(calls.some(c=>c.url.includes('sendMessage')),'helpful questions sent');
   assert.ok(calls.every(c=>!JSON.stringify(c.payload).includes('not-real')),'no secrets in public messages');
 }finally{
   global.fetch=beforeFetch;
   for(const[k,v]of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 }
});
