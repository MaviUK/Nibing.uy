const { handler: sendTosReceipt } = require("./sendTosReceipt");

exports.handler = async (event, context) => {
  // Netlify treats *-background functions as background jobs: the browser gets
  // an immediate 202 response while the server keeps running this work.
  await sendTosReceipt(event, context);
  return { statusCode: 200, body: "" };
};
