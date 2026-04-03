FROM node:18-bullseye

# Install required dependencies for Chromium
RUN apt-get update && apt-get install -y \
  chromium \
  libnspr4 \
  libnss3 \
  libatk-bridge2.0-0 \
  libx11-xcb1 \
  libxcomposite1 \
  libxrandr2 \
  libgbm1 \
  libgtk-3-0 \
  libasound2 \
  libxdamage1 \
  libxfixes3 \
  libxshmfence1 \
  libdrm2 \
  fonts-liberation \
  ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY . .

RUN npm install

CMD ["node", "scraper2.js"]
