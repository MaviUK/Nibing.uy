const { getStore } = require("@netlify/blobs");

function getStoreSafe(name) {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.BLOBS_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.BLOBS_TOKEN;
  return siteID && token ? getStore({ name, siteID, token }) : getStore({ name });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET" && event.httpMethod !== "HEAD") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const rawId = String(event.queryStringParameters?.id || "").trim();
    const id = decodeURIComponent(rawId).replace(/\.pdf$/i, "").trim();
    if (!/^[a-z0-9-]{8,80}$/i.test(id)) {
      return { statusCode: 400, body: "Invalid document id" };
    }

    const store = getStoreSafe("street-terms-documents");
    const record = await store.get(id, { type: "json" });
    if (!record?.base64) return { statusCode: 404, body: "Document not found" };

    const headers = {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${String(record.filename || "Ni-Bin-Guy-Terms-Acceptance.pdf").replace(/[^a-zA-Z0-9._-]/g, "-")}"`,
      "Cache-Control": "private, max-age=300",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "X-Content-Type-Options": "nosniff",
    };

    if (event.httpMethod === "HEAD") return { statusCode: 200, headers, body: "" };
    return { statusCode: 200, headers, isBase64Encoded: true, body: record.base64 };
  } catch (error) {
    console.error("streetTermsDocument failed:", error);
    return { statusCode: 500, body: "Unable to load document" };
  }
};
