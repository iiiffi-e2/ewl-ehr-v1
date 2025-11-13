# Webhook Testing Guide

This guide explains how to test and monitor ALIS webhook events in your EWL-EHR integration.

## Overview

The system now includes three new admin endpoints for webhook testing and monitoring:

1. **View Webhook Events** - See all received webhooks
2. **Get Event Details** - Inspect a specific webhook event
3. **Simulate Webhook** - Manually trigger test webhook events

All endpoints are protected with Basic Authentication and available in Swagger UI.

## Quick Start

### Access Swagger UI

1. **Local Development:**
   ```
   http://localhost:3000/docs
   ```

2. **Production (Railway):**
   ```
   https://your-railway-app.railway.app/docs
   ```

3. **Authenticate:**
   - Click the "Authorize" button in Swagger UI
   - Enter your admin credentials (same as webhook auth)
   - Username: `WEBHOOK_USERNAME` from env
   - Password: `WEBHOOK_PASSWORD` from env

## Testing Methods

### Method 1: View Real Webhook Events (Recommended)

Once Alis starts sending webhooks, you can monitor them in real-time.

**Endpoint:** `GET /admin/webhook-events`

**In Swagger UI:**
1. Navigate to the "Admin / Webhooks" section
2. Find "View Received Webhook Events"
3. Click "Try it out"
4. Optionally set filters:
   - `limit`: Number of events to return (default: 50)
   - `status`: Filter by status (received, queued, processed, failed, ignored)
   - `eventType`: Filter by event type (e.g., `residents.move_in`)
5. Click "Execute"

**Example Response:**
```json
{
  "success": true,
  "count": 2,
  "timestamp": "2025-11-13T10:00:00.000Z",
  "summary": [
    { "status": "processed", "count": 15 },
    { "status": "queued", "count": 3 }
  ],
  "events": [
    {
      "id": 1,
      "eventMessageId": "evt_123",
      "eventType": "residents.move_in",
      "status": "processed",
      "companyKey": "appstoresandbox",
      "communityId": 123,
      "receivedAt": "2025-11-13T09:00:00.000Z",
      "processedAt": "2025-11-13T09:00:05.000Z",
      "error": null,
      "payload": {
        "CompanyKey": "appstoresandbox",
        "EventType": "residents.move_in",
        "EventMessageId": "evt_123",
        "NotificationData": { "ResidentId": 456 }
      }
    }
  ]
}
```

**Using cURL:**
```bash
curl -X GET "https://your-app.railway.app/admin/webhook-events?limit=10&status=processed" \
  -H "Authorization: Basic $(echo -n 'username:password' | base64)"
```

### Method 2: Inspect Specific Event Details

Get detailed information about a specific webhook event.

**Endpoint:** `GET /admin/webhook-events/{eventMessageId}`

**In Swagger UI:**
1. Find "Get Webhook Event Details"
2. Click "Try it out"
3. Enter the `eventMessageId` (e.g., `evt_123`)
4. Click "Execute"

**Using cURL:**
```bash
curl -X GET "https://your-app.railway.app/admin/webhook-events/evt_123" \
  -H "Authorization: Basic $(echo -n 'username:password' | base64)"
```

### Method 3: Simulate Webhook Events

Test your webhook processing without waiting for real events from Alis.

**Endpoint:** `POST /admin/simulate-webhook`

**In Swagger UI:**
1. Find "Simulate Webhook Event"
2. Click "Try it out"
3. Customize the request body (or use defaults):
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
4. Click "Execute"

**Example Simulations:**

**Test Event (acknowledged but not processed):**
```json
{
  "eventType": "test.event",
  "companyKey": "TEST_COMPANY"
}
```

**Move-In Event:**
```json
{
  "eventType": "residents.move_in",
  "companyKey": "appstoresandbox",
  "communityId": 123,
  "notificationData": {
    "ResidentId": 12345
  }
}
```

**Leave Start Event:**
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

**Using cURL:**
```bash
curl -X POST "https://your-app.railway.app/admin/simulate-webhook" \
  -H "Authorization: Basic $(echo -n 'username:password' | base64)" \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "residents.move_in",
    "companyKey": "appstoresandbox",
    "communityId": 123,
    "notificationData": {
      "ResidentId": 456
    }
  }'
```

## Monitoring Workflow

### 1. Initial Setup Verification

After giving Alis your webhook URL and credentials:

1. Ask Alis to send a test event
2. Check `/admin/webhook-events` to see if it arrived
3. Verify the event status is `processed` or `test_acknowledged`
4. Check the payload structure matches expectations

### 2. Testing Event Processing

1. Simulate different event types using `/admin/simulate-webhook`
2. Check processing status in `/admin/webhook-events`
3. Verify events are being queued and processed correctly
4. Check for any errors in the `error` field

### 3. Production Monitoring

Once live:

1. Regularly check `/admin/webhook-events?status=failed` for failures
2. Monitor processing times (receivedAt vs processedAt)
3. Use filters to track specific event types
4. Investigate any events with `error` messages

## Event Statuses

- **`received`** - Event just arrived, not yet queued
- **`queued`** - Event added to processing queue
- **`processed`** - Event successfully processed
- **`failed`** - Event processing failed (check `error` field)
- **`ignored`** - Event acknowledged but not processed (e.g., test events, unsupported types)

## Supported Event Types

The system currently supports:

- `residents.move_in` - New resident move-in
- `residents.move_out` - Resident move-out
- `residents.leave_start` - Resident starts temporary leave
- `residents.leave_end` - Resident returns from leave
- `residents.leave_cancelled` - Leave cancelled
- `residents.basic_info_updated` - Resident info updated
- `test.event` - Test event (acknowledged but not processed)

## Troubleshooting

### No Events Showing Up

1. **Check Alis Configuration:**
   - Verify webhook URL is correct
   - Confirm authentication credentials match your env vars
   - Check if IP allowlist is configured correctly

2. **Check Logs:**
   ```bash
   # On Railway
   railway logs
   ```

3. **Test Authentication:**
   - Try accessing `/admin/webhook-events` directly
   - Verify you can authenticate successfully

### Events Stuck in "Queued" Status

1. Check Redis connection: `GET /health/deps`
2. Verify worker is running (should start automatically)
3. Check logs for worker errors

### Events Failing

1. Check the `error` field in event details
2. Review logs for detailed error messages
3. Verify ALIS API credentials are correct
4. Test ALIS connectivity: `GET /admin/test-communities`

## PowerShell Testing Script

For Windows users, here's a PowerShell script to test webhooks:

```powershell
# Set your credentials
$username = "your_webhook_username"
$password = "your_webhook_password"
$baseUrl = "https://your-app.railway.app"

# Create auth header
$pair = "$($username):$($password)"
$encodedCreds = [System.Convert]::ToBase64String([System.Text.Encoding]::ASCII.GetBytes($pair))
$headers = @{
    "Authorization" = "Basic $encodedCreds"
    "Content-Type" = "application/json"
}

# Simulate a webhook
Write-Host "Simulating webhook event..."
$body = @{
    eventType = "residents.move_in"
    companyKey = "appstoresandbox"
    communityId = 123
    notificationData = @{
        ResidentId = 456
    }
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "$baseUrl/admin/simulate-webhook" -Method Post -Headers $headers -Body $body
Write-Host "Response:" -ForegroundColor Green
$response | ConvertTo-Json -Depth 10

# View recent events
Write-Host "`nFetching recent webhook events..."
$events = Invoke-RestMethod -Uri "$baseUrl/admin/webhook-events?limit=5" -Method Get -Headers $headers
Write-Host "Recent Events:" -ForegroundColor Green
$events | ConvertTo-Json -Depth 10
```

Save as `test-webhooks.ps1` and run:
```powershell
.\test-webhooks.ps1
```

## Integration with Alis

### What to Share with Alis

Provide Alis with:

1. **Webhook URL:**
   ```
   https://your-app.railway.app/webhook/alis
   ```

2. **Authentication:**
   - Type: Basic Auth
   - Username: (from your `WEBHOOK_USERNAME` env var)
   - Password: (from your `WEBHOOK_PASSWORD` env var)

3. **IP Allowlist (if required):**
   - Check your `WEBHOOK_ALLOWED_IPS` env var
   - Provide this list to Alis

### Testing with Alis

1. Ask Alis to send a `test.event` first
2. Verify it appears in `/admin/webhook-events`
3. Ask them to trigger a real event (e.g., update a resident)
4. Monitor the event processing
5. Confirm data appears correctly in your system

## Best Practices

1. **Start with Test Events:** Always test with `test.event` first
2. **Monitor Regularly:** Check webhook events dashboard daily during initial integration
3. **Set Up Alerts:** Consider monitoring failed events and setting up notifications
4. **Keep Logs:** Railway logs are retained for a limited time; export important events
5. **Document Issues:** When events fail, document the payload and error for debugging

## Additional Resources

- **API Documentation:** Visit `/docs` for full Swagger documentation
- **Health Check:** `GET /health/deps` to verify all systems are operational
- **ALIS API Testing:** Use `/admin/test-communities` to verify ALIS connectivity

## Support

If you encounter issues:

1. Check the logs on Railway: `railway logs`
2. Verify environment variables are set correctly
3. Test individual components (database, Redis, ALIS API) via health endpoints
4. Review the event payload and error messages in webhook events viewer

