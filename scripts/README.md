# Scripts

Utility scripts for testing and managing the ALIS EyeWatch integration.

## test-webhook.ps1

PowerShell script for testing the ALIS webhook endpoint.

### Usage

**Local testing (default):**
```powershell
.\scripts\test-webhook.ps1
```

**Custom endpoint:**
```powershell
.\scripts\test-webhook.ps1 "https://your-app.onrender.com" "your-username" "your-password"
```

**With named parameters:**
```powershell
.\scripts\test-webhook.ps1 -baseUrl "https://staging.example.com" -username "staging-user" -password "staging-pass"
```

### What it tests

1. **Authentication** - Verifies 401 response without credentials
2. **Test Events** - Confirms test events are acknowledged
3. **Real Events** - Tests actual event processing (resident move-in)
4. **Idempotency** - Validates duplicate event detection

### Example Output

```
=== Testing Webhook Endpoint ===
URL: http://localhost:8080/webhook/alis

Test 1: No authentication (expecting 401)...
Status: 401 ✓

Test 2: Test event with auth (expecting 202)...
Status: 202 ✓
Response: {"status":"test_acknowledged"}

Test 3: Resident move-in event (expecting 202)...
Status: 202 ✓
Response: {"status":"queued","id":2}

Test 4: Duplicate event (expecting 200 on second call)...
  First call: 202 ✓
  Second call: 200 ✓ (duplicate detected)

=== All Tests Complete ===
```

### Requirements

- PowerShell 5.1 or later
- Server running on the specified URL
- Valid webhook credentials

