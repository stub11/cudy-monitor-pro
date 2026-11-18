'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const index=require('../lib/tester-message-index.js');
const n6=require('../lib/netis-n6-followup.js');

const base={message_id:1234,chat:{id:-1003834368989},message_thread_id:87621,
 from:{id:123,is_bot:false}};
const report=[
 "Netis N6 OpenWrt",
 "DISTRIB_RELEASE='25.12.6'",
 "DISTRIB_TARGET='ramips/mt7621'",
 "DISTRIB_ARCH='mipsel_24kc'",
 "2. Вроде бы правдоподобно",
 "3. Обновляются",
 "4. Температура процессора, OTA обновления"
].join('\n');
test('index only relevant incoming tester reports and no message contents',()=>{
 assert.equal(index.isTesterMessage(base,report),true);
 assert.equal(index.isTesterMessage(base,'Привет всем!'),false);
 assert.equal(index.isTesterMessage({...base,from:{id:123,is_bot:true}},report),false);
 assert.equal(index.isTesterMessage({...base,message_id:null},report),false);
 assert.equal(index.TTL_SECONDS,604800);
 assert.match(index.keyFor(base),/123$/);
 const data=JSON.parse(index.metadata(base));
 assert.deepEqual(data,{message_id:1234,chat_id:-1003834368989,topic_id:87621,user_id:123});
 assert.equal(index.metadata(base).includes('Netis N6'),false);
});
test('recognize tester replying to original bot prompt without assuming a user ID',()=>{
 const reply={...base,reply_to_message:{message_id:1100,from:{is_bot:true},
   text:'🦊 Netis N6 / OpenWrt MIPSEL — просьба к первому тестеру'}};
 assert.equal(index.isTesterMessage(reply,report.replace('Netis N6 OpenWrt','')),true);
 assert.equal(index.isBotPromptReply(reply),true);
 assert.equal(index.isBotPromptReply({...reply,reply_to_message:{message_id:1100,
   from:{is_bot:false},text:'Netis N6'}}),false);
 assert.ok(n6.combinedTesterReport(report));
 assert.match(n6.combinedReportReply(n6.combinedTesterReport(report)),/OTA/);
});
