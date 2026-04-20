# Usar imagen node estándar
FROM node:18-bullseye

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (postinstall installará playwright browsers también)
RUN npm install

# Copy app files
COPY . .

EXPOSE 3001

CMD ["node", "server.js"]