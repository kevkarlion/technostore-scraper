FROM node:20-bullseye

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDeps for tsc)
# NODE_ENV can be 'production' at Railway level, override for build step
RUN NODE_ENV=development npm install

# Copy source files
COPY . .

# Compile TypeScript to JavaScript
RUN npx tsc

# Prune devDependencies for smaller image
RUN npm prune --production

EXPOSE 3001

CMD ["node", "server.js"]