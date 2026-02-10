FROM --platform=linux/amd64 oven/bun:1

# Install system deps (Chromium + Xvfb)
RUN apt-get update && apt-get install -y --fix-missing \
    wget \
    gnupg \
    ca-certificates \
    apt-transport-https \
    chromium \
    chromium-driver \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

# Chromium path for Puppeteer / Playwright / chrome-launcher
ENV CHROME_BIN=/usr/bin/chromium

WORKDIR /app

# Copy ONLY dependency files first (better Docker cache)
COPY package.json bun.lockb* ./

# Install deps using Bun
RUN bun install --frozen-lockfile

# Copy app source
COPY . .

# Start app
CMD ["bun", "src/index.ts"]
