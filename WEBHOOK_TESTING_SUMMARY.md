# Webhook Testing Implementation Summary

## ✅ What's Been Implemented

Your EWL-EHR system now has comprehensive webhook testing and monitoring capabilities!

### New Features

#### 1. **Webhook Event Viewer** (`GET /admin/webhook-events`)
- View all webhook events received from Alis
- Filter by status (received, queued, processed, failed, ignored)
- Filter by event type (move_in, move_out, leave_start, etc.)
- Limit results (default: 50 most recent)
- See summary statistics by status
- View complete event payloads

#### 2. **Event Detail Inspector** (`GET /admin/webhook-events/{eventMessageId}`)
- Get detailed information about a specific webhook event
- View complete payload data
- See processing timestamps
- Check error messages if processing failed
- View associated company information

#### 3. **Webhook Simulator** (`POST /admin/simulate-webhook`)
- Manually trigger test webhook events
- Customize event type, company key, community ID
- Add custom notification data
- Test webhook processing without waiting for real events
- Perfect for development and debugging

### Integration Points

All three endpoints are:
- ✅ Protected with Basic Authentication (same as webhook endpoint)
- ✅ Documented in Swagger UI at `/docs`
- ✅ Available in both local development and production
- ✅ Fully typed with TypeScript
- ✅ Logged for debugging
- ✅ Error-handled with proper HTTP status codes

## 🎯 Use Cases

### During Initial Integration with Alis

1. **Verify Webhook Delivery:**
   - Ask Alis to send a test event
   - Check `/admin/webhook-events` to confirm receipt
   - Verify authentication is working

2. **Test Event Processing:**
   - Use `/admin/simulate-webhook` to test different event types
   - Verify events are queued and processed correctly
   - Check for any processing errors

3. **Debug Issues:**
   - Use event viewer to see exact payloads from Alis
   - Check error messages for failed events
   - Verify event structure matches expectations

### During Development

1. **Test Without External Dependencies:**
   - Simulate events locally without Alis
   - Test edge cases and error handling
   - Verify queue processing works correctly

2. **Monitor Processing:**
   - Watch events move through statuses
   - Verify processing times are acceptable
   - Check for any bottlenecks

### In Production

1. **Monitor Webhook Health:**
   - Regularly check for failed events
   - Monitor processing times
   - Track event volume and patterns

2. **Troubleshoot Issues:**
   - Quickly find and inspect problematic events
   - View complete payloads for debugging
   - Check error messages and stack traces

## 📊 How It Works

### Event Flow

```
1. Alis sends webhook → POST /webhook/alis
2. Event validated and saved to database (status: "received")
3. Event added to Redis queue (status: "queued")
4. Worker processes event (status: "processed" or "failed")
5. View in admin panel → GET /admin/webhook-events
```

### Database Storage

All webhook events are stored in the `EventLog` table with:
- `eventMessageId` - Unique ID from Alis
- `eventType` - Type of event
- `status` - Current processing status
- `payload` - Complete webhook payload
- `receivedAt` - When webhook was received
- `processedAt` - When processing completed
- `error` - Error message if processing failed
- `companyId` - Associated company
- `communityId` - Associated community (if applicable)

### Idempotency

The system automatically handles duplicate events:
- Events are deduplicated by `eventMessageId`
- Duplicate events return 200 status
- Original event is preserved in database

## 🔐 Security

All admin endpoints require:
- **Basic Authentication** using `WEBHOOK_USERNAME` and `WEBHOOK_PASSWORD`
- Same credentials as the webhook endpoint
- Configured via environment variables

The webhook endpoint (`/webhook/alis`) additionally requires:
- **IP Allowlist** (if `WEBHOOK_ALLOWED_IPS` is configured)
- Protects against unauthorized webhook submissions

## 📱 Access Methods

### 1. Swagger UI (Recommended for Testing)
- Navigate to `/docs`
- Click "Authorize" button
- Enter webhook credentials
- Try out endpoints interactively
- See request/response examples

### 2. cURL (Command Line)
```bash
curl -X GET "https://your-app.railway.app/admin/webhook-events" \
  -H "Authorization: Basic $(echo -n 'username:password' | base64)"
```

### 3. PowerShell (Windows)
```powershell
$pair = "username:password"
$encodedCreds = [System.Convert]::ToBase64String([System.Text.Encoding]::ASCII.GetBytes($pair))
$headers = @{ "Authorization" = "Basic $encodedCreds" }
Invoke-RestMethod -Uri "https://your-app.railway.app/admin/webhook-events" -Headers $headers
```

### 4. HTTP Client (Postman, Insomnia, etc.)
- Method: GET
- URL: `https://your-app.railway.app/admin/webhook-events`
- Auth: Basic Auth with webhook credentials

## 📖 Documentation

Three documentation files have been created:

1. **WEBHOOK_TESTING.md** - Complete guide with examples and troubleshooting
2. **WEBHOOK_QUICK_REFERENCE.md** - Quick reference card for common tasks
3. **WEBHOOK_TESTING_SUMMARY.md** - This file, overview and implementation details

## 🚀 Next Steps

### Immediate Actions

1. **Test Locally:**
   ```bash
   npm run dev
   # Visit http://localhost:3000/docs
   # Try simulating a webhook event
   ```

2. **Deploy to Railway:**
   ```bash
   git add .
   git commit -m "Add webhook testing and monitoring endpoints"
   git push
   # Railway will auto-deploy
   ```

3. **Verify in Production:**
   - Visit `https://your-app.railway.app/docs`
   - Test authentication
   - Simulate a test event
   - Verify it appears in event viewer

### Integration with Alis

1. **Provide Webhook Details:**
   - URL: `https://your-app.railway.app/webhook/alis`
   - Auth: Basic (username/password from env vars)
   - IP Allowlist: (if configured)

2. **Request Test Event:**
   - Ask Alis to send a `test.event`
   - Monitor in `/admin/webhook-events`
   - Verify receipt and processing

3. **Test Real Events:**
   - Ask Alis to trigger a real event (e.g., update a resident)
   - Monitor processing in real-time
   - Verify data flows correctly to your system

### Ongoing Monitoring

1. **Set Up Regular Checks:**
   - Monitor failed events daily
   - Check processing times weekly
   - Review event volume trends

2. **Create Alerts (Optional):**
   - Set up monitoring for failed events
   - Alert on processing delays
   - Track webhook availability

3. **Document Patterns:**
   - Note common event types
   - Document any edge cases
   - Keep track of Alis behavior

## 🛠️ Technical Details

### Files Modified

1. **src/http/routes.ts**
   - Added 3 new admin endpoints
   - Integrated with existing auth middleware
   - Added proper error handling

2. **src/docs/openapi.ts**
   - Added OpenAPI documentation for new endpoints
   - Included request/response examples
   - Tagged endpoints for organization

### Dependencies Used

- **Express** - HTTP routing
- **Prisma** - Database queries
- **Zod** - Validation (existing webhook schema)
- **Swagger UI** - API documentation

### No Breaking Changes

- All existing functionality preserved
- No changes to webhook endpoint behavior
- No database migrations required
- Backward compatible with existing code

## 💡 Tips & Best Practices

1. **Start with Simulation:** Test with simulated events before asking Alis to send real ones
2. **Monitor Actively:** Check the dashboard frequently during initial integration
3. **Use Filters:** Filter by status or event type to find issues quickly
4. **Check Payloads:** Always inspect the full payload when debugging
5. **Keep Credentials Safe:** Never commit webhook credentials to version control
6. **Document Issues:** When events fail, save the payload and error for reference
7. **Test Edge Cases:** Simulate various event types and data combinations

## 🎉 Benefits

- **Visibility:** See exactly what Alis is sending
- **Debugging:** Quickly identify and fix issues
- **Testing:** Test without external dependencies
- **Monitoring:** Track webhook health in production
- **Documentation:** Self-documenting via Swagger UI
- **Confidence:** Verify integration is working correctly

## 📞 Support

If you need help:

1. Check the documentation files
2. Review Swagger UI for endpoint details
3. Check Railway logs: `railway logs`
4. Verify health endpoints: `/health/deps`
5. Test individual components (ALIS API, database, Redis)

---

**You're all set!** Your webhook testing infrastructure is ready to use. Start by visiting `/docs` and trying out the new endpoints. 🚀

