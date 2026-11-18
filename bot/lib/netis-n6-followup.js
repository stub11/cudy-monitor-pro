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


const SESSION_TTL=172800;
function sessionKey(message) {
  if(!Number.isSafeInteger(message?.from?.id)||message.from.id<=0)return null;
  return 'cudy:n6:session:v2:'+message.chat.id+':'+
    message.message_thread_id+':'+message.from.id;
}
function readSession(raw) {
  if(typeof raw!=='string'||raw.length>300)return null;
  try {
    const state=JSON.parse(raw);
    if(!state||![1,2,3].includes(state.step)||
      !Number.isSafeInteger(state.prompt)||state.prompt<=0||
      !Number.isSafeInteger(state.last)||state.last<=0)return null;
    return state;
  }catch{return null;}
}
function isSessionReply(message,state) {
  // Replies to our most recent question or an original report are accepted;
  // unrelated group messages are not harvested.
  const reply=message?.reply_to_message;
  return !!state&&!!reply&&
    Number(reply.message_id)===Number(state.prompt)&&
    reply.from?.is_bot===true;
}
function parseRelease(text) {
  if(typeof text!=='string'||text.length>1600)return null;
  const release=text.match(/DISTRIB_RELEASE\s*=\s*['"]?(\d{2}\.\d{1,2}(?:\.\d{1,2})?)/i)?.[1];
  const target=text.match(/DISTRIB_TARGET\s*=\s*['"]?([a-z0-9_-]+\/[a-z0-9_-]+)/i)?.[1];
  const arch=text.match(/DISTRIB_ARCH\s*=\s*['"]?([a-z0-9_]+)/i)?.[1];
  if(!release||!target||!arch)return null;
  return {release,target,arch,compatible:target==='ramips/mt7621'&&arch==='mipsel_24kc'&&
    Number(release.split('.')[0])>=25};
}
function stageFor(text,step) {
  if(step===1)return parseRelease(text)?2:null;
  if(typeof text!=='string'||text.length<4||text.length>1600)return null;
  if(step===2 && /(?:cpu|ram|wan|процессор|памят|трафик|показател|top|free|link)/iu.test(text))return 3;
  if(step===3 && /(?:график|минут|работает|ошиб|завис|нагруз|нормально|стабильн)/iu.test(text))return 4;
  return null;
}
function nextQuestion(stage,release) {
  if(stage===2){
    if(release&&!release.compatible)
      return '⚠️ Указанная архитектура не подтверждает совместимость с тестовым MIPSEL APK. Не устанавливайте и не обновляйте пакет. Проверьте target/ABI.';
    return '✅ OpenWrt '+release.release+', '+release.target+', '+release.arch+
      ' — архитектура совпадает с тестовой сборкой. Спасибо! '+
      'Теперь сравните CPU/RAM/WAN с top, free и ip -s link. Пришлите только цифры, без IP, MAC и полных логов.';
  }
  if(stage===3)return 'Спасибо! Следующий шаг: проверьте, обновляются ли графики через 10 минут, нет ли зависаний и чрезмерной нагрузки RAM/CPU. Пришлите краткий результат.';
  return '🦊 Спасибо за тест Netis N6! Результаты получены. Если обнаружили ошибку, пришлите обезличенный скриншот или описание. OTA MIPSEL пока не включайте.';
}


function combinedTesterReport(text) {
  const release=parseRelease(text);
  if(!release||typeof text!=='string'||text.length>1600)return null;
  // A tester may answer all four QA questions in one Telegram message.
  // Do not interpret "looks plausible" as a verified measurement.
  const archReported=/apk\s*--print-arch[\s\S]{0,60}\bmipsel\b/i.test(text);
  const metrics=/(?:2\.\s*вроде|2\.\s*похож|2\.\s*правдоподоб|2\.\s*нормальн)/iu.test(text);
  const graphs=/(?:3\.\s*обновляют|3\.\s*работают|3\.\s*нормальн)/iu.test(text);
  const thermal=/(?:температур[аыуе]|датчик[аи]?\s*температур)/iu.test(text);
  const ota=/\bOTA\b|обновлени[яйе]/iu.test(text);
  if(!metrics&&!graphs&&!thermal&&!ota)return null;
  return {release,archReported,metrics,graphs,thermal,ota};
}
function combinedReportReply(report) {
  if(!report.release.compatible)
    return '⚠️ Архитектура не подтверждена для MIPSEL-сборки. Не устанавливайте и не обновляйте APK.';
  return [
    '🦊 Спасибо за подробный отчёт по Netis N6!',
    '✅ OpenWrt '+report.release.release+' · '+report.release.target+
      ' · '+report.release.arch+
      (report.archReported?' (apk сообщает mipsel)':'')+'.',
    report.metrics?'📊 CPU/RAM/WAN выглядят правдоподобно по вашей оценке. Для точной проверки нужны цифры из top, free и ip -s link.':'',
    report.graphs?'📈 Графики обновляются. Уточните, продолжают ли они работать после 10 минут.':'',
    report.thermal?'🌡 Температуру CPU добавим при наличии доступного датчика. Проверьте, есть ли /sys/class/thermal/thermal_zone*/temp; отсутствие датчика — не ошибка монитора.':'',
    report.ota?'🔄 OTA для MIPSEL пока отключено. Включим только после проверки SHA256, активации и отката на реальном устройстве.':'',
    'Если сможете, пришлите обезличенные результаты — без IP, MAC, паролей и полных логов.',
    'Отчёт: https://github.com/stub11/cudy-monitor-pro/issues/139'
  ].filter(Boolean).join('\n');
}

module.exports={isAdminCommand,validTarget,isVolunteerReport,QUESTION,SESSION_TTL,sessionKey,readSession,isSessionReply,parseRelease,stageFor,nextQuestion,combinedTesterReport,combinedReportReply};
