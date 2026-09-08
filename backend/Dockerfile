FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy source code
COPY src/ ./src/

# Expose port
EXPOSE 3001

# Start the application
CMD ["node", "src/index.js"]
