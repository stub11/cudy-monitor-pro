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
function scrubDescription(raw) {
 if (typeof raw !== 'string' || raw.length > 1500) return null;
 let s = raw.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g,' ').trim();
 if (s.length < 10) return null;
 s=s.replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{15,}|github_pat_[A-Za-z0-9_]{15,}|\d{7,12}:[A-Za-z0-9_-]{24,})\b/giu,'[токен скрыт]');
 s=s.replace(/(?:^|[\s,;])(?:token|пароль|password|passwd|secret|api[_ -]?key)\s*[:=]\s*["']?[^\s,;]{3,}/giu,' [секрет скрыт]');
 s=s.replace(/https?:\/\/\S+/giu,'[ссылка скрыта]');
 s=s.replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/giu,'[домен скрыт]');
 s=s.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/gu,'[IP скрыт]');
 s=s.replace(/\b(?:[a-f0-9]{0,4}:){2,}[a-f0-9:]{2,}\b/giu,'[IPv6 скрыт]');
 s=s.replace(/\b(?:[a-f0-9]{2}[:-]){5}[a-f0-9]{2}\b/giu,'[MAC скрыт]');
 s=s.replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/giu,'[email скрыт]');
 s=s.replace(/(?:^|\s)@[a-z][a-z0-9_]{3,}/giu,' [ник скрыт]');
 s=s.replace(/(?:[A-Za-z]:\\|\/(?:home|users|root|opt|etc)\/)[^\s]+/giu,'[путь скрыт]');
 s=s.replace(/\b(?:\+?\d[\d\s()-]{9,}\d)\b/gu,'[номер скрыт]');
 s=s.replace(/[@#<>\[\]()*_!~|{}\\]/gu,' ').replace(/\s+/gu,' ').trim().slice(0,400);
 return s.length>=10?s:null;
}
function descriptionPrompt() {
 return '✍️ Чтобы дополнить отчёт, отправьте одним сообщением /cudy_describe и описание. '+
 'Например: /cudy_describe При открытии вкладки Сеть график остаётся пустым, хотя трафик идёт. '+
 'Не присылайте пароли, адреса, токены и журналы. '+
 'Перед отправкой в публичный GitHub проверьте показанный очищенный текст.';
}
function summarize(state) {
 return '📋 Параметры проблемы:\n• Система: '+LABELS.platform[state.platform]+
 '\n• Симптом: '+LABELS.symptom[state.symptom]+
 '\n• Проверка: '+LABELS.tried[state.tried]+
 '\n\nСначала ознакомьтесь с инструкцией: '+GUIDE+
 '\nЕсли проблема осталась, команда /cudy_report даст согласие опубликовать указанные параметры и, если добавлено, ваше проверенное описание в общедоступном GitHub Issues. Необработанные сообщения, Telegram ID и данные профиля не передаются; очищенное описание публикуется только после вашей проверки. /cudy_cancel — отменить.';
}
function buildIssue(state) {
 if(!state || !steps.every(k=>OPTIONS[k].includes(state[k]))) return null;
 const description=typeof state.description==='string' ? scrubDescription(state.description) : null;
 return {
  title:'[Cudyapp report] '+LABELS.symptom[state.symptom]+' — '+LABELS.platform[state.platform],
  body:'## Обезличённый отчёт диагностики\n\n'+
   '- Система: '+LABELS.platform[state.platform]+'\n'+
   '- Категория: '+LABELS.symptom[state.symptom]+'\n'+
   '- Ранее проверено: '+LABELS.tried[state.tried]+'\n\n'+
   (description ? '### Описание участника (проверено перед отправкой)\n\n'+description+'\n\n' : '')+
   'Данные получены через опрос @Cudyapp после согласия на публикацию. '+
   'Автоматическая очистка описания не гарантирует обнаружения всех секретов; '+
   'автор проверил итоговый текст перед публикацией.\n',
 };
}
function nextStep(state) {return steps.find(k=>!state[k])||null;}
module.exports={OPTIONS, LABELS, startsProblem, option, prompt, summarize, buildIssue, nextStep, scrubDescription, descriptionPrompt};
