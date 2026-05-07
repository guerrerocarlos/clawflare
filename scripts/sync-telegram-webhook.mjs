const publicBaseUrl = process.env.CLAWFLARE_PUBLIC_BASE_URL;
const gatewayToken = process.env.CLAWFLARE_GATEWAY_TOKEN;

if (!publicBaseUrl) {
  throw new Error("CLAWFLARE_PUBLIC_BASE_URL is required.");
}

if (!gatewayToken) {
  throw new Error("CLAWFLARE_GATEWAY_TOKEN is required.");
}

const controlUrl = new URL("/telegram/set-webhook", publicBaseUrl).toString();
const webhookUrl = new URL("/webhook/telegram", publicBaseUrl).toString();
const maxAttempts = 10;
const delayMs = 5000;

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const response = await fetch(controlUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${gatewayToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ url: webhookUrl }),
  });

  const text = await response.text();
  let payload;

  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }

  if (response.ok && payload && typeof payload === "object" && payload.ok === true) {
    console.log(`Telegram webhook synced to ${webhookUrl}`);
    process.exit(0);
  }

  console.error(`Webhook sync attempt ${attempt}/${maxAttempts} failed with ${response.status}: ${JSON.stringify(payload)}`);

  if (attempt < maxAttempts) {
    await sleep(delayMs);
  }
}

throw new Error(`Unable to sync Telegram webhook to ${webhookUrl}.`);
