FROM node:20-bullseye

WORKDIR /app

# Install system dependencies for Playwright Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libdbus-1-3 libxkbcommon0 libatspi2.0-0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
    libpango-1.0-0 libcairo2 libasound2 libwayland-client0 \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDeps for tsc)
# NODE_ENV can be 'production' at Railway level, override for build step
RUN NODE_ENV=development npm install

# Copy source files
COPY . .

# Compile TypeScript to JavaScript
RUN npx tsc

# Install Playwright Chromium browser
RUN npx playwright install chromium

# Prune devDependencies for smaller image
RUN npm prune --production

# Force Playwright to use the default cache path (not /tmp from .env)
ENV PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright

EXPOSE 3001

CMD ["node", "server.js"]
