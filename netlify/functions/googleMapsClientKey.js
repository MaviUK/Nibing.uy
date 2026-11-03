export default async function handler() {
  const key = Netlify.env.get('VITE_GOOGLE_MAPS_API_KEY') || '';

  if (!key) {
    return new Response(JSON.stringify({ error: 'Google Maps client key is not configured.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  return new Response(JSON.stringify({ key }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
