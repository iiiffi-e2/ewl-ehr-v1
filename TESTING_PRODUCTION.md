# Testing Communities API in Production

## Secure Test Endpoint

A temporary secure endpoint has been added to test the ALIS Communities API in production environments.

### Endpoint Details

**URL:** `GET /admin/test-communities`

**Authentication:** BasicAuth (same credentials as webhook endpoint)
- Username: `WEBHOOK_BASIC_USER` 
- Password: `WEBHOOK_BASIC_PASS`

**Security:** This endpoint is protected with the same authentication middleware as the webhook endpoint, ensuring only authorized users can access it.

---

## Testing in Production

### Using curl

```bash
# Replace with your production URL and BasicAuth credentials
curl -X GET https://your-production-url.com/admin/test-communities \
  -u "your-webhook-user:your-webhook-password" \
  -H "Accept: application/json"
```

### Using HTTPie

```bash
http GET https://your-production-url.com/admin/test-communities \
  -a your-webhook-user:your-webhook-password
```

### Using Postman

1. Create a new GET request to: `https://your-production-url.com/admin/test-communities`
2. Go to the **Authorization** tab
3. Select **Basic Auth** type
4. Enter your `WEBHOOK_BASIC_USER` and `WEBHOOK_BASIC_PASS`
5. Click **Send**

### Using JavaScript/fetch

```javascript
const username = 'your-webhook-user';
const password = 'your-webhook-password';
const credentials = btoa(`${username}:${password}`);

fetch('https://your-production-url.com/admin/test-communities', {
  headers: {
    'Authorization': `Basic ${credentials}`,
    'Accept': 'application/json'
  }
})
  .then(res => res.json())
  .then(data => console.log(data))
  .catch(err => console.error(err));
```

---

## Response Format

### Success Response (200 OK)

```json
{
  "success": true,
  "count": 3,
  "timestamp": "2025-11-10T12:34:56.789Z",
  "communities": [
    {
      "id": 123,
      "name": "Sunset Senior Living",
      "companyKey": "appstoresandbox",
      "address": "123 Main St",
      "city": "Springfield",
      "state": "IL",
      "zipCode": "62701",
      "phone": "555-0123"
    },
    {
      "id": 456,
      "name": "Green Valley Care Center",
      "companyKey": "appstoresandbox",
      "address": "456 Oak Ave",
      "city": "Portland",
      "state": "OR",
      "zipCode": "97201",
      "phone": "555-0456"
    }
  ]
}
```

### Error Response (500 Internal Server Error)

```json
{
  "success": false,
  "error": "Unauthorized to call ALIS API (401)",
  "timestamp": "2025-11-10T12:34:56.789Z"
}
```

### Authentication Error (401 Unauthorized)

```json
{
  "error": "Unauthorized"
}
```

---

## What Gets Logged

The endpoint logs structured data for debugging:

**On success:**
```json
{
  "level": "info",
  "msg": "test_communities_success",
  "count": 3,
  "communities": [
    { "id": 123, "name": "Sunset Senior Living", "companyKey": "appstoresandbox" }
  ]
}
```

**On failure:**
```json
{
  "level": "error",
  "msg": "test_communities_failed",
  "error": "Error details here"
}
```

---

## Testing Checklist

When testing in production, verify:

- ✅ **Authentication works** - 401 without credentials, 200 with valid credentials
- ✅ **Communities are returned** - At least one community in the response
- ✅ **Data is correct** - Community names, IDs match expected values
- ✅ **Response time** - Should complete within 2-3 seconds
- ✅ **Logs appear** - Check production logs for `admin_test_communities_called`
- ✅ **No errors** - Check logs for `test_communities_failed`

---

## Security Notes

⚠️ **Important Security Considerations:**

1. **Uses existing BasicAuth** - No new credentials needed, uses `WEBHOOK_BASIC_USER/PASS`
2. **Requires authentication** - Cannot be accessed without valid credentials
3. **Logs all access** - Every call is logged with structured logging
4. **Read-only operation** - Only fetches data, doesn't modify anything
5. **Temporary endpoint** - Should be removed after production verification

---

## Removing the Test Endpoint

Once you've verified the Communities API works in production, you should remove this endpoint:

1. Open `src/http/routes.ts`
2. Remove the entire `router.get('/admin/test-communities', ...)` block (lines ~34-84)
3. Commit and deploy the changes

Or keep it if you want ongoing monitoring capability (it's secure and well-logged).

---

## Troubleshooting

### 401 Unauthorized
**Problem:** Request returns 401 even with credentials

**Solutions:**
- Verify you're using the correct `WEBHOOK_BASIC_USER` and `WEBHOOK_BASIC_PASS`
- Check credentials in your production environment variables
- Ensure credentials don't contain special characters that need URL encoding

### 500 Internal Server Error with ALIS API error
**Problem:** "Unauthorized to call ALIS API (401)"

**Solutions:**
- Verify `ALIS_TEST_USERNAME` and `ALIS_TEST_PASSWORD` are set correctly in production
- Ensure you're using production ALIS credentials, not sandbox (if applicable)
- Check if ALIS credentials have expired or need renewal

### Connection timeout
**Problem:** Request times out or takes very long

**Solutions:**
- Verify production server can reach `ALIS_API_BASE`
- Check firewall rules allow outbound HTTPS
- Verify ALIS API is responding (check ALIS status page)

### Empty communities array
**Problem:** `"count": 0, "communities": []`

**Solutions:**
- This may be expected if your account has no communities
- Verify you're using the correct ALIS account credentials
- Check with ALIS support if communities should exist

---

## Example Production Test Session

```bash
# 1. Test without credentials (should fail with 401)
$ curl https://your-app.com/admin/test-communities
{"error":"Unauthorized"}

# 2. Test with valid credentials (should succeed)
$ curl -u "webhook-user:webhook-pass" https://your-app.com/admin/test-communities
{
  "success": true,
  "count": 2,
  "timestamp": "2025-11-10T15:30:00.000Z",
  "communities": [...]
}

# 3. Check production logs for confirmation
$ heroku logs --tail -a your-app
[info] admin_test_communities_called
[info] test_communities_success {"count":2,"communities":[...]}
```

---

## Next Steps After Testing

Once you've successfully tested:

1. ✅ Verify communities data is correct
2. ✅ Document any production-specific findings
3. ✅ Share results with team
4. ✅ Decide whether to keep or remove the test endpoint
5. ✅ Update monitoring/alerting if needed
6. ✅ Consider adding communities data to your workflow

---

## Support

If you encounter issues:
1. Check production logs first
2. Verify all environment variables are set
3. Test the health endpoint: `GET /health/deps`
4. Review ALIS API documentation
5. Contact ALIS support if API issues persist

