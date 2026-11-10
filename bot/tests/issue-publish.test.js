'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const handler=require('../api/webhook.js');

test('only explicit report consent sends strictly sanitized issue, successful reports dedupe',async()=>{
 const names=['CUDY_TELEGRAM_BOT_TOKEN','CUDY_TELEGRAM_CHAT_ID','CUDY_TELEGRAM_TOPIC_ID',
  'STORAGE_KV_REST_API_URL','STORAGE_KV_REST_API_TOKEN',
  'UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN',
  'CUDY_ISSUE_REPORTS_ENABLED','CUDY_GITHUB_ISSUE_TOKEN'];
 const prior=Object.fromEntries(names.map(k=>[k,process.env[k]]));
 const originalFetch=global.fetch;
 Object.assign(process.env,{
  CUDY_TELEGRAM_BOT_TOKEN:'fixture',
  CUDY_TELEGRAM_CHAT_ID:'-1003834368989',
  CUDY_TELEGRAM_TOPIC_ID:'87621',
  STORAGE_KV_REST_API_URL:'https://redis.test.invalid',
  STORAGE_KV_REST_API_TOKEN:'redis-fixture',
  CUDY_ISSUE_REPORTS_ENABLED:'true',
  CUDY_GITHUB_ISSUE_TOKEN:'issue-only-fixture'
 });
 delete process.env.UPSTASH_REDIS_REST_URL;
 delete process.env.UPSTASH_REDIS_REST_TOKEN;
 const keys=new Map(), github=[];
 let failOnce=true;
 global.fetch=async(url,opts)=>{
  const payload=JSON.parse(opts.body);
  if(url==='https://redis.test.invalid'){
   const [cmd,key,...args]=payload;
   let result=null;
   if(cmd==='GET')result=keys.get(key)||null;
   if(cmd==='SET'){
    if(args.includes('NX')&&keys.has(key))result=null;
    else {keys.set(key,args[0]);result='OK';}
   }
   if(cmd==='DEL'){keys.delete(key);result=1;}
   return {ok:true,json:async()=>({result})};
  }
  if(url==='https://api.github.com/repos/stub11/cudy-monitor-pro/issues'){
   github.push({headers:opts.headers,body:payload});
   if(failOnce){failOnce=false;return {status:403};}
   return {status:201};
  }
  return {ok:true,json:async()=>({ok:true,result:true})};
 };
 const secret=crypto.createHash('sha256').update('fixture|cudyapp-topic-webhook-v1').digest('hex');
 let seq=10000;
 const invoke=async(message,uid=22)=>{
  const id=++seq, response={statusCode:200,setHeader(){},end(){}};
  await handler({method:'POST',headers:{'x-telegram-bot-api-secret-token':secret},
   body:{update_id:id,message:{message_id:id,message_thread_id:87621,text:message,
   chat:{id:-1003834368989,type:'supergroup'},from:{id:uid,is_bot:false}}}},response);
  assert.equal(response.statusCode,200);
 };
 try{
  const start='/cudy_problem', seqCommands=[
   '/cudy_platform openwrt','/cudy_symptom panel','/cudy_tried docs'];
  await invoke(start);for(const x of seqCommands)await invoke(x);
  assert.equal(github.length,0,'gathering details must not publish');
  await invoke('/cudy_report');
  assert.equal(github.length,1,'explicit consent triggers first attempt');
  assert.equal([...keys.keys()].some(k=>k.startsWith('cudy:issue-report:lock')),false,'lock cleared after failed submission');
  await invoke('/cudy_report');
  assert.equal(github.length,2,'failed publication may be retried');
  assert.equal(github[1].headers.authorization,'Bearer issue-only-fixture');
  assert.deepEqual(Object.keys(github[1].body).sort(),['body','title']);
  assert.equal(github[1].body.title,'[Cudyapp report] Панель не открывается — OpenWrt ARM64');
  for(const v of ['issue-only-fixture','redis-fixture','1003834368989','22','192.168.','telegram.com']) {
    assert.equal(JSON.stringify(github[1].body).includes(v),false,'public issue must omit '+v);
  }
  await invoke(start,23);for(const x of seqCommands)await invoke(x,23);
  await invoke('/cudy_report',23);
  assert.equal(github.length,2,'successful duplicate coalesced within 24 hours');
 }finally{
  global.fetch=originalFetch;
  for(const[k,v]of Object.entries(prior)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 }
});
