'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { selectReaction } = require('../lib/moderation.js');

test('GIF reaction HTTPS URL is supported as a trigger response', () => {
  const triggers = [{
    words: ['ура'],
    responses: [{ animation_url: 'https://example.org/celebrate.gif', text: '🎉' }]
  }];
  assert.deepEqual(selectReaction('ура!', triggers), triggers[0].responses[0]);
});

test('GIF URL must use HTTPS, and no default trigger is created', () => {
  assert.equal(selectReaction('ура', [{words:['ура'],responses:[
    {animation_url:'http://example.org/a.gif'}
  ]}]), null);
  assert.equal(selectReaction('ура', []), null);
});

test('GIF trigger needs whole-word match', () => {
  const triggers = [{words:['кот'],responses:[{animation_url:'https://example.org/cat.gif'}]}];
  assert.equal(selectReaction('котик',triggers),null);
  assert.equal(selectReaction('кот',triggers)?.animation_url,'https://example.org/cat.gif');
});
