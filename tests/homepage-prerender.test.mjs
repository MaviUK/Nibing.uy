import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Run after npm run build: these checks inspect the actual shipped document,
// without executing any browser JavaScript or counting JSON-LD as page content.
const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const body = html.split('<body>')[1].replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
const text = body.replace(/<[^>]+>/g, ' ');

test('initial HTML includes service, prices, contact details and business hours', () => {
  for (const value of ['£5 per bin every four weeks', '£15 per bin', '07555 178484', 'info@nibing.uy', 'Monday–Friday, 8am–8pm', 'What We Do', 'The Process']) {
    assert.ok(text.includes(value), `Missing visible content: ${value}`);
  }
  assert.ok(body.includes('id="main-content"'));
  assert.ok(!body.includes('id="crawler-homepage-content"'));
});

test('all ten FAQ answers and nine town links are present before JavaScript', () => {
  for (let i = 0; i < 10; i++) {
    assert.ok(body.includes(`id="n64-help-answer-${i}"`));
    assert.ok(body.includes(`id="n64-help-question-${i}"`));
  }
  for (const town of ['bangor', 'groomsport', 'donaghadee', 'millisle', 'portaferry', 'newtownards', 'holywood', 'carrowdore', 'comber']) {
    assert.ok(body.includes(`href="/bin-cleaning-${town}`));
  }
  assert.ok(body.includes('<noscript>'));
});

test('prerender has unique IDs and contains no open booking or private customer form', () => {
  const ids = [...body.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(ids.length, new Set(ids).size);
  assert.ok(!body.includes('id="booking-title"'));
  assert.ok(!body.includes('id="contact-title"'));
  assert.ok(body.includes('data-prerendered="true"'));
});

test('the separate street booking entry is not replaced with the homepage', async () => {
  const street = await readFile(new URL('../dist/street-booking.html', import.meta.url), 'utf8');
  assert.ok(!street.includes('id="n64-help-answer-9"'));
  assert.ok(!street.includes('data-prerendered="true"'));
});
