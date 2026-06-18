FROM node:20-bullseye

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source files
COPY . .

# Compile TypeScript to JavaScript
RUN npx tsc

EXPOSE 3001

CMD ["node", "server.js"]