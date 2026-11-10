'use strict';
/**
 * Privacy-first problem intake. Store only enum values, never message text,
 * Telegram IDs, private IP addresses, or logs inside the public issue.
 */
const OPTIONS = Object.freeze({
  platform: ['openwrt', 'keenetic', 'other'],
  symptom: ['install', 'panel', 'update', 'network', 'other'],
  tried: ['docs', 'restart', 'nothing', 'other']
});
const LABELS = {
 platform:{openwrt:'OpenWrt ARM64',keenetic:'Keenetic Ported + Entware',other:'Другое / неизвестно'},
 symptom:{install:'Ошибка установки',panel:'Панель не открывается',update:'Ошибка обновления',network:'Ошибка мониторинга сети',other:'Другая проблема'},
 tried:{docs:'Изучил README',restart:'Повторил запуск',nothing:'Ещё не проверял',other:'Другое'}
};
const GUIDE='https://github.com/stub11/cudy-monitor-pro#readme';
const steps = ['platform','symptom','tried'];
function startsProblem(text) {
 const s=String(text||'').normalize('NFKC').toLowerCase();
 if (/^\/cudy_problem(?:@cudyapp)?\s*$/u.test(s)) return true;
 return /(?:монитор|cudy monitor|панель(?: монитора)?|cudy monitor pro)/u.test(s) &&
   /(?:не открывается|не работает|не запускается|ошибка|вылетает|не устанавливается|не обновляется)/u.test(s);
}
function option(text,step) {
 const value=String(text||'').trim().toLowerCase();
 const m=value.match(/^\/cudy_(platform|symptom|tried)(?:@cudyapp)?\s+([a-z]+)\s*$/u);
 if(!m || m[1]!==step || !OPTIONS[step].includes(m[2]))return null;
 return m[2];
}
function prompt(step) {
 if(step==='platform')return '🛠 Уточним проблему с Cudy Monitor Pro. Я могу подготовить обезличенный технический отчёт для публичного GitHub Issues, но опубликую его только после отдельного согласия. Не отправляйте логины, пароли, токены, IP или сырые журналы.\n\n1/3. Какая система? Ответьте одной командой: /cudy_platform openwrt, /cudy_platform keenetic или /cudy_platform other.';
 if(step==='symptom')return '2/3. Что произошло? Ответьте: /cudy_symptom install (установка), /cudy_symptom panel (панель не открывается), /cudy_symptom update (обновление), /cudy_symptom network (сеть), /cudy_symptom other (другое).';
 if(step==='tried')return '3/3. Что уже пробовали? /cudy_tried docs (прочитал README), /cudy_tried restart (повторил запуск), /cudy_tried nothing (ещё нет), /cudy_tried other (другое).';
 return '';
}
function summarize(state) {
 return '📋 Параметры проблемы:\n• Система: '+LABELS.platform[state.platform]+
 '\n• Симптом: '+LABELS.symptom[state.symptom]+
 '\n• Проверка: '+LABELS.tried[state.tried]+
 '\n\nСначала ознакомьтесь с инструкцией: '+GUIDE+
 '\nЕсли проблема осталась, команда /cudy_report даст согласие опубликовать **только эти три технических параметра** в общедоступном GitHub Issues. Личные данные, имена, Telegram ID и тексты сообщений туда не передаются. /cudy_cancel — отменить.';
}
function buildIssue(state) {
 if(!state || !steps.every(k=>OPTIONS[k].includes(state[k]))) return null;
 return {
  title:'[Cudyapp report] '+LABELS.symptom[state.symptom]+' — '+LABELS.platform[state.platform],
  body:'## Обезличённый отчёт диагностики\n\n'+
   '- Система: '+LABELS.platform[state.platform]+'\n'+
   '- Категория: '+LABELS.symptom[state.symptom]+'\n'+
   '- Ранее проверено: '+LABELS.tried[state.tried]+'\n\n'+
   'Данные получены через опрос @Cudyapp после согласия на публикацию. '+
   'Тексты сообщений, Telegram IDs, IP, пароли, токены и журналы не включены. '+
   'Проблема пока не подтверждена разработчиком.\n',
 };
}
function nextStep(state) {return steps.find(k=>!state[k])||null;}
module.exports={OPTIONS, LABELS, startsProblem, option, prompt, summarize, buildIssue, nextStep};
