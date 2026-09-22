import test from 'node:test';
import assert from 'node:assert/strict';
import Core from '../addon/content/core.js';

test('personal and group sources use actual zero-based page index, not printed page label', () => {
  assert.equal(Core.sourceURI({ attachmentKey: 'ABCD1234', pageIndex: 4 }), 'zotero://open-pdf/library/items/ABCD1234?page=5');
  assert.equal(Core.sourceURI({ attachmentKey: 'ABCD1234', groupID: 92, pageIndex: 0, annotationKey: 'EFGH5678' }), 'zotero://open-pdf/groups/92/items/ABCD1234?page=1&annotation=EFGH5678');
  assert.equal(Core.sourceURI({ attachmentKey: 'ABCD1234' }), 'zotero://open-pdf/library/items/ABCD1234');
  assert.equal(Core.sourceURI({ attachmentKey: '../../bad' }), '');
});
test('region image is an actual multimodal input and base64 is not duplicated in text', () => {
  const image = 'data:image/png;base64,aGVsbG8=';
  const input = Core.buildInput('解释图表', [{ id: 'fig-1', title: 'Paper A', kind: 'pdf-region', image }]);
  assert.equal(input[2].type, 'image'); assert.equal(input[2].url, image);
  assert.ok(!input[0].text.includes('aGVsbG8='));
  assert.match(input[1].text, /fig-1/);
});
test('cross-paper context retains separate source identities', () => {
  const input = Core.buildInput('比较两篇论文', [
    { attachmentKey: 'AAAA1111', text: 'first' }, { attachmentKey: 'BBBB2222', text: 'second' },
  ]);
  assert.match(input[0].text, /AAAA1111/); assert.match(input[0].text, /BBBB2222/);
});
test('large context and remote or malformed image fail visibly', () => {
  assert.throws(() => Core.buildInput('', []));
  assert.throws(() => Core.validateCards(Array(13).fill({})), /12/);
  assert.throws(() => Core.validateCards([{ text: 'a'.repeat(40000) }, { text: 'b'.repeat(40000) }]), /60000/);
  assert.throws(() => Core.validateCards([{ image: 'https://example.com/a.png' }]), /PNG/);
  assert.throws(() => Core.validateCards([{ sourceURI: 'javascript:alert(1)' }]), /来源/);
});
test('nearby extraction tolerates whitespace without inventing an unrelated passage', () => {
  assert.equal(Core.nearbyText('Before\nselected   text\nafter', 'selected text', 8), 'Before selected text after');
  assert.equal(Core.nearbyText('different paper', 'not found'), '');
});
test('note insertion escapes model HTML and preserves valid source links', () => {
  const html = Core.noteHTML('<img src=x onerror=alert(1)>\nline', [{ title: '<Title>', sourceURI: 'zotero://open-pdf/library/items/AAAA1111?page=2' }]);
  assert.ok(!html.includes('<img')); assert.match(html, /&lt;img/); assert.match(html, /&lt;Title&gt;/); assert.match(html, /href="zotero:/);
});
