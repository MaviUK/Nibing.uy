const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.RESEND_FROM || 'Ni Bin Guy <noreply@nibing.uy>';
const TO = process.env.BOOKINGS_TO || 'info@nibing.uy';

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { name = '', address = '', phone = '', email = '', comments = '' } = JSON.parse(event.body || '{}');
    const note = String(comments || '').trim();
    if (!note) return { statusCode: 204, body: '' };

    await resend.emails.send({
      from: FROM,
      to: TO,
      replyTo: email || undefined,
      subject: 'Booking comment / bin day issue',
      text: `Booking comment / bin day issue\n\nName: ${name}\nAddress: ${address}\nPhone: ${phone}\nEmail: ${email}\n\nComments:\n${note}`,
      html: `
        <h2>Booking comment / bin day issue</h2>
        <p><strong>Name:</strong> ${escapeHtml(name)}</p>
        <p><strong>Address:</strong> ${escapeHtml(address)}</p>
        <p><strong>Phone:</strong> ${escapeHtml(phone)}</p>
        <p><strong>Email:</strong> ${escapeHtml(email)}</p>
        <div style="margin-top:16px;padding:14px;border:1px solid #f59e0b;border-radius:10px;background:#fffbeb;">
          <strong>Comments / Bin Day Issues</strong>
          <p style="white-space:pre-wrap;margin:8px 0 0;">${escapeHtml(note)}</p>
        </div>
      `,
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (error) {
    console.error('sendBookingComment failed:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to send booking comment' }) };
  }
};
