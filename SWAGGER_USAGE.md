# Using Swagger UI to Test the Communities API

## Accessing Swagger Documentation

Once deployed, visit your application's `/docs` endpoint:

```
http://localhost:8080/docs          (Local development)
https://your-app.com/docs            (Production)
```

## Testing the Communities Endpoint in Swagger UI

### Step 1: Find the Endpoint

In the Swagger UI, look for the endpoint under the **Admin** or **Testing** tag:

```
GET /admin/test-communities
```

**Summary:** Test ALIS Communities API

**Description:** Tests connectivity to the ALIS Communities API and returns all available communities. Protected with BasicAuth. Useful for verifying production ALIS credentials and exploring community data.

### Step 2: Authorize

Before testing, you need to authenticate:

1. **Click the 🔒 "Authorize" button** at the top right of the Swagger UI
2. A modal will appear asking for credentials
3. **Enter your BasicAuth credentials:**
   - Username: Your `WEBHOOK_BASIC_USER`
   - Password: Your `WEBHOOK_BASIC_PASS`
4. Click **"Authorize"**
5. Click **"Close"**

### Step 3: Try It Out

1. **Click on the endpoint** `GET /admin/test-communities` to expand it
2. **Click the "Try it out" button** (top right of the expanded section)
3. **Click "Execute"**

### Step 4: View Results

Swagger will show you:

- **Request URL** - The actual URL that was called
- **Response Code** - HTTP status code (200, 401, 500)
- **Response Body** - The JSON response with community data
- **Response Headers** - HTTP headers from the response

## Example Responses in Swagger

### ✅ Success (200 OK)

```json
{
  "success": true,
  "count": 2,
  "timestamp": "2025-11-10T15:30:00.000Z",
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

### ❌ Unauthorized (401)

```json
{
  "error": "Unauthorized"
}
```

**Cause:** Invalid BasicAuth credentials or not authorized

**Fix:** Click "Authorize" and enter correct credentials

### ❌ ALIS API Error (500)

```json
{
  "success": false,
  "error": "Unauthorized to call ALIS API (401)",
  "timestamp": "2025-11-10T15:30:00.000Z"
}
```

**Cause:** ALIS credentials are invalid or ALIS API is unreachable

**Fix:** Check `ALIS_TEST_USERNAME` and `ALIS_TEST_PASSWORD` environment variables

## Benefits of Using Swagger UI

### 1. **Interactive Testing**
- No need to write curl commands
- Click "Try it out" and execute requests
- See immediate results

### 2. **Authentication Built-in**
- Swagger handles BasicAuth automatically
- No need to manually encode credentials

### 3. **Documentation**
- See all possible responses
- View example data
- Understand what each field means

### 4. **Schema Validation**
- Swagger shows expected response structure
- Easy to spot missing or unexpected fields

### 5. **Team Collaboration**
- Share the `/docs` URL with your team
- Everyone can test without technical knowledge
- No need to explain API details

## Tips

### Testing Locally

```bash
# Start your dev server
npm run dev

# Open in browser
open http://localhost:8080/docs
```

### Testing in Production

1. Navigate to `https://your-app.com/docs`
2. Find the endpoint under "Admin" or "Testing" tags
3. Click "Authorize" and enter production credentials
4. Click "Try it out" → "Execute"
5. View real production community data

### Debugging

If the test fails:

1. **Check the Response Code:**
   - 401: Authentication issue
   - 500: ALIS API or server error

2. **Check the Response Body:**
   - Error message tells you what went wrong

3. **Check Application Logs:**
   - Look for `admin_test_communities_called`
   - Look for `test_communities_failed` with error details

### Security Note

The `/docs` endpoint visibility is controlled by the `ENABLE_SWAGGER` environment variable:

- **Development:** Enabled by default
- **Production:** Disabled by default (set `ENABLE_SWAGGER=true` to enable)

If you want to keep Swagger docs available in production for testing, set:
```env
ENABLE_SWAGGER=true
```

But remember: anyone with your app URL can see the docs (though they still need BasicAuth to execute requests).

## Alternative: Direct curl from Swagger

Swagger also shows you the curl command it uses:

```bash
# Swagger will show something like this:
curl -X 'GET' \
  'https://your-app.com/admin/test-communities' \
  -H 'accept: application/json' \
  -H 'Authorization: Basic dXNlcjpwYXNz'
```

You can copy this command and run it in your terminal!

## Comparison: Swagger UI vs curl

| Feature | Swagger UI | curl |
|---------|-----------|------|
| **Ease of use** | Click and test | Need to type commands |
| **Authentication** | Handled automatically | Manual encoding |
| **Documentation** | Built-in, always visible | Need separate docs |
| **Team friendly** | Yes, anyone can use | Requires command-line knowledge |
| **Automation** | No | Yes (scripting) |
| **Best for** | Manual testing, exploration | CI/CD, automation |

## Next Steps

1. ✅ Deploy your app with the updated OpenAPI docs
2. ✅ Visit `/docs` in your browser
3. ✅ Authorize with BasicAuth
4. ✅ Test the Communities endpoint
5. ✅ Share the docs URL with your team

Happy testing! 🚀

