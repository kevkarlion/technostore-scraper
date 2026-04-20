# Usar imagen con chromium instalado
FROM node:18-bullseye

# Instalar chromium del sistema
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-driver \
    && rm -rf /var/lib/apt/lists/*

# Configurar variables de entorno para Playwright
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (postinstall installará playwright browsers también)
RUN npm install

# Copy app files
COPY . .

EXPOSE 3001

CMD ["node", "server.js"]