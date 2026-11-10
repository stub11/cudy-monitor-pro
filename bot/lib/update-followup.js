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
const QUESTION=[
  '🛠 Уточнение по обновлению Cudy Monitor Pro на OpenWrt.',
  'Вижу сообщение о проблеме с обновлением. Чтобы выяснить причину, ответьте, пожалуйста, *на это сообщение*:',
  '1) Версия работающего монитора и тип установки: поля `version` и `update_mode` из раздела статуса монитора.',
  '2) При проверке обновления: только `current`, `latest` и `available` из результата `/api/update/check`.',
  '3) Если используете SSH, можно *только прочитать* версию файла командой `/usr/bin/cudy-monitor-pro --version`.',
  'Сравнение этих значений покажет, расходятся ли версия установленного файла и работающей службы.',
  '🔐 Не отправляйте IP, пароли, токены, полный JSON статуса, конфигурацию, ссылки с адресом роутера или сырые журналы.',
  'Пока ничего не переустанавливайте и не перезапускайте. Описание проблемы: https://github.com/stub11/cudy-monitor-pro/issues/25'
].join('\n\n');

module.exports={ADMIN_COMMAND,looksLikeOtaProblem,QUESTION};
