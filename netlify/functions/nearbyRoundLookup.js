export default async function handler(req) {
  return new Response(JSON.stringify({ error: "placeholder" }), { status: 501, headers: { "Content-Type": "application/json" } });
}

export const config = { path: "/api/nearby-round-lookup" };
