# Multi-stage Dockerfile for production
# Uses Node 20 (matching package.json engines)

#############################
# Builder
#############################
FROM node:20-bullseye-slim AS builder

# Install build tools and libraries required by native modules (sharp, puppeteer deps)
RUN apt-get update && apt-get install -y --no-install-recommends \
  build-essential python3 make g++ \
  ca-certificates libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libvips-dev \
  libjpeg-dev libpng-dev libwebp-dev \
  fonts-liberation libnss3 libxss1 libasound2 libatk-bridge2.0-0 libgtk-3-0 libx11-6 libdbus-1-3 libgbm1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package manifests first for better caching
COPY package.json package-lock.json* ./

# Install all dependencies (including dev deps) to compile native modules
RUN npm install --unsafe-perm --prefer-offline

# Copy source
COPY . .

# Prune devDependencies to keep only production deps in node_modules
RUN npm prune --production

#############################
# Production image
#############################
FROM node:20-bullseye-slim

# Install runtime libs required by sharp/puppeteer
RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates libcairo2 libpango-1.0-0 libpangocairo-1.0-0 \
  libjpeg-dev libpng-dev libwebp-dev libvips-dev fonts-liberation libnss3 libxss1 libasound2 libatk-bridge2.0-0 libgtk-3-0 libx11-6 libdbus-1-3 libgbm1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN mkdir public

# Create app user
RUN useradd --user-group --create-home --home-dir /app appuser || true

# Copy package files
COPY package.json ./

# Copy node_modules from builder (production only)
COPY --from=builder /app/node_modules ./node_modules

# Copy app source
COPY --from=builder /app .

# Set ownership
RUN chown -R appuser:appuser /app

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

USER appuser

# Start the server
CMD ["node", "server.js"]
