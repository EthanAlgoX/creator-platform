import assert from 'node:assert/strict';
import test from 'node:test';
import { appUrl, mediaUrl, resolveUploadReferences } from '../client/src/urls.js';

test('local development and subpath deployment resolve API, upload and export URLs', () => {
  assert.equal(appUrl('/api/bootstrap', '/'), '/api/bootstrap');
  assert.equal(appUrl('/api/bootstrap', '/creator-platform/'), '/creator-platform/api/bootstrap');
  assert.equal(appUrl('/api/contents/c/export?platformId=x&format=html', '/creator-platform'),
    '/creator-platform/api/contents/c/export?platformId=x&format=html');
  assert.equal(mediaUrl('/uploads/cover.png', '/creator-platform/'), '/creator-platform/uploads/cover.png');
  assert.equal(new URL(mediaUrl('/uploads/cover.png', '/creator-platform/'), 'https://myaistock.top').href,
    'https://myaistock.top/creator-platform/uploads/cover.png');
  assert.equal(mediaUrl('/uploads/video.mp4?download=1', '/creator-platform/'), '/creator-platform/uploads/video.mp4?download=1');
  assert.equal(appUrl('/creator-platform/api/bootstrap', '/creator-platform/'), '/creator-platform/api/bootstrap');
  assert.equal(mediaUrl('/creator-platform/uploads/cover.png', '/creator-platform/'), '/creator-platform/uploads/cover.png');
});

test('external result links, other sites and browser URLs are never remapped', () => {
  for (const url of ['https://example.com/uploads/photo.png', '//cdn.example.com/photo.png', 'blob:example', 'data:image/png;base64,AA==', '#review']) {
    assert.equal(appUrl(url, '/creator-platform/'), url);
    assert.equal(mediaUrl(url, '/creator-platform/'), url);
  }
  assert.equal(mediaUrl('/uploads-other/file', '/creator-platform/'), '/uploads-other/file');
});

test('HTML previews and exports resolve only local upload link destinations', () => {
  const html = `<p>/uploads/cover.png is example text</p><img src="/uploads/cover.png"><a href='/uploads/notes.pdf'>PDF</a><img src="https://cdn.example.com/photo.png">`;
  assert.equal(resolveUploadReferences(html, 'html', 'https://myaistock.top', '/creator-platform/'),
    `<p>/uploads/cover.png is example text</p><img src="https://myaistock.top/creator-platform/uploads/cover.png"><a href='https://myaistock.top/creator-platform/uploads/notes.pdf'>PDF</a><img src="https://cdn.example.com/photo.png">`);
});

test('Markdown exports preserve prose, link titles and external URLs while resolving uploads', () => {
  const markdown = '/uploads/cover.png is example text\n![封面](/uploads/cover.png "封面")\n[PDF](</uploads/notes.pdf>)\n[图][cover]\n[cover]: /uploads/cover.png "封面"\n[外部](https://example.com/notes.pdf)';
  const result = resolveUploadReferences(markdown, 'markdown', 'https://myaistock.top', '/creator-platform/');
  assert.match(result, /^\/uploads\/cover.png is example text/);
  assert.ok(result.includes('![封面](https://myaistock.top/creator-platform/uploads/cover.png "封面")'));
  assert.ok(result.includes('[PDF](<https://myaistock.top/creator-platform/uploads/notes.pdf>)'));
  assert.ok(result.includes('[cover]: https://myaistock.top/creator-platform/uploads/cover.png "封面"'));
  assert.ok(result.includes('[外部](https://example.com/notes.pdf)'));
});
