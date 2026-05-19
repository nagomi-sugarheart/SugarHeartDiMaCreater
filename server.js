const express = require('express');
const path    = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));

// public/ フォルダを静的配信（index.html が / で表示される）
app.use(express.static(path.join(__dirname, 'public')));

// ──────────────────────────────────────────────────────────────
// 🤖 Claude API プロキシ
// HuggingFace Secrets に ANTHROPIC_API_KEY を設定してください
// ──────────────────────────────────────────────────────────────
app.post('/api/claude', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: { message: 'APIキーが未設定です。HuggingFace の Secrets に ANTHROPIC_API_KEY を追加してください。' }
    });
  }
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('Claude proxy error:', err);
    res.status(500).json({ error: { message: err.message } });
  }
});

const PORT = process.env.PORT || 7860;
app.listen(PORT, () => console.log(`サーバー起動: http://localhost:${PORT}`));
