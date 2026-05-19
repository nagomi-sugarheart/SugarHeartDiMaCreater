FROM node:18-slim

# 日本語フォントのみ（chromiumは不要になったので削除）
RUN apt-get update && apt-get install -y \
    fonts-noto-cjk \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 7860
CMD ["node", "server.js"]
