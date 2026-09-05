const SITE_ORIGIN = "https://nibing.uy";
const SITEMAP_URL = `${SITE_ORIGIN}/sitemap.xml`;
const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const INDEXNOW_KEY = "938d30d0d59e4b5fa2ca657b23fcd63d";
const KEY_LOCATION = `${SITE_ORIGIN}/${INDEXNOW_KEY}.txt`;
const LOOKBACK_DAYS = 2;

function decodeXml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractRecentlyChangedUrls(xml) {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - LOOKBACK_DAYS);
  cutoff.setUTCHours(0, 0, 0, 0);

  const urls = [];
  const urlBlocks = xml.match(/<url>[\s\S]*?<\/url>/gi) || [];

  for (const block of urlBlocks) {
    const locMatch = block.match(/<loc>([\s\S]*?)<\/loc>/i);
    const lastmodMatch = block.match(/<lastmod>([\s\S]*?)<\/lastmod>/i);
    if (!locMatch || !lastmodMatch) continue;

    const url = decodeXml(locMatch[1].trim());
    const lastmod = new Date(lastmodMatch[1].trim());
    if (Number.isNaN(lastmod.getTime()) || lastmod < cutoff) continue;

    try {
      const parsed = new URL(url);
      if (parsed.origin === SITE_ORIGIN) urls.push(parsed.href);
    } catch {
      // Ignore malformed sitemap URLs.
    }
  }

  return [...new Set(urls)].slice(0, 10000);
}

export default async () => {
  try {
    const sitemapResponse = await fetch(SITEMAP_URL, {
      headers: { "user-agent": "NI-Bin-Guy-IndexNow/1.0" },
    });

    if (!sitemapResponse.ok) {
      console.error("IndexNow: failed to fetch sitemap", sitemapResponse.status);
      return new Response("Sitemap unavailable", { status: 502 });
    }

    const sitemap = await sitemapResponse.text();
    const urlList = extractRecentlyChangedUrls(sitemap);

    if (urlList.length === 0) {
      console.log("IndexNow: no recently changed URLs found");
      return new Response("No changed URLs", { status: 200 });
    }

    const response = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: "nibing.uy",
        key: INDEXNOW_KEY,
        keyLocation: KEY_LOCATION,
        urlList,
      }),
    });

    const responseText = await response.text();

    if (![200, 202].includes(response.status)) {
      console.error("IndexNow submission failed", response.status, responseText);
      return new Response(`IndexNow failed: ${response.status}`, { status: 502 });
    }

    console.log(`IndexNow: submitted ${urlList.length} URL(s), status ${response.status}`);
    return new Response(`Submitted ${urlList.length} URL(s)`, { status: 200 });
  } catch (error) {
    console.error("IndexNow unexpected error", error);
    return new Response("IndexNow error", { status: 500 });
  }
};

export const config = {
  schedule: "15 3 * * *",
};
