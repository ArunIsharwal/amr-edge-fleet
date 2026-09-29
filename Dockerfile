FROM nginx:alpine

WORKDIR /app

# Copy statically compiled Go binary
COPY bin/amr-fleet /app/amr-fleet

# Copy Nginx config & entrypoint script
COPY nginx.conf /etc/nginx/nginx.conf
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Only port 8080 (the Gateway) is exposed
EXPOSE 8080

ENTRYPOINT ["/app/entrypoint.sh"]
