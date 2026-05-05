# ---- Build Stage ----
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (layer caching)
COPY package*.json ./
RUN npm install --omit=dev --prefer-offline

# ---- Production Stage ----
FROM node:20-alpine AS production

# Install wget for health checks
RUN apk add --no-cache wget

WORKDIR /app

# Copy installed modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application source
COPY package*.json ./
COPY src/ ./src/
COPY public/ ./public/

# Create non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# Expose application port
EXPOSE 3000

# Default environment
ENV NODE_ENV=production
ENV API_PORT=3000

CMD ["node", "src/index.js"]
