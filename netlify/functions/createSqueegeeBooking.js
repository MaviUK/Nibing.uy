// netlify/functions/createSqueegeeBooking.js

function getPlanAnswer(planId = "") {
  switch (planId) {
    case "domestic_4w":
      return "After Every Bin Lorry Visit";
    case "domestic_oneoff":
      return "One Off Clean";
    case "comm_lt360_4w":
      return "After Every Bin Lorry Visit";
    case "comm_lt360_oneoff":
      return "One Off Clean";
    case "comm_gt660_4w":
      return "After Every Bin Lorry Visit";
    case "comm_gt660_oneoff":
      return "One Off Clean";
    default:
      return "After Every Bin Lorry Visit";
  }
}

function getBinSizeAnswer(planId = "") {
  if (planId.includes("gt660")) return "Commercial 660L+";
  if (planId.includes("lt360")) return "Commercial <360L";
  return "Domestic 120L";
}

function getCleanTypeAnswer(planId = "") {
  if (planId.includes("oneoff")) return "One Off Clean";
  return "Maintenance Clean";
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const payload = JSON.parse(event.body || "{}");

    const {
      name = "",
      email = "",
      phone = "",
      address = "",
      bins = [],
      notes = "",
      recaptchaToken = "",
    } = payload;

    if (!name || !email || !phone || !address || !recaptchaToken) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing required fields" }),
      };
    }

    const safeBins = Array.isArray(bins) ? bins.filter(Boolean) : [];
    const firstBin = safeBins[0] || {};

    const totalBins =
      safeBins.reduce((sum, b) => sum + (Number(b?.count || 1)), 0) || 1;

    const combinedNotes = [
      notes || "",
      address ? `Address: ${address}` : "",
      safeBins.length
        ? "Bins:\n" +
          safeBins
            .map((b) => `${b.count || 1} x ${b.type || "Bin"} (${b.planId || "unknown"})`)
            .join("\n")
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const questionAnswers = [
      {
        questionId: "question.window-count-choice",
        question: "How many bins do you have?",
        answer: String(totalBins),
      },
      {
        questionId: "question.bin-size-choice",
        question: "What size are your bins?",
        answer: getBinSizeAnswer(firstBin.planId || ""),
      },
      {
        questionId: "question.bin-frequency-choice",
        question: "How often would you like to have your bins cleaned? ",
        answer: getPlanAnswer(firstBin.planId || ""),
      },
      {
        questionId: "question.bin-clean-type-choice",
        question: "What kind of clean would you like to book? ",
        answer: getCleanTypeAnswer(firstBin.planId || ""),
      },
    ];

    const squegeePayload = {
      name,
      email,
      phone,
      location: {},
      additionalInfo: combinedNotes,
      clientId: "nibinguy",
      errors: [],
      locale: "en-US",
      questionAnswers,
      recaptcha: recaptchaToken,
      selectedServices: [
        {
          children: [],
          description: "",
          id: "service.bin-cleaning",
          name: "Bin/Garbage Can Cleaning",
        },
      ],
    };

    const res = await fetch("https://squeeg.ee/api/quote-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": "nibinguy",
      },
      body: JSON.stringify(squegeePayload),
    });

    const rawText = await res.text();
    let data = null;

    try {
      data = JSON.parse(rawText);
    } catch {
      data = { raw: rawText };
    }

    if (!res.ok || !data?.success) {
      console.error("Squeegee error FULL:", {
        status: res.status,
        raw: rawText,
        parsed: data,
      });

      return {
        statusCode: 502,
        body: JSON.stringify({
          error: "Squeegee failed",
          status: res.status,
          raw: rawText,
          details: data,
        }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        customerId: data.customerId || null,
        quoteId: data.quote?._id || null,
        squegee: data,
      }),
    };
  } catch (error) {
    console.error("createSqueegeeBooking failed:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Squeegee booking failed",
        details: error.message,
      }),
    };
  }
};
