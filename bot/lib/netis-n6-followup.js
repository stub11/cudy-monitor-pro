'use strict';

// A question must have a specific real tester message as its Telegram reply
// target. Never answer to a forum root or a bot document as a substitute.
const ADMIN_COMMAND = /^\/cudy_ask_n6(?:@Cudyapp)?\s*$/iu;
const NETIS = /\b(?:netis[\s-]*n6|n6)\b/iu;
const OPENWRT = /(?:openwrt|open[\s-]?wrt|оврт|опенврт)/iu;
const MIPSEL = /(?:mipsel|mips|mt7621|mipsel_24kc)/iu;
const MONITOR = /(?:cudy\s*monitor|монитор|показател|график|метрик|тестир|запустил|работает|не\s*работает)/iu;

function isAdminCommand(text){
  return typeof text==='string' && ADMIN_COMMAND.test(text.trim());
}
function validTarget(source, topic) {
  return !!source && Number.isSafeInteger(source.message_id) &&
    source.message_id>0 && source.from?.is_bot!==true &&
    Number.isSafeInteger(source.from?.id) && source.from.id>0 &&
    (source.message_thread_id==null ||
      Number(source.message_thread_id)===Number(topic));
}
function isVolunteerReport(text) {
  if(typeof text!=='string'||text.length<15||text.length>1200)return false;
  const normalized=text.normalize('NFKC');
  // Avoid triggering on any incidental mention of Netis N6 or basic OpenWrt chat.
  // Only a message explicitly combining the router, firmware/ABI and monitor
  // testing/metrics is a report worth following up on.
  return NETIS.test(normalized) &&
    (OPENWRT.test(normalized)||MIPSEL.test(normalized)) &&
    MONITOR.test(normalized) &&
    !normalized.trimStart().startsWith('/');
}
const QUESTION=[
  '🦊 Спасибо за проверку Cudy Monitor Pro на Netis N6!',
  'Отвечаю именно на ваше сообщение, чтобы не терять контекст теста.',
  'Уточните, пожалуйста:',
  '1. Версию OpenWrt и точный target/ABI: значения DISTRIB_RELEASE, DISTRIB_TARGET и apk --print-arch (или укажите, если стоит opkg).',
  '2. Правдоподобны ли CPU, RAM и WAN? Можно сравнить цифры с top, free и ip -s link.',
  '3. Обновляются ли графики после 10 минут работы? Нет ли зависаний или нагрузки на роутер?',
  '4. Если есть ошибка — только её обезличенное описание или скриншот.',
  '⚠️ OTA на MIPSEL пока заблокирован; не запускайте обновление. Не присылайте IP, MAC, токены, пароли или полные логи.',
  'Результаты внесём в https://github.com/stub11/cudy-monitor-pro/issues/139'
].join('\n');

module.exports={isAdminCommand,validTarget,isVolunteerReport,QUESTION};
