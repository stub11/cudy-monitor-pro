'use strict';

// Index only incoming tester messages, never arbitrary chat history.
// Telegram Bot API does not offer getMessage/searchHistory. Metadata expires.
const TTL_SECONDS=7*86400;
function isTesterMessage(message, text) {
  if (!message || !Number.isSafeInteger(message.message_id) ||
      !Number.isSafeInteger(message.from?.id) || message.from.is_bot ||
      typeof text!=='string' || text.length>4000) return false;
  const reply=message.reply_to_message;
  const botPrompt=reply?.from?.is_bot===true &&
    /(?:netis\s*n6|mipsel|cudy\s*monitor)/iu.test(reply.text||reply.caption||'');
  const report=/(?:netis\s*n6|mipsel_24kc|ramips\/mt7621)/iu.test(text) &&
    /(?:openwrt|DISTRIB_|cpu|ram|wan|график|показател|температур|ota)/iu.test(text);
  return botPrompt || report;
}
function keyFor(message) {
  return 'cudy:tester:last:v1:'+message.chat.id+':'+
    message.message_thread_id+':'+message.from.id;
}
function metadata(message) {
  return JSON.stringify({
    message_id:message.message_id,
    chat_id:message.chat.id,
    topic_id:message.message_thread_id,
    user_id:message.from.id
  });
}
function isBotPromptReply(message) {
  return message.reply_to_message?.from?.is_bot===true &&
    /(?:netis\s*n6|mipsel)/iu.test(
      message.reply_to_message.text||message.reply_to_message.caption||'');
}
module.exports={TTL_SECONDS,isTesterMessage,keyFor,metadata,isBotPromptReply};
