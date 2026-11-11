'use strict';

// Opaque mapping between a GitHub Issue number and one Telegram message.
// No message text, usernames, tokens or IP addresses are persisted.
const COMMAND = /^\/cudy_(bind_issue|answer_issue)(?:@cudyapp)?\s+([1-9][0-9]{0,5})\s*$/iu;
const MAX_ISSUE=999999;
const TTL=30*86400;

function command(text){
  if(typeof text!=='string')return null;
  const matched=COMMAND.exec(text);
  if(!matched)return null;
  const issue=Number(matched[2]);
  return Number.isSafeInteger(issue)&&issue>0&&issue<=MAX_ISSUE
    ?{action:matched[1].toLowerCase(),issue}:null;
}
function validMessage(original,topic){
  return !!original && Number.isSafeInteger(original.message_id)
    && original.message_id>0 && !original.from?.is_bot
    && Number.isSafeInteger(original.from?.id) && original.from.id>0
    && (original.message_thread_id==null || Number(original.message_thread_id)===Number(topic));
}
function mappingKey(chatId,topicId,issue){
  return 'cudy:issue-target:v1:'+chatId+':'+topicId+':'+issue;
}
function parseMapping(raw){
  if(typeof raw!=='string'||raw.length>150)return null;
  let item;
  try {item=JSON.parse(raw);}catch{return null;}
  if(!item||!Number.isSafeInteger(item.messageId)||item.messageId<1||
     !Number.isSafeInteger(item.testerId)||item.testerId<1)return null;
  return {messageId:item.messageId,testerId:item.testerId};
}
function replyText(issue){
  return '🛠 Ответ по Cudy Monitor Pro, GitHub Issue #'+issue+'\n\n'
    +'Чтобы проверить ошибку обновления, пришлите только четыре значения:\n'
    +'1) Версия файла: /usr/bin/cudy-monitor-pro --version\n'
    +'2) Версия работающего монитора в панели\n'
    +'3) HTTP-код запроса GitHub releases\n'
    +'4) HTTP-код запроса релиза нужной версии\n\n'
    +'Пока не повторяйте установку. Не присылайте пароли, токены и полные журналы.\n'
    +'Подробности: https://github.com/stub11/cudy-monitor-pro/issues/'+issue;
}
module.exports={command,validMessage,mappingKey,parseMapping,replyText,TTL};
