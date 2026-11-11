'use strict';
/**
 * Fixed, reviewed public README FAQ. Not a language model and not a live fetch.
 * Never reads private repositories, router configuration, tokens or host files.
 * Link to the canonical public README instead of echoing untrusted user input.
 */
const README = 'https://github.com/stub11/cudy-monitor-pro#readme';
const RELEASES = 'https://github.com/stub11/cudy-monitor-pro/releases';
const ISSUES = 'https://github.com/stub11/cudy-monitor-pro/issues/new/choose';
const faq = [
  { id: 'about', patterns: [/что (?:такое|за проект) cudy monitor pro/u, /что (?:умеет|делает) (?:монитор|cudy monitor)/u],
    answer: 'Cudy Monitor Pro — локальная веб-панель мониторинга ARM64-роутеров. Показывает ресурсы, процессы, сетевые интерфейсы и доступные датчики. Это независимый проект, не официальный продукт производителей.\n'+README },
  { id: 'install', patterns: [/(?:как|где) (?:установить|поставить|инсталлировать) (?:cudy monitor|монитор|панель)/u, /(?:инструкция|установка) (?:cudy monitor|монитора)/u],
    answer: 'Инструкция по установке есть в разделе «Быстрый старт» публичного README. Перед установкой сохраните резервную копию роутера и убедитесь в совместимости ARM64. Не запускайте неизвестные команды.\n'+README },
  { id: 'update', patterns: [/как обновить (?:монитор|cudy monitor|панель)/u, /(?:обновление|обновить) (?:cudy monitor|монитора)/u],
    answer: 'Для обновления есть команда --update в публичном README. В нативном OpenWrt APK (с версии 1.2.8) обновление поддерживается также из панели. Предварительно сохраните конфигурацию.\n'+README },
  { id: 'remove', patterns: [/как (?:удалить|деинсталлировать) (?:cudy monitor|монитор|панель)/u, /удаление (?:монитора|cudy monitor)/u],
    answer: 'Раздел «Удаление» в README содержит официальную команду --remove. Она удаляет монитор, сохраняя его настройки; другие службы и Entware не удаляются.\n'+README },
  { id: 'open', patterns: [/как (?:открыть|зайти|войти) (?:в )?(?:панель|монитор)/u, /(?:панель|монитор) не открывается/u],
    answer: 'Откройте с устройства в доверенной домашней сети адрес, показанный установщиком, вида http://IP-роутера:8237/. Убедитесь, что устройство не в гостевой сети. Не открывайте порт 8237 в интернет.\n'+README },
  { id: 'compatibility', patterns: [/с какими (?:роутерами|прошивками) (?:работает|совместим) (?:монитор|cudy monitor)/u, /(?:поддерживает|совместим(?:ость)?) (?:openwrt|keenetic|cudy|netis)/u, /какие (?:роутеры|прошивки) поддерживаются/u, /(?:подойдет|поддерживается) (?:ли )?(?:мой )?(?:роутер|openwrt|keenetic|netis|cudy)/u],
    answer: 'Заявлена ARM64-поддержка Keenetic Ported с Entware в /opt и OpenWrt 25.12+ с нативным apk. Есть отдельные успешные тесты, но работа на всех моделях не гарантирована. Проверяйте таблицу совместимости.\n'+README },
  { id: 'features', patterns: [/(?:что|какие) (?:показывает|отслеживает|мониторит) (?:монитор|панель|cudy monitor)/u, /какие (?:есть )?функции (?:монитора|cudy monitor)/u],
    answer: 'Панель показывает CPU, RAM, температуру при наличии датчика, аптайм, процессы, накопители, скорость интерфейсов и активный WAN. Также обнаруживает установленные D2K, DoQ и KeenKit, но не устанавливает их.\n'+README },
  { id: 'security', patterns: [/(?:безопасно|безопасен) (?:ли )?(?:монитор|cudy monitor)/u, /(?:нужен|есть) (?:ли )?пароль (?:на|для) (?:панели|монитора)/u, /(?:можно|надо) (?:ли )?открыть порт 8237/u],
    answer: 'Монитор рассчитан на доверенную локальную сеть. По умолчанию авторизация выключена, но её можно включить в настройках. Никогда не пробрасывайте порт 8237 в интернет или гостевую сеть.\n'+README },
  { id: 'logs', patterns: [/где (?:посмотреть|найти) (?:логи|журналы) (?:монитора|панели)/u, /как (?:снять|экспортировать) (?:лог|логи|журнал)/u],
    answer: 'Во вкладке «Журналы» доступны события монитора, а на некоторых прошивках — системные записи. Перед отправкой отчёта вручную удалите IP, пароли, токены и другие личные данные.\n'+README },
  { id: 'support', patterns: [/куда (?:писать|сообщить) (?:об ошибке|о баге)/u, /как (?:сообщить|создать) (?:issue|баг|ошибку)/u, /где (?:поддержка|задать вопрос) (?:про|по) (?:монитор|cudy monitor)/u],
    answer: 'Сообщите об ошибке в публичном GitHub Issues. Укажите модель и версию прошивки, но НЕ публикуйте пароли, токены, внешний IP, приватные адреса или несмаскированные журналы.\n'+ISSUES },
  { id: 'releases', patterns: [/где (?:скачать|найти) (?:релиз|версию|обновление) (?:монитора|cudy monitor)/u, /где (?:релизы|версии) (?:cudy monitor|монитора)/u],
    answer: 'Официальные опубликованные релизы доступны на GitHub. Не скачивайте непроверенные сборки из случайных источников.\n'+RELEASES },
  { id: 'license', patterns: [/какая лицензия (?:у )?(?:монитора|cudy monitor)/u, /(?:лицензия|исходники) (?:cudy monitor|монитора)/u],
    answer: 'Проект публикуется под лицензией MIT. Исходный код доступен в публичном репозитории.\n'+README }
];
function answerPublicQuestion(text) {
  if (typeof text !== 'string' || text.length > 1000) return null;
  const input = text.normalize('NFKC').toLowerCase().replace(/ё/g,'е').trim();
  if (/^\/cudy_help(?:@cudyapp)?\s*$/u.test(input)) {
    return '📚 Помощь по Cudy Monitor Pro: спросите «как установить монитор?», «какие роутеры поддерживаются?», «как открыть панель?», «как обновить монитор?». Отвечаю только по проверенной публичной документации.\n'+README;
  }
  // Never treat casual chat as a documentation request. Explicit question or mention required.
  if (!input.includes('?') && !input.includes('@cudyapp')) return null;
  const cleaned = input.replace(/@cudyapp/gu,'').trim();
  // Answer only known roadmap gaps as "in development". A broken existing
  // graph or OTA installation is a bug, not a feature still in development.
  if (/(?:удаленн(?:ый|ого|ом)|облачн(?:ый|ого|ом)|из\s+интернет[а]?)/u.test(cleaned) &&
      /(?:доступ|подключени|панел)/u.test(cleaned))
    return '⏳ Облачное и удалённое подключение к панели пока в разработке. Монитор рассчитан на локальную сеть; подтверждённой даты выпуска этой функции пока нет.';
  if (/(?:истори|лог|журнал)/u.test(cleaned) &&
      /(?:после\s+(?:перезагруз|рестарт)|сохран(?:ять|ени|ить)|на\s+(?:usb|флешк|диск)|постоянн)/u.test(cleaned))
    return '⏳ Постоянное сохранение истории мониторинга пока в разработке. Сейчас история находится в RAM и после перезапуска сбрасывается.';
  if (/график/u.test(cleaned) &&
      /(?:сет[ьи]|трафик|wan|интерфейс)/u.test(cleaned) &&
      /(?:не\s+(?:показыва|отобража|работа|строи|появля)|пуст|нет\s+(?:график|данных)|ожидани[ея]\s+данных)/u.test(cleaned))
    return '🔧 Сетевой график уже реализован. Если он пустой, это ошибка или проблема получения истории, а не функция «в разработке». Укажите модель роутера, прошивку, версию монитора и выбранный интерфейс — без паролей или полного журнала.';
  for (const entry of faq) if (entry.patterns.some(re=>re.test(cleaned))) return entry.answer;
  return null; // no speculation, and no echoing sensitive user-provided content
}
module.exports = { answerPublicQuestion, faq };
