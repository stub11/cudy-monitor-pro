'use strict';
/**
 * Zero-dependency deterministic safety classifier.
 * Conservative matches: isolated Russian obscene words or direct insults,
 * not arbitrary substrings that could flag normal discussion.
 * Editable response triggers start empty in bot/config.json.
 */
const PROFANITY = /(?:^|[^\p{L}])(?:бля(?:дь|ть|ха|ха(?:ть)?|дский|дская)?|сука|сучк[аиуое]|пизд(?:а|ец|ецкий|еть|юк|ёж|ёжка)|хуй|хуя|хуе(?:вый|та|ть|во)|нахуй|похуй|ебать|ёб(?:аный|нутый)|ебл(?:ан|о)|мудак|мудила)(?=$|[^\p{L}])/iu;
const DIRECT_INSULT = /(?:^|[^\p{L}])(?:ты|вы|тебя|тво[йя]|сам)\s+(?:же\s+)?(?:дебил(?:ка)?|идиот(?:ка)?|туп(?:ой|ая|ое)|урод(?:ина)?|кретин(?:ка)?)(?=$|[^\p{L}])/iu;

function checkMessage(text, policy = {}) {
  if (typeof text !== 'string' || !text) return null;
  // Inspect bounded text; avoid CPU spikes from multi-megabyte payloads.
  const input = text.normalize('NFKC').slice(0, 4096);
  if (policy.delete_profanity && PROFANITY.test(input)) return { reason: 'profanity' };
  if (policy.delete_explicit_insults && DIRECT_INSULT.test(input)) return { reason: 'insult' };
  return null;
}
function selectReaction(text, triggers = [], entropy = 0) {
  if (typeof text !== 'string' || !Array.isArray(triggers) || !text) return null;
  const input = text.normalize('NFKC').toLowerCase();
  for (const trigger of triggers) {
    if (!trigger || trigger.enabled === false || !Array.isArray(trigger.words)) continue;
    const words = trigger.words.filter(w => typeof w === 'string' && w.trim().length >= 2 &&
      w.trim().length <= 48).slice(0, 20);
    const matches = words.some(w => {
      const needle = w.normalize('NFKC').toLowerCase().trim();
      let pos = input.indexOf(needle);
      while (pos !== -1) {
        const before = input[pos - 1] || '';
        const after = input[pos + needle.length] || '';
        if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) return true;
        pos = input.indexOf(needle, pos + 1);
      }
      return false;
    });
    if (!matches) continue;
    const variants = Array.isArray(trigger.responses) ? trigger.responses : [];
    const safe = variants.filter(r => r && typeof r === 'object' &&
      ((typeof r.text === 'string' && r.text.length <= 500) ||
       (typeof r.sticker_file_id === 'string' && r.sticker_file_id.length <= 200) ||
       (typeof r.photo_url === 'string' && /^https:\/\//.test(r.photo_url))));
    if (!safe.length) continue;
    return safe[Math.abs(Number(entropy) || 0) % safe.length];
  }
  return null;
}
module.exports = { checkMessage, selectReaction };
