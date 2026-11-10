'use strict';

// Targeted support for contradictory OTA status on Cudy + OpenWrt.
// Never request raw logs, credentials, HTTP URLs or private IP addresses.
const ADMIN_COMMAND = /^\/cudy_ask_update(?:@cudyapp)?\s*$/iu;

function looksLikeOtaProblem(text) {
  if (typeof text!=='string' || text.length>2000) return false;
  const s=text.normalize('NFKC').toLowerCase().replace(/ё/g,'е').trim();
  if(s.startsWith('/'))return false; // never intercept diagnostic, admin or Telegram commands
  const update=/(?:обновлен|обновить|обновля|верси[яию]|update|upgrade|ota)/u.test(s);
  const failed=/(?:неактивн|не\s+активн|недоступн|не работает|не меняет|не меняется|не измени|не обнов|не нажима|не установ|не устанавли|актуальн|завис|ошибк|не доступн|disabled|greyed|не происходит)/u.test(s);
  return update&&failed;
}

const STRUCTURED_COMMAND=/^\/cudy_ota_check(?:@cudyapp)?(?:\s|$)/iu;
function semverTuple(value) {
  if(typeof value!=='string'|| !/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(value))return null;
  return value.split('.').map(Number);
}
function compareVersions(a,b) {
  const x=semverTuple(a),y=semverTuple(b);
  if(!x||!y)return null;
  for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1;
  return 0;
}
function parseStructuredStatus(text) {
  if(typeof text!=='string'||text.length>160)return null;
  const m=/^\/cudy_ota_check(?:@cudyapp)?\s+(native_apk|entware)\s+(\d{1,5}\.\d{1,5}\.\d{1,5})\s+(\d{1,5}\.\d{1,5}\.\d{1,5})\s+(\d{1,5}\.\d{1,5}\.\d{1,5})\s+(true|false|yes|no|1|0|да|нет)\s*$/iu.exec(text);
  if(!m)return null;
  return {mode:m[1].toLowerCase(),running:m[2],installed:m[3],latest:m[4],
    available:/^(true|yes|1|да)$/iu.test(m[5])};
}
function summarizeStructuredStatus(values) {
  if(!values)return null;
  const {mode,running,installed,latest,available}=values;
  const diskRunning=compareVersions(installed,running);
  const publishedDisk=compareVersions(latest,installed);
  if(diskRunning===null||publishedDisk===null)return null;
  const prefix='📋 Проверка обновления Cudy Monitor Pro ('+
    (mode==='native_apk'?'OpenWrt APK':'Entware')+')\n\n'+
    'Запущено: '+running+'\nУстановленный файл: '+installed+
    '\nДоступно на GitHub: '+latest+'\nAPI available: '+String(available)+'\n\n';
  const expected=publishedDisk>0;
  if(diskRunning!==0)return prefix+
    '⚠️ Версия работающего процесса отличается от установленного файла. '+
    'Возможен неполный перезапуск службы; причина ещё не подтверждена. '+
    'Не выполняйте повторную установку без диагностики состояния службы. '+
    'Передайте разработчику только эти версии.';
  if(available!==expected)return prefix+
    '⚠️ Проверка обновлений противоречит версиям: API сообщает available='+
    String(available)+', хотя по номерам версий ожидается '+String(expected)+
    '. Новую установку пока не запускайте. Нужна диагностика обновлятора.';
  if(expected)return prefix+
    'ℹ️ Более новая версия обнаружена корректно. Если кнопка всё ещё недоступна, '+
    'сообщите об этом разработчику без публикации IP, токенов или журналов.';
  return prefix+'✅ По указанным версиям обновление не требуется. '+
    'Если интерфейс показывает другое, сообщите разработчику номера версий.';
}

const QUESTION=[
  '🛠 Уточнение по обновлению Cudy Monitor Pro на OpenWrt.',
  'Вижу сообщение о проблеме с обновлением. Чтобы выяснить причину, ответьте, пожалуйста, *на это сообщение*:',
  '1) Версия работающего монитора и тип установки: поля `version` и `update_mode` из раздела статуса монитора.',
  '2) При проверке обновления: только `current`, `latest` и `available` из результата `/api/update/check`.',
  '3) Если используете SSH, можно *только прочитать* версию файла командой `/usr/bin/cudy-monitor-pro --version`.',
  'Сравнение этих значений покажет, расходятся ли версия установленного файла и работающей службы.',
  '🤖 Для автоматического пояснения без журналов отправьте отдельно: /cudy_ota_check native_apk 1.2.10 1.2.11 1.2.11 false (порядок: режим, запущено, файл, GitHub, available). Замените пример своими значениями.',
  '🔐 Не отправляйте IP, пароли, токены, полный JSON статуса, конфигурацию, ссылки с адресом роутера или сырые журналы.',
  'Пока ничего не переустанавливайте и не перезапускайте. Описание проблемы: https://github.com/stub11/cudy-monitor-pro/issues/25'
].join('\n\n');

module.exports={ADMIN_COMMAND,STRUCTURED_COMMAND,looksLikeOtaProblem,QUESTION,parseStructuredStatus,summarizeStructuredStatus,compareVersions};
