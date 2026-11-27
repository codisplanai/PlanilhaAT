import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cteAttachmentFeedback,
  fiscalFileKey,
  mergeCteAttachedFiles,
} from '../src/lib/cteAttachment.ts';

function fakeFile(name: string, size = 10, lastModified = 1000): File {
  const content = 'x'.repeat(size);
  return new File([content], name, { type: 'text/xml', lastModified });
}

test('mergeCteAttachedFiles identifica arquivos novos e conta duplicados exatos', () => {
  const existing = [fakeFile('a.xml', 10, 100), fakeFile('b.zip', 20, 200)];
  const incoming = [fakeFile('a.xml', 10, 100), fakeFile('c.xml', 15, 300)];

  const result = mergeCteAttachedFiles(existing, incoming);

  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].name, 'c.xml');
  assert.equal(result.duplicateCount, 1);
  assert.deepEqual(
    result.merged.map((f) => f.name),
    ['a.xml', 'b.zip', 'c.xml'],
  );
  assert.equal(fiscalFileKey(existing[0]), 'a.xml|10|100');
});

test('mergeCteAttachedFiles também evita duplicar o mesmo arquivo dentro do lote recebido', () => {
  const result = mergeCteAttachedFiles(
    [],
    [fakeFile('a.xml', 10, 100), fakeFile('a.xml', 10, 100)],
  );
  assert.equal(result.added.length, 1);
  assert.equal(result.duplicateCount, 1);
});

test('cteAttachmentFeedback orienta usuário quando só envia duplicados ou pendência persiste', () => {
  const dupMsg = cteAttachmentFeedback({
    addedCount: 0,
    duplicateCount: 1,
    stillPending: true,
  });
  assert.match(dupMsg ?? '', /já estava\(m\) anexado\(s\)/i);

  const missingMsg = cteAttachmentFeedback({
    addedCount: 1,
    duplicateCount: 0,
    stillPending: true,
  });
  assert.match(missingMsg ?? '', /continuam faltando/i);

  assert.equal(
    cteAttachmentFeedback({ addedCount: 1, duplicateCount: 0, stillPending: false }),
    null,
  );
});

