'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const intake=require('../lib/problem-intake.js');
const webhook=require('../api/webhook.js');
test('description redacts technical identifiers, credentials and prevents markdown link injection',()=>{
 const raw='После запуска страница пуста. IP 192.168.1.1, email admin'+'@'+'example.com; пароль=superSecret123; url https://test.invalid/path; token=abcdefG123456789; путь C:\\Users\\Test\\secret.txt @exampleuser';
 const cleaned=intake.scrubDescription(raw);
 for(const privateValue of ['192.168.1.1','admin'+'@'+'example.com','superSecret123','test.invalid','abcdefG123456789','C:\\Users','@exampleuser']) assert.equal(cleaned.includes(privateValue),false,privateValue);
 assert.ok(cleaned.includes('страница пуста'));
 assert.equal(intake.scrubDescription('short'),null);
 assert.equal(intake.scrubDescription('x'.repeat(1501)),null);
 const report=intake.buildIssue({platform:'openwrt',symptom:'panel',tried:'docs',description:raw});
 assert.ok(report.body.includes('Описание участника'));
 assert.equal(report.body.includes('superSecret123'),false);
});
test('explicit description requires review and separate final publishing click',async()=>{
 const keys=['CUDY_TELEGRAM_BOT_TOKEN','CUDY_TELEGRAM_CHAT_ID','CUDY_TELEGRAM_TOPIC_ID',
  'STORAGE_KV_REST_API_URL','STORAGE_KV_REST_API_TOKEN','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN',
  'CUDY_ISSUE_REPORTS_ENABLED','CUDY_GITHUB_ISSUE_TOKEN'];
 const before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 const oldFetch=global.fetch;
 Object.assign(process.env,{CUDY_TELEGRAM_BOT_TOKEN:'fixture',
  CUDY_TELEGRAM_CHAT_ID:'-1003834368989',CUDY_TELEGRAM_TOPIC_ID:'87621',
  STORAGE_KV_REST_API_URL:'https://redis.invalid',STORAGE_KV_REST_API_TOKEN:'fixture',
  CUDY_ISSUE_REPORTS_ENABLED:'true',CUDY_GITHUB_ISSUE_TOKEN:'fixture'});
 delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
 let i=900,issued=[],telegram=[]; const redis=new Map();
 global.fetch=async(url,options)=>{
  const body=JSON.parse(options.body);
  if(url==='https://redis.invalid'){
   const [action,key,...args]=body;let result=null;
   if(action==='GET')result=redis.get(key)||null;
   if(action==='SET'){redis.set(key,args[0]);result='OK';}
   if(action==='DEL'){redis.delete(key);result=1;}
   return {ok:true,json:async()=>({result})};
  }
  if(url.includes('api.github.com')){issued.push(body);return {status:201};}
  telegram.push({url,body});return {ok:true,json:async()=>({ok:true,result:true})};
 };
 const secret=crypto.createHash('sha256').update('fixture|cudyapp-topic-webhook-v1').digest('hex');
 async function say(text){let response={statusCode:200,setHeader(){},end(){}};
  await webhook({method:'POST',headers:{'x-telegram-bot-api-secret-token':secret},
   body:{update_id:++i,message:{message_id:i,message_thread_id:87621,text,
   from:{id:71,is_bot:false},chat:{id:-1003834368989,type:'supergroup'}}}},response);
  assert.equal(response.statusCode,200);
 }
 try{
  await say('/cudy_problem');
  for(const v of ['/cudy_platform openwrt','/cudy_symptom network','/cudy_tried docs'])await say(v);
  await say('/cudy_describe После обновления график пропал, соединение работает. IP=192.168.1.1');
  assert.ok(telegram.some(x=>x.body.text?.includes('Финальная') || x.body.text?.includes('Проверьте текст')));
  assert.equal(issued.length,0);
  await say('/cudy_report');
  assert.equal(issued.length,0);
  await say('/cudy_report');
  assert.equal(issued.length,1);
  assert.equal(issued[0].body.includes('192.168.1.1'),false);
  assert.equal(issued[0].body.includes('график пропал'),true);
 }finally{
  global.fetch=oldFetch;
  for(const [k,v]of Object.entries(before)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 }
});
