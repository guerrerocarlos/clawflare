export function renderDebugWebChat(): Response {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Clawflare Debug WebChat</title>
    <style>
      body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 2rem; max-width: 48rem; }
      textarea, input, button { font: inherit; width: 100%; box-sizing: border-box; margin: .5rem 0; }
      textarea { min-height: 8rem; }
      pre { background: #f4f4f0; padding: 1rem; white-space: pre-wrap; }
      .warning { border: 1px solid #b45309; background: #fffbeb; padding: 1rem; }
    </style>
  </head>
  <body>
    <h1>Clawflare Debug WebChat</h1>
    <p class="warning">Debug/control-only surface. Telegram is the MVP primary channel.</p>
    <label>Bearer token <input id="token" type="password" /></label>
    <label>Message <textarea id="message">hello</textarea></label>
    <button id="send">Send</button>
    <pre id="output"></pre>
    <script>
      document.getElementById("send").addEventListener("click", async () => {
        const response = await fetch("/webchat/message", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "authorization": "Bearer " + document.getElementById("token").value
          },
          body: JSON.stringify({ message: document.getElementById("message").value })
        });
        document.getElementById("output").textContent = JSON.stringify(await response.json(), null, 2);
      });
    </script>
  </body>
</html>`;

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
