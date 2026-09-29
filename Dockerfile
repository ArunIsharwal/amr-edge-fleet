# ─── Stage 1: Build React Vite Frontend ───
FROM node:24-alpine AS frontend-builder
WORKDIR /app/web

# Install frontend dependencies
COPY web/package*.json ./
RUN npm install

# Copy source and build static bundle into dist/
COPY web/ ./
RUN npm run build

# ─── Stage 2: Production Nginx + Go Nodes Container ───
FROM nginx:alpine

WORKDIR /app

# Copy built React frontend to Nginx default public root
COPY --from=frontend-builder /app/web/dist /usr/share/nginx/html

# Copy statically compiled Go binary
COPY bin/amr-fleet /app/amr-fleet

# Copy Nginx config & entrypoint script
COPY nginx.conf /etc/nginx/nginx.conf
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Render routes public traffic to port 8080
EXPOSE 8080

ENTRYPOINT ["/app/entrypoint.sh"]
