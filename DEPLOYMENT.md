# Deployment Guide

This guide covers deploying the Avigilon ACC Web Application to production environments.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Local Production Build](#local-production-build)
3. [Cloud Deployment](#cloud-deployment)
4. [Docker Deployment](#docker-deployment)
5. [Security Considerations](#security-considerations)
6. [Monitoring](#monitoring)

## Prerequisites

- Node.js 18+ installed on production server
- ACC Server accessible from production environment
- SSL/TLS certificate for HTTPS
- Firewall configured appropriately
- Process manager (PM2 recommended)

## Local Production Build

### 1. Backend Deployment

```bash
cd backend

# Install production dependencies only
npm install --production

# Set production environment
export NODE_ENV=production

# Use PM2 for process management
npm install -g pm2

# Start with PM2
pm2 start src/index.js --name "avigilon-backend"

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

**Production .env:**
```env
NODE_ENV=production
PORT=3001

ACC_SERVER_URL=http://your-acc-server:8080
ACC_USERNAME=production_user
ACC_PASSWORD=secure_password
ACC_USER_NONCE=your_nonce
ACC_USER_KEY=your_key

ALLOWED_ORIGINS=https://yourdomain.com
```

### 2. Frontend Deployment

```bash
cd frontend

# Build for production
npm run build

# The build output will be in the dist/ folder
```

**Serve with nginx:**

```nginx
server {
    listen 80;
    server_name yourdomain.com;
    
    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # Frontend
    root /path/to/avigilon-app/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # API proxy
    location /api {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

## Cloud Deployment

### AWS Deployment

#### Option 1: EC2 Instance

**1. Launch EC2 Instance:**
- Amazon Linux 2 or Ubuntu
- t3.medium or larger
- Security group allowing ports 80, 443, and 3001

**2. Install dependencies:**
```bash
# Update system
sudo yum update -y  # or sudo apt update

# Install Node.js
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs  # or sudo apt install nodejs

# Install nginx
sudo yum install nginx -y  # or sudo apt install nginx

# Install PM2
sudo npm install -g pm2
```

**3. Deploy application:**
```bash
# Clone or upload your application
scp -r avigilon-app ec2-user@your-instance:/home/ec2-user/

# SSH into instance
ssh ec2-user@your-instance

# Setup backend
cd avigilon-app/backend
npm install --production
pm2 start src/index.js --name avigilon-backend

# Setup frontend with nginx
cd ../frontend
npm install
npm run build
sudo cp -r dist/* /var/www/html/
```

**4. Configure nginx:**
```bash
sudo nano /etc/nginx/conf.d/avigilon.conf
# Add nginx configuration from above
sudo systemctl restart nginx
```

#### Option 2: Elastic Beanstalk

Create `backend/.ebextensions/nodecommand.config`:
```yaml
option_settings:
  aws:elasticbeanstalk:container:nodejs:
    NodeCommand: "node src/index.js"
```

Deploy:
```bash
cd backend
eb init
eb create avigilon-backend-env
eb deploy
```

### Azure Deployment

**Azure App Service:**

```bash
# Login to Azure
az login

# Create resource group
az group create --name avigilon-rg --location eastus

# Create App Service plan
az appservice plan create --name avigilon-plan --resource-group avigilon-rg --sku B1 --is-linux

# Create backend web app
az webapp create --resource-group avigilon-rg --plan avigilon-plan --name avigilon-backend --runtime "NODE|18-lts"

# Deploy backend
cd backend
zip -r deploy.zip .
az webapp deployment source config-zip --resource-group avigilon-rg --name avigilon-backend --src deploy.zip

# Create frontend web app
az webapp create --resource-group avigilon-rg --plan avigilon-plan --name avigilon-frontend --runtime "NODE|18-lts"

# Deploy frontend
cd ../frontend
npm run build
cd dist
zip -r deploy.zip .
az webapp deployment source config-zip --resource-group avigilon-rg --name avigilon-frontend --src deploy.zip
```

### Google Cloud Platform

**App Engine Deployment:**

Create `backend/app.yaml`:
```yaml
runtime: nodejs18
env: standard
instance_class: F2

automatic_scaling:
  target_cpu_utilization: 0.65
  min_instances: 1
  max_instances: 3

env_variables:
  NODE_ENV: 'production'
```

Deploy:
```bash
cd backend
gcloud app deploy
```

## Docker Deployment

### Dockerfile for Backend

Create `backend/Dockerfile`:
```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3001

CMD ["node", "src/index.js"]
```

### Dockerfile for Frontend

Create `frontend/Dockerfile`:
```dockerfile
# Build stage
FROM node:18-alpine as build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Production stage
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
```

### Docker Compose

Create `docker-compose.yml`:
```yaml
version: '3.8'

services:
  backend:
    build: ./backend
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - ACC_SERVER_URL=${ACC_SERVER_URL}
      - ACC_USERNAME=${ACC_USERNAME}
      - ACC_PASSWORD=${ACC_PASSWORD}
      - ACC_USER_NONCE=${ACC_USER_NONCE}
      - ACC_USER_KEY=${ACC_USER_KEY}
    restart: unless-stopped
    networks:
      - avigilon-network

  frontend:
    build: ./frontend
    ports:
      - "80:80"
      - "443:443"
    depends_on:
      - backend
    restart: unless-stopped
    networks:
      - avigilon-network
    volumes:
      - ./ssl:/etc/nginx/ssl:ro

networks:
  avigilon-network:
    driver: bridge
```

Deploy with Docker Compose:
```bash
docker-compose up -d
```

## Security Considerations

### 1. Environment Variables

Never commit `.env` files. Use secure secret management:

**AWS Secrets Manager:**
```bash
aws secretsmanager create-secret --name avigilon/acc-credentials --secret-string file://secrets.json
```

**Azure Key Vault:**
```bash
az keyvault secret set --vault-name avigilon-vault --name acc-credentials --file secrets.json
```

### 2. SSL/TLS Configuration

**Let's Encrypt with Certbot:**
```bash
sudo certbot --nginx -d yourdomain.com
```

**Strong SSL Configuration (nginx):**
```nginx
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers HIGH:!aNULL:!MD5;
ssl_prefer_server_ciphers on;
ssl_session_cache shared:SSL:10m;
ssl_session_timeout 10m;
```

### 3. Firewall Rules

```bash
# Allow only necessary ports
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### 4. Add Authentication

Implement user authentication in production. Example with JWT:

```javascript
// backend/src/middleware/auth.js
import jwt from 'jsonwebtoken';

export const authenticateToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access denied' });
  }
  
  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    res.status(403).json({ error: 'Invalid token' });
  }
};
```

### 5. Rate Limiting Enhancement

Add IP-based rate limiting:
```javascript
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

const limiter = rateLimit({
  store: new RedisStore({
    client: redis,
  }),
  windowMs: 15 * 60 * 1000,
  max: 100,
});
```

## Monitoring

### 1. Application Monitoring with PM2

```bash
# Monitor processes
pm2 monit

# View logs
pm2 logs avigilon-backend

# Setup log rotation
pm2 install pm2-logrotate
```

### 2. Health Checks

**Uptime monitoring:**
```bash
# Add health check endpoint monitoring
curl -f http://localhost:3001/api/health || exit 1
```

### 3. Application Insights

**Azure Application Insights:**
```javascript
import appInsights from 'applicationinsights';

appInsights.setup(process.env.APPINSIGHTS_INSTRUMENTATIONKEY)
  .setAutoDependencyCorrelation(true)
  .setAutoCollectRequests(true)
  .setAutoCollectPerformance(true)
  .setAutoCollectExceptions(true)
  .start();
```

### 4. Logging

**Winston logger:**
```javascript
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});
```

## Performance Optimization

### 1. Enable Compression

```javascript
import compression from 'compression';
app.use(compression());
```

### 2. Caching

**Redis caching:**
```javascript
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

// Cache camera list
async function getCameras() {
  const cached = await redis.get('cameras');
  if (cached) return JSON.parse(cached);
  
  const cameras = await avigilonService.getCameras();
  await redis.setex('cameras', 300, JSON.stringify(cameras));
  return cameras;
}
```

### 3. CDN for Static Assets

Use CloudFront, Azure CDN, or Google Cloud CDN for frontend assets.

## Backup and Disaster Recovery

### Database Backups
If adding a database layer, ensure regular backups:

```bash
# Automated backup script
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
mongodump --out /backup/mongo_$DATE
```

### Configuration Backups
```bash
# Backup environment and configs
tar -czf config_backup_$(date +%Y%m%d).tar.gz backend/.env frontend/.env nginx.conf
```

## Troubleshooting Production Issues

### Check Logs
```bash
# PM2 logs
pm2 logs avigilon-backend

# Nginx logs
sudo tail -f /var/log/nginx/error.log

# System logs
journalctl -u nginx -f
```

### Performance Issues
```bash
# Check resource usage
top
htop

# Check disk space
df -h

# Check memory
free -m
```

### Network Issues
```bash
# Test ACC connectivity
curl -v http://acc-server:8080/api/health

# Check open ports
netstat -tlnp
```

## Maintenance

### Updates
```bash
# Update dependencies
cd backend
npm update

# Check for security vulnerabilities
npm audit
npm audit fix
```

### Scaling
- Use load balancer (AWS ELB, Azure Load Balancer, GCP Load Balancing)
- Implement horizontal scaling with multiple backend instances
- Use Redis for session storage across instances

---

For additional help, consult:
- Main README.md
- API_DOCUMENTATION.md
- Cloud provider documentation
