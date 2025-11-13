# Webhook Testing - Quick Reference

## 🚀 Quick Access

### Swagger UI
- **Local:** http://localhost:3000/docs
- **Production:** https://your-railway-app.railway.app/docs

### Authentication
Use your `WEBHOOK_USERNAME` and `WEBHOOK_PASSWORD` environment variables.

## 📋 Three Main Endpoints

### 1. View All Webhook Events
```
GET /admin/webhook-events
```
**Query Parameters:**
- `limit` - Max events to return (default: 50)
- `status` - Filter by status: received, queued, processed, failed, ignored
- `eventType` - Filter by type: residents.move_in, residents.move_out, etc.

**Example:**
```bash
GET /admin/webhook-events?limit=10&status=processed
```

### 2. Get Specific Event Details
```
GET /admin/webhook-events/{eventMessageId}
```

**Example:**
```bash
GET /admin/webhook-events/evt_123
```

### 3. Simulate Webhook Event
```
POST /admin/simulate-webhook
```

**Example Body:**
```json
{
  "eventType": "residents.move_in",
  "companyKey": "appstoresandbox",
  "communityId": 123,
  "notificationData": {
    "ResidentId": 456
  }
}
```

## 🔍 Event Statuses

| Status | Meaning |
|--------|---------|
| `received` | Just arrived, not queued yet |
| `queued` | Added to processing queue |
| `processed` | Successfully processed ✅ |
| `failed` | Processing failed ❌ |
| `ignored` | Acknowledged but not processed (test events) |

## 📝 Supported Event Types

- `residents.move_in`
- `residents.move_out`
- `residents.leave_start`
- `residents.leave_end`
- `residents.leave_cancelled`
- `residents.basic_info_updated`
- `test.event`

## 🧪 Common Test Scenarios

### Test Event (No Processing)
```json
{
  "eventType": "test.event"
}
```

### Move-In Event
```json
{
  "eventType": "residents.move_in",
  "companyKey": "appstoresandbox",
  "communityId": 123,
  "notificationData": { "ResidentId": 12345 }
}
```

### Leave Event
```json
{
  "eventType": "residents.leave_start",
  "companyKey": "appstoresandbox",
  "communityId": 123,
  "notificationData": { 
    "ResidentId": 12345,
    "LeaveId": 789
  }
}
```

## 🔧 Quick Troubleshooting

### No events showing?
1. Check `/health/deps` - verify all systems are up
2. Verify webhook URL with Alis
3. Check authentication credentials
4. Review IP allowlist

### Events stuck in "queued"?
1. Check Redis connection: `/health/deps`
2. Check logs: `railway logs`
3. Verify worker is running

### Events failing?
1. Check the `error` field in event details
2. Review logs for stack traces
3. Test ALIS API: `/admin/test-communities`

## 💡 Pro Tips

1. **Start Simple:** Use `test.event` first
2. **Monitor Actively:** Check dashboard during initial integration
3. **Filter Smart:** Use status filters to find issues quickly
4. **Check Payload:** Always inspect the full payload for debugging

## 🔗 Related Endpoints

- `/health` - Basic health check
- `/health/deps` - Check ALIS, database, Redis
- `/admin/test-communities` - Test ALIS API connectivity
- `/admin/test-resident/{id}` - Test resident data retrieval
- `/webhook/alis` - The actual webhook endpoint (for Alis to call)

## 📞 What to Give Alis

**Webhook URL:**
```
https://your-railway-app.railway.app/webhook/alis
```

**Auth Type:** Basic Authentication

**Credentials:** Your `WEBHOOK_USERNAME` and `WEBHOOK_PASSWORD`

**IP Allowlist:** (if configured) Your `WEBHOOK_ALLOWED_IPS` value

---

For detailed documentation, see [WEBHOOK_TESTING.md](./WEBHOOK_TESTING.md)

