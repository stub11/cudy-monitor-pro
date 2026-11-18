'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const handler=require('../api/webhook.js');
const n6=require('../lib/netis-n6-followup.js');

test('match only explicit real Netis N6 monitor test reports',()=>{
  assert.equal(n6.isVolunteerReport('Netis N6 OpenWrt mipsel монитор показывает графики и RAM'),true);
  assert.equal(n6.isVolunteerReport('На N6 OpenWrt cudy monitor запустил, тестирую показатели'),true);
  assert.equal(n6.isVolunteerReport('Netis N6 продаётся в магазине'),false);
  assert.equal(n6.isVolunteerReport('OpenWrt mipsel роутер'),false);
  assert.equal(n6.isVolunteerReport('/cudy_ask_n6'),false);
  assert.equal(n6.isAdminCommand('/cudy_ask_n6@Cudyapp'),true);
  assert.equal(n6.isAdminCommand('/cudy_ask_n6 94831'),false);
  assert.equal(n6.validTarget({message_id:101,from:{id:99,is_bot:false}},87621),true);
  assert.equal(n6.validTarget({message_id:101,from:{id:99,is_bot:true}},87621),false);
  assert.equal(n6.validTarget({message_id:101,from:{id:99},message_thread_id:87622},87621),false);
});

test('manual command replies exactly to tester, auto to new tester report, never to bot',async()=>{
  const vars=['CUDY_TELEGRAM_BOT_TOKEN','CUDY_TELEGRAM_CHAT_ID','CUDY_TELEGRAM_TOPIC_ID',
    'STORAGE_KV_REST_API_URL','STORAGE_KV_REST_API_TOKEN','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN'];
  const saved=Object.fromEntries(vars.map(x=>[x,process.env[x]]));
  const oldFetch=global.fetch;
  Object.assign(process.env,{CUDY_TELEGRAM_BOT_TOKEN:'fixture',
    CUDY_TELEGRAM_CHAT_ID:'-1003834368989',CUDY_TELEGRAM_TOPIC_ID:'87621',
    STORAGE_KV_REST_API_URL:'https://redis.example.invalid',
    STORAGE_KV_REST_API_TOKEN:'fixture'});
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const store=new Map(),sent=[];let role='administrator',update=30000;
  global.fetch=async(url,opts)=>{
    if(url==='https://redis.example.invalid'){
      const [cmd,key,...args]=JSON.parse(opts.body);
      let result=null;
      if(cmd==='SET'){
        if(args.includes('NX')&&store.has(key))result=null;
        else{store.set(key,args[0]);result='OK';}
      }else if(cmd==='GET')result=store.get(key)||null;
      else if(cmd==='DEL'){store.delete(key);result=1;}
      else if(cmd==='EVAL')result=1;
      return {ok:true,json:async()=>({result})};
    }
    const method=url.split('/').at(-1),body=JSON.parse(opts.body);
    sent.push({method,body});
    return {ok:true,json:async()=>({ok:true,
      result:method==='getChatMember'?{status:role}:
        method==='sendMessage'?{message_id:80000,message_thread_id:87621}:true})};
  };
  const secret=crypto.createHash('sha256').update('fixture|cudyapp-topic-webhook-v1').digest('hex');
  const send=async(text,options={})=>{
    const id=++update;
    const msg={chat:{type:'supergroup',id:-1003834368989},message_id:id,
      message_thread_id:87621,from:{id:options.from||55,is_bot:false},text};
    if(options.reply){
      msg.reply_to_message={message_id:options.reply,message_thread_id:options.topic||87621,
        from:{id:options.targetId||77,is_bot:!!options.isBot}};
    }
    const res={statusCode:200,setHeader(){},end(){}};
    await handler({method:'POST',headers:{'x-telegram-bot-api-secret-token':secret},
      body:{update_id:id,message:msg}},res);
    assert.equal(res.statusCode,200);
    return id;
  };
  try {
    await send('/cudy_ask_n6',{reply:96253,isBot:true});
    assert.ok(sent.some(x=>x.method==='sendMessage'&&x.body.reply_to_message_id===update));
    assert.equal(sent.filter(x=>x.body?.reply_parameters).length,0,
      'no follow-up sent to bot document');
    await send('/cudy_ask_n6',{reply:95123});
    const direct=sent.filter(x=>x.method==='sendMessage'&&x.body.reply_parameters);
    assert.equal(direct.length,1);
    assert.deepEqual(direct[0].body.reply_parameters,
      {message_id:95123,allow_sending_without_reply:false});
    assert.equal(direct[0].body.message_thread_id,87621);
    await send('/cudy_ask_n6',{reply:95123});
    assert.equal(sent.filter(x=>x.body?.reply_parameters).length,1,
      'same message follow-up is deduplicated');
    role='member';
    await send('/cudy_ask_n6',{reply:95124});
    assert.equal(sent.filter(x=>x.body?.reply_parameters).length,1,
      'non-admin cannot target strangers');
    const msg=await send('Netis N6 OpenWrt mipsel тестировал монитор, работают CPU RAM WAN');
    const follow=sent.filter(x=>x.body?.reply_parameters);
    assert.equal(follow.length,2);
    assert.equal(follow.at(-1).body.reply_parameters.message_id,msg);
    const before=follow.length;
    await send('У Netis N6 вроде OpenWrt стоит');
    assert.equal(sent.filter(x=>x.body?.reply_parameters).length,before);
  }finally{
    global.fetch=oldFetch;
    for(const [k,v] of Object.entries(saved)){
      if(v===undefined)delete process.env[k];else process.env[k]=v;
    }
  }
});
