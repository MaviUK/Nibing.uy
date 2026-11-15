import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import React from 'react';
import { renderToString } from 'react-dom/server';

// Use Vite's same JSX transforms and price overrides as the client build.
// Effects do not run on the server: no bookings, customer data or API calls.
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { HomePage } = await server.ssrLoadModule('/src/App.jsx');
  const markup = renderToString(React.createElement(HomePage));
  if (!markup.includes('id="main-content"') || !markup.includes('id="n64-help-answer-9"')) {
    throw new Error('Homepage prerender is missing its content or FAQs');
  }
  const path = new URL('../dist/index.html', import.meta.url);
  const html = await readFile(path, 'utf8');
  const fallback = /<div id="root">\s*<main id="crawler-homepage-content">[\s\S]*?<\/main>\s*<\/div>/;
  if (!fallback.test(html)) throw new Error('Homepage prerender placeholder was not found');
  const noScript = `<noscript><style>
    #main-content.n64-world .n64-help-answer[hidden],
    #main-content.n64-world .n64-help-answer__content[hidden] { display:block !important; }
    #main-content .n64-help-topics, #main-content .n64-help-topics-heading,
    #main-content .n64-help-answer-sheet__heading, #main-content .n64-help-answer__toggle { display:none !important; }
  </style><p style="padding:16px;background:#fff;color:#111;text-align:center">Online booking and account tools require JavaScript. Call <a href="tel:07555178484">07555 178484</a> or email <a href="mailto:info@nibing.uy">info@nibing.uy</a> for help.</p></noscript>`;
  // Keep the existing client mount: time-sensitive counters and browser-only
  // widgets initialise fresh rather than hydrating a potentially old snapshot.
  await writeFile(path, html.replace(fallback, () => `${noScript}<div id="root" data-prerendered="true">${markup}</div>`));
  console.log(`Prerendered homepage from shared React components (${markup.length} characters).`);
} finally {
  await server.close();
}
