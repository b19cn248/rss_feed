# Dockerfile cho RSS Feed Generator Node.js
FROM node:18-alpine

# Thông tin metadata
LABEL maintainer="RSS Feed Generator Team"
LABEL version="2.0.0"
LABEL description="RSS Feed Generator với Social Media Support"

# Cài đặt dependencies cho Puppeteer (nếu cần TikTok scraping)
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Set Puppeteer để sử dụng chromium đã cài
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Tạo app directory
WORKDIR /app

# Copy package files trước để tận dụng Docker layer caching
COPY package*.json ./

# Cài đặt dependencies
# Sử dụng npm ci cho production builds (faster, reliable, reproducible)
RUN npm ci --only=production && npm cache clean --force

# Tạo user non-root cho security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Tạo các thư mục cần thiết và set permissions
RUN mkdir -p logs tmp data && \
    chown -R nodejs:nodejs /app

# Copy source code
COPY --chown=nodejs:nodejs . .

# Switch sang user non-root
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (res) => { \
        process.exit(res.statusCode === 200 ? 0 : 1) \
    }).on('error', () => process.exit(1))"

# Default command
CMD ["npm", "start"]