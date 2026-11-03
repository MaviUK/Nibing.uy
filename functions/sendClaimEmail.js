const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

exports.handler = async (event) => {
  const { bins, dates, nominatedAddress, town, postcode, neighbourName } = JSON.parse(event.body);

  try {
    const { data, error } = await resend.emails.send({
      from: 'claims@nibing.uy',
      to: 'info@nibing.uy',
      subject: '🧽 New Bin Claim Submitted',
      html: `
        <h2>New Claim Received</h2>
        <p><strong>Bin:</strong> ${bins[0]}</p>
        <p><strong>Dates:</strong> ${dates.join(', ')}</p>
        <p><strong>Neighbour Name:</strong> ${neighbourName}</p>
        <p><strong>Address:</strong> ${nominatedAddress}, ${town}, ${postcode}</p>
      `
    });

    if (error) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: error.message })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
