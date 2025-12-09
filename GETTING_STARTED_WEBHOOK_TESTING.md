# Getting Started with Webhook Testing

## 🎯 Quick Start

### Step 1: Access Swagger UI

**Local Development:**
```
http://localhost:3000/docs
```

**Production (Railway):**
```
https://your-railway-app.railway.app/docs
```

### Step 2: Authenticate

1. Click the **"Authorize"** button (🔓 icon) at the top right of Swagger UI
2. Enter your credentials:
   - **Username:** Your `WEBHOOK_USERNAME` environment variable
   - **Password:** Your `WEBHOOK_PASSWORD` environment variable
3. Click **"Authorize"** then **"Close"**

### Step 3: Try Your First Test

1. Scroll down to **"Admin / Webhooks"** section
2. Find **"POST /admin/simulate-webhook"** (Simulate Webhook Event)
3. Click **"Try it out"**
4. Click **"Execute"** (uses default test event)
5. You should see a `200` response with success message

### Step 4: View the Event

1. Find **"GET /admin/webhook-events"** (View Received Webhook Events)
2. Click **"Try it out"**
3. Click **"Execute"**
4. You should see your test event in the response!

**🎉 Congratulations!** You've just simulated and viewed your first webhook event.

---

## 📚 What You Can Do

### 1. Monitor Real Webhooks from Alis

Once Alis starts sending webhooks, you can see them in real-time:

```
GET /admin/webhook-events
```

**Useful filters:**
- `?status=processed` - See successfully processed events
- `?status=failed` - Find events that failed
- `?eventType=residents.move_in` - Filter by event type
- `?limit=10` - Show only 10 most recent

### 2. Test Without Alis

Simulate webhook events for testing:

```
POST /admin/simulate-webhook
```

**Example: Test a move-in event**
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

### 3. Debug Specific Events

Get detailed information about any event:

```
GET /admin/webhook-events/{eventMessageId}
```

View:
- Complete payload
- Processing timestamps
- Error messages (if failed)
- Company information

---

## 🔍 Common Scenarios

### Scenario 1: Verify Alis Integration

**Goal:** Confirm Alis can send webhooks to your system

**Steps:**
1. Ask Alis to send a `test.event`
2. Check `/admin/webhook-events` in Swagger UI
3. Look for the event with `status: "ignored"` (test events are acknowledged but not processed)
4. Verify `receivedAt` timestamp is recent

**Success Criteria:**
- ✅ Event appears in the list
- ✅ Status is `ignored` or `test_acknowledged`
- ✅ No error messages

### Scenario 2: Test Event Processing

**Goal:** Verify your system processes events correctly

**Steps:**
1. Use `/admin/simulate-webhook` to create a test event
2. Send a `residents.move_in` event with a valid `ResidentId`
3. Check `/admin/webhook-events` to see the event
4. Verify status changes from `received` → `queued` → `processed`

**Success Criteria:**
- ✅ Event status is `processed`
- ✅ `processedAt` timestamp is set
- ✅ No error messages

### Scenario 3: Debug Failed Events

**Goal:** Find and fix processing errors

**Steps:**
1. Check `/admin/webhook-events?status=failed`
2. Find failed events
3. Click on an event to see details
4. Check the `error` field for error message
5. Inspect the `payload` to see what was sent

**Common Issues:**
- Invalid `ResidentId` (resident doesn't exist in Alis)
- ALIS API credentials incorrect
- Network connectivity issues
- Caspio API errors

---

## 📊 Understanding Event Statuses

| Status | What It Means | Action Needed |
|--------|---------------|---------------|
| `received` | Just arrived, not queued yet | None - normal state |
| `queued` | Added to processing queue | None - will process soon |
| `processed` | ✅ Successfully completed | None - all good! |
| `failed` | ❌ Processing error | Check error message |
| `ignored` | Acknowledged but not processed | None - expected for test events |

---

## 🧪 Test Event Examples

### Basic Test Event
```json
{
  "eventType": "test.event"
}
```
**Result:** Acknowledged but not processed (status: `ignored`)

### Move-In Event
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
**Result:** Fetches resident data and syncs to Caspio

### Leave Start Event
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
**Result:** Updates resident leave status in Caspio

### Leave End Event
```json
{
  "eventType": "residents.leave_end",
  "companyKey": "appstoresandbox",
  "communityId": 123,
  "notificationData": {
    "ResidentId": 12345,
    "LeaveId": 789
  }
}
```
**Result:** Marks leave as ended in Caspio

---

## 🚨 Troubleshooting

### Problem: Can't Access Swagger UI

**Check:**
1. Is the server running? `npm run dev` (local) or check Railway logs
2. Is the URL correct? `/docs` not `/swagger`
3. Try the health endpoint first: `/health`

### Problem: Authentication Fails

**Check:**
1. Are credentials correct? Check your `.env` file
2. `WEBHOOK_USERNAME` and `WEBHOOK_PASSWORD` must be set
3. Try encoding manually: `echo -n 'user:pass' | base64`

### Problem: No Events Showing

**Check:**
1. Have any webhooks been received? Try simulating one first
2. Check database connection: `/health/deps`
3. Review logs for errors

### Problem: Events Stuck in "Queued"

**Check:**
1. Is Redis running? Check `/health/deps`
2. Is the worker running? Should start automatically
3. Check logs for worker errors: `railway logs` or local console

### Problem: Events Failing

**Check:**
1. Look at the `error` field in event details
2. Common causes:
   - ALIS API credentials wrong
   - Resident doesn't exist
   - Network issues
   - Caspio API errors
3. Test ALIS connectivity: `/admin/test-communities`

---

## 🔗 Related Endpoints

### Health Checks
- `GET /health` - Basic health check
- `GET /health/deps` - Check ALIS, database, Redis

### ALIS API Testing
- `GET /admin/test-communities` - List communities
- `GET /admin/test-resident/{id}` - Get resident details
- `GET /admin/test-leaves/{id}` - Get resident leaves
- `GET /admin/list-residents` - List all residents

### Webhook Endpoints
- `POST /webhook/alis` - The actual webhook (for Alis to call)
- `GET /admin/webhook-events` - View all events
- `GET /admin/webhook-events/{id}` - Get event details
- `POST /admin/simulate-webhook` - Simulate an event

---

## 📖 Documentation Files

- **WEBHOOK_TESTING.md** - Complete guide with detailed examples
- **WEBHOOK_QUICK_REFERENCE.md** - Quick reference card
- **WEBHOOK_TESTING_SUMMARY.md** - Implementation overview
- **docs/webhook-flow-diagram.md** - Visual flow diagrams
- **GETTING_STARTED_WEBHOOK_TESTING.md** - This file

---

## 🎓 Learning Path

### Day 1: Basics
1. ✅ Access Swagger UI
2. ✅ Authenticate
3. ✅ Simulate a test event
4. ✅ View the event in the list

### Day 2: Real Integration
1. ✅ Provide webhook URL to Alis
2. ✅ Ask Alis to send test event
3. ✅ Verify event arrives
4. ✅ Test with real event

### Day 3: Monitoring
1. ✅ Check for failed events
2. ✅ Monitor processing times
3. ✅ Set up regular checks
4. ✅ Document any issues

### Ongoing: Production
1. ✅ Monitor daily for failures
2. ✅ Track event volume
3. ✅ Investigate anomalies
4. ✅ Keep documentation updated

---

## 💡 Pro Tips

1. **Bookmark Swagger UI** - You'll use it often
2. **Use Filters** - Makes finding events much faster
3. **Check Logs** - Railway logs show detailed processing info
4. **Test Locally First** - Easier to debug than in production
5. **Document Patterns** - Note common event structures from Alis
6. **Keep Credentials Safe** - Never commit to version control

---

## ✅ Checklist: Ready for Alis Integration

Before asking Alis to start sending webhooks:

- [ ] Swagger UI accessible and working
- [ ] Can authenticate successfully
- [ ] Can simulate test events
- [ ] Events appear in webhook viewer
- [ ] Events process successfully (status: `processed`)
- [ ] Health endpoints show all systems OK (`/health/deps`)
- [ ] Tested with different event types
- [ ] Documented webhook URL and credentials for Alis
- [ ] Verified IP allowlist (if configured)
- [ ] Tested on production (Railway)

---

## 🚀 Next Steps

1. **Test locally** - Run through all scenarios
2. **Deploy to Railway** - Push your code
3. **Verify in production** - Test all endpoints
4. **Contact Alis** - Provide webhook details
5. **Monitor closely** - Watch first few events
6. **Celebrate** - You've built a robust webhook system! 🎉

---

**Need Help?**

- Check the other documentation files
- Review Swagger UI for endpoint details
- Check Railway logs: `railway logs`
- Test health endpoints: `/health/deps`
- Inspect event payloads for clues

**You're ready to go!** Start with Swagger UI and work through the scenarios above. Good luck! 🚀

