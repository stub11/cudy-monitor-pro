'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const handler=require('../api/webhook.js');
const targets=require('../lib/issue-reply-target.js');

test('strict issue target syntax and minimal metadata validation',()=>{
  assert.deepEqual(targets.command('/cudy_bind_issue 71'),{action:'bind_issue',issue:71});
  assert.deepEqual(targets.command('/cudy_answer_issue@Cudyapp 71'),{action:'answer_issue',issue:71});
  for(const v of ['/cudy_bind_issue 0','/cudy_answer_issue 1000000',
    '/cudy_answer_issue 71 password=foo','/cudy_bind_issue abc']) {
    assert.equal(targets.command(v),null);
  }
  assert.deepEqual(targets.parseMapping(JSON.stringify({messageId:450,testerId:77})),
    {messageId:450,testerId:77});
  assert.equal(targets.parseMapping('{"messageId":0,"testerId":77}'),null);
  assert.equal(targets.parseMapping('{"messageId":450,"testerId":77,"text":"secret"}')?.messageId,450);
  assert.equal(targets.validMessage({message_id:5,from:{id:77}},87621),true);
  assert.equal(targets.validMessage({message_id:5,from:{id:77,is_bot:true}},87621),false);
  assert.equal(targets.validMessage({message_id:5,message_thread_id:123,from:{id:77}},87621),false);
  assert.match(targets.replyText(71),/issues\/71/);
});

test('admin binds an Issue to one tester and replies to that message, not just to topic',async()=>{
  const vars=['CUDY_TELEGRAM_BOT_TOKEN','CUDY_TELEGRAM_CHAT_ID','CUDY_TELEGRAM_TOPIC_ID',
  'STORAGE_KV_REST_API_URL','STORAGE_KV_REST_API_TOKEN','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN'];
  const oldEnv=Object.fromEntries(vars.map(k=>[k,process.env[k]]));
  const oldFetch=global.fetch;
  Object.assign(process.env,{CUDY_TELEGRAM_BOT_TOKEN:'fixture',CUDY_TELEGRAM_CHAT_ID:'-1009876543210',
    CUDY_TELEGRAM_TOPIC_ID:'87621',STORAGE_KV_REST_API_URL:'https://redis.fixture.invalid',
    STORAGE_KV_REST_API_TOKEN:'fixture'});
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const store=new Map(),out=[],timers=[];
  let role='administrator',id=2000,telegramReplyFails=false;
  global.fetch=async(url,opts)=>{
    const body=JSON.parse(opts.body);
    if(url==='https://redis.fixture.invalid'){
      const [command,key,...args]=body;let result=null;
      if(command==='SET'){
        timers.push(args);
        if(args.includes('NX')&&store.has(key))result=null;
        else{store.set(key,args[0]);result='OK';}
      }else if(command==='GET')result=store.get(key)||null;
      else if(command==='DEL'){store.delete(key);result=1;}
      else if(command==='EVAL')result=1;
      return {ok:true,json:async()=>({result})};
    }
    const method=url.split('/').at(-1);
    out.push({method,body});
    if(method==='sendMessage'&&telegramReplyFails&&body.reply_parameters){
      return {ok:false,json:async()=>({ok:false})};
    }
    return {ok:true,json:async()=>({ok:true,result:method==='getChatMember'?{status:role}:true})};
  };
  const secret=crypto.createHash('sha256')
    .update('fixture|cudyapp-topic-webhook-v1').digest('hex');
  const say=async(text,options={})=>{
    const source=options.source;
    const msg={message_id:++id,message_thread_id:options.topic||87621,text,
      chat:{id:-1009876543210,type:'supergroup'},
      from:{id:options.user||55,is_bot:false}};
    if(source)msg.reply_to_message={message_id:source.messageId,
      message_thread_id:source.topic||87621,from:{id:source.user||77,is_bot:!!source.isBot}};
    const response={statusCode:200,setHeader(){},end(){}};
    await handler({method:'POST',headers:{'x-telegram-bot-api-secret-token':secret},
      body:{update_id:id,message:msg}},response);
    assert.equal(response.statusCode,200);
  };
  try {
    role='member';
    await say('/cudy_bind_issue 71',{source:{messageId:910}});
    assert.equal(store.size,1,'only update idempotency key exists for a member');
    role='administrator';
    await say('/cudy_bind_issue 71',{source:{messageId:910,topic:87622}});
    assert.equal([...store.keys()].filter(x=>x.includes('issue-target')).length,0,
      'cannot bind a message from another topic');
    await say('/cudy_bind_issue 71',{source:{messageId:910,isBot:true}});
    assert.equal([...store.keys()].filter(x=>x.includes('issue-target')).length,0,
      'cannot bind a bot message');
    await say('/cudy_bind_issue 71',{source:{messageId:910}});
    const key=targets.mappingKey(-1009876543210,87621,71);
    assert.deepEqual(JSON.parse(store.get(key)),{messageId:910,testerId:77});
    assert.ok(timers.some(v=>v.includes(String(targets.TTL))));
    const before=out.length;
    await say('/cudy_answer_issue 71');
    const sends=out.slice(before).filter(x=>x.method==='sendMessage');
    assert.equal(sends.length,1);
    assert.deepEqual(sends[0].body.reply_parameters,
      {message_id:910,allow_sending_without_reply:false});
    assert.equal(sends[0].body.message_thread_id,87621);
    assert.equal(sends[0].body.disable_notification,true);
    assert.equal(sends[0].body.reply_to_message_id,undefined);
    assert.match(sends[0].body.text,/issues\/71/);
    const delivered=out.filter(x=>x.method==='sendMessage').length;
    await say('/cudy_answer_issue 71');
    assert.equal(out.filter(x=>x.method==='sendMessage').length,delivered,
      'repeated command is deduplicated');
    await say('/cudy_answer_issue 72');
    const missing=out.at(-1);
    assert.equal(missing.method,'sendMessage');
    assert.equal(missing.body.reply_parameters,undefined,
      'missing target receives warning only to requesting admin');
    assert.equal(missing.body.reply_to_message_id,id);
    // Failed reply must not silently degrade into an unthreaded message.
    await say('/cudy_bind_issue 73',{source:{messageId:911}});
    telegramReplyFails=true;
    await say('/cudy_answer_issue 73');
    telegramReplyFails=false;
    assert.equal(out.filter(x=>x.method==='sendMessage'&&x.body.reply_parameters &&
      x.body.reply_parameters.message_id===911).length,1);
    assert.ok(!store.has('cudy:issue-reply:lock:v1:-1009876543210:87621:73:911'));
  }finally {
    global.fetch=oldFetch;
    for(const [k,v] of Object.entries(oldEnv)){
      if(v===undefined)delete process.env[k];else process.env[k]=v;
    }
  }
});
