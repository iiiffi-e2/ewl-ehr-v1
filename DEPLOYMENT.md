# Deployment Guide

This guide covers deploying the ALIS → EyeWatch LIVE® Integration Service to production environments.

---

## Database Migrations

### Overview

The application uses Prisma ORM with PostgreSQL in production. Database migrations must be run before starting the application to ensure the schema is up-to-date.

### Migration Scripts

The following npm scripts are available for managing migrations:

| Script | Command | Purpose |
|--------|---------|---------|
| `prisma:migrate` | `prisma migrate deploy` | Apply pending migrations (production) |
| `prisma:migrate:dev` | `prisma migrate dev` | Create and apply migrations (development) |
| `prisma:generate` | `prisma generate` | Regenerate Prisma Client |
| `deploy` | `prisma migrate deploy && npm start` | Run migrations + start HTTP server |
| `deploy:worker` | `prisma migrate deploy && npm run worker` | Run migrations + start worker |

### Automatic Migration on Deploy

#### Option A: Using the `deploy` Script (Recommended)

The `deploy` script automatically runs migrations before starting the application:

```bash
npm run build
npm run deploy
```

For the worker process:

```bash
npm run build
npm run deploy:worker
```

#### Option B: Docker Deployment

The Dockerfile is configured to automatically run migrations on container startup:

```bash
docker build -t alis-eyewatch .
docker run -p 8080:8080 --env-file ./.env alis-eyewatch
```

The container will:
1. Run `npx prisma migrate deploy` to apply pending migrations
2. Start the application with `node dist/http/server.js`

#### Option C: Manual Migration

If you prefer to run migrations separately:

```bash
# Build the application
npm run build

# Run migrations
npm run prisma:migrate

# Start the application
npm start
```

---

## Platform-Specific Deployment

### Render.com

1. **Create a new Web Service**
   - Connect your Git repository
   - Select Docker as the environment

2. **Configure Build Settings**
   - **Build Command:** `npm run build`
   - **Start Command:** `npm run deploy`
   
   Or if using Docker:
   - Leave build/start commands empty (Dockerfile will handle it)

3. **Environment Variables**
   Set all required environment variables in the Render dashboard:
   - `DATABASE_URL` - PostgreSQL connection string (use Render PostgreSQL)
   - `REDIS_URL` - Redis connection string (use Render Redis)
   - `NODE_ENV=production`
   - All other variables from `.env.example`

4. **Add Worker Service** (for BullMQ)
   - Create a Background Worker service
   - **Build Command:** `npm run build`
   - **Start Command:** `npm run deploy:worker`

### Railway

1. **Create a new Project**
   - Connect your Git repository
   - Railway will auto-detect the Dockerfile

2. **Add PostgreSQL and Redis**
   - Add PostgreSQL plugin
   - Add Redis plugin
   - Railway will automatically set `DATABASE_URL` and `REDIS_URL`

3. **Configure Service**
   - **Build Command:** (leave empty, Docker handles it)
   - **Start Command:** (leave empty, Docker handles it)
   
   Or for non-Docker deployment:
   - **Build Command:** `npm run build`
   - **Start Command:** `npm run deploy`

4. **Environment Variables**
   Set all required variables in Railway dashboard

5. **Add Worker Service**
   - Duplicate the service
   - Change start command to: `npm run deploy:worker`

### Heroku

1. **Create a new app**
   ```bash
   heroku create your-app-name
   ```

2. **Add PostgreSQL and Redis**
   ```bash
   heroku addons:create heroku-postgresql:mini
   heroku addons:create heroku-redis:mini
   ```

3. **Configure Procfile** (create if not exists)
   ```
   web: npm run deploy
   worker: npm run deploy:worker
   ```

4. **Set Environment Variables**
   ```bash
   heroku config:set NODE_ENV=production
   heroku config:set WEBHOOK_BASIC_USER=your_user
   # ... set all other required variables
   ```

5. **Deploy**
   ```bash
   git push heroku main
   ```

6. **Scale Worker**
   ```bash
   heroku ps:scale worker=1
   ```

### AWS ECS / Fargate

1. **Build and Push Docker Image**
   ```bash
   docker build -t alis-eyewatch .
   docker tag alis-eyewatch:latest <ecr-repo-url>:latest
   docker push <ecr-repo-url>:latest
   ```

2. **Create Task Definition**
   - Use the Docker image from ECR
   - Set environment variables
   - Configure health checks on `/health`

3. **Create Services**
   - Web service: 1+ tasks
   - Worker service: 1+ tasks (different command)

4. **Database Setup**
   - Use RDS PostgreSQL
   - Use ElastiCache Redis
   - Ensure security groups allow connections

### Google Cloud Run

1. **Build and Push to Container Registry**
   ```bash
   gcloud builds submit --tag gcr.io/PROJECT-ID/alis-eyewatch
   ```

2. **Deploy Service**
   ```bash
   gcloud run deploy alis-eyewatch \
     --image gcr.io/PROJECT-ID/alis-eyewatch \
     --platform managed \
     --region us-central1 \
     --allow-unauthenticated \
     --set-env-vars DATABASE_URL=postgresql://...,REDIS_URL=redis://...
   ```

3. **Deploy Worker** (separate service)
   ```bash
   gcloud run deploy alis-eyewatch-worker \
     --image gcr.io/PROJECT-ID/alis-eyewatch \
     --platform managed \
     --region us-central1 \
     --no-allow-unauthenticated \
     --command npm,run,deploy:worker
   ```

---

## Environment Variables Checklist

Before deploying, ensure all required environment variables are set:

### Service Configuration
- [ ] `NODE_ENV=production`
- [ ] `PORT` (default: 8080)
- [ ] `LOG_LEVEL` (default: info)
- [ ] `ENABLE_SWAGGER` (default: false in production)

### Database & Queue
- [ ] `DATABASE_URL` - PostgreSQL connection string
- [ ] `REDIS_URL` - Redis connection string

### Webhook Security
- [ ] `WEBHOOK_BASIC_USER` - BasicAuth username
- [ ] `WEBHOOK_BASIC_PASS` - BasicAuth password
- [ ] `IP_ALLOWLIST` - Comma-separated CIDR ranges (optional)

### ALIS API
- [ ] `ALIS_API_BASE` - ALIS API base URL
- [ ] `ALIS_TEST_USERNAME` - Sandbox/test credentials
- [ ] `ALIS_TEST_PASSWORD` - Sandbox/test credentials

### Caspio Integration
- [ ] `CASPIO_TOKEN_URL` - OAuth token endpoint
- [ ] `CASPIO_CLIENT_ID` - OAuth client ID
- [ ] `CASPIO_CLIENT_SECRET` - OAuth client secret
- [ ] `CASPIO_TABLE_ENDPOINT` - Caspio table REST endpoint
- [ ] `CASPIO_SCOPE` - OAuth scope

### Processing Configuration
- [ ] `WORKER_CONCURRENCY` (default: 5)
- [ ] `REQUEST_TIMEOUT_MS` (default: 30000)

---

## Post-Deployment Verification

### 1. Check Health Endpoints

```bash
# Basic health check
curl https://your-app.com/health

# Dependency health check (DB, Redis, ALIS)
curl https://your-app.com/health/deps
```

### 2. Verify Database Migrations

Check application logs for migration output:
```
✔ Prisma Migrate applied 1 migration(s)
```

Or connect to the database and verify:
```sql
SELECT * FROM "_prisma_migrations" ORDER BY finished_at DESC LIMIT 5;
```

### 3. Test Webhook Endpoint

```bash
curl -X POST https://your-app.com/webhook/alis \
  -u "your_user:your_pass" \
  -H "Content-Type: application/json" \
  -d '{
    "CompanyKey": "test",
    "EventType": "test",
    "EventMessageId": "test-123",
    "Payload": {}
  }'
```

### 4. Monitor Logs

Watch for:
- Successful startup messages
- Database connection confirmation
- Redis connection confirmation
- Worker registration (if applicable)

### 5. Test Worker Processing

Send a real webhook event and verify:
- Event logged in `EventLog` table
- Job queued in Redis
- Worker processes the job
- Event status updated to `processed`

---

## Troubleshooting

### Migration Failures

**Problem:** Migrations fail on startup

**Solutions:**
1. Check `DATABASE_URL` is correct and accessible
2. Verify database user has sufficient permissions
3. Check for conflicting schema changes
4. Review migration files in `prisma/migrations/`

### Connection Issues

**Problem:** Cannot connect to database/Redis

**Solutions:**
1. Verify connection strings are correct
2. Check network/firewall rules
3. Ensure services are in the same VPC/network
4. Test connections manually using `psql` or `redis-cli`

### Worker Not Processing Jobs

**Problem:** Jobs queue but don't process

**Solutions:**
1. Verify worker service is running
2. Check Redis connection in worker logs
3. Verify `REDIS_URL` matches between web and worker
4. Check worker concurrency settings

---

## Rollback Procedure

If a deployment fails:

1. **Revert to previous version**
   ```bash
   git revert HEAD
   git push
   ```

2. **Rollback migrations** (if necessary)
   ```bash
   # Connect to database
   psql $DATABASE_URL
   
   # Check migration history
   SELECT * FROM "_prisma_migrations";
   
   # Manual rollback may be required - restore from backup if critical
   ```

3. **Monitor application**
   - Check health endpoints
   - Review error logs
   - Verify data integrity

---

## Best Practices

1. **Always test migrations** in a staging environment first
2. **Backup database** before deploying schema changes
3. **Use environment-specific configurations** (staging vs production)
4. **Monitor logs** during and after deployment
5. **Set up alerts** for health check failures
6. **Document any manual migration steps** required
7. **Keep migration files** in version control
8. **Never modify applied migrations** - create new ones instead

---

## Support

For issues or questions:
- Check application logs first
- Review this deployment guide
- Consult the main README.md for architecture details
- Check Prisma documentation for migration issues

