# Admin Test Endpoints - Quick Reference

## Overview

Phase 1 admin endpoints for testing ALIS API in production. All endpoints are protected with BasicAuth and accessible from any IP.

---

## 1. Test Communities

**Endpoint:** `GET /admin/test-communities`

**Description:** Fetch all communities from ALIS

**Example:**
```bash
curl -u "user:pass" https://your-app.com/admin/test-communities
```

**Response:**
```json
{
  "success": true,
  "count": 2,
  "timestamp": "2025-11-10T17:00:00.000Z",
  "communities": [
    {
      "id": 123,
      "name": "Sunset Senior Living",
      "companyKey": "appstoresandbox",
      "address": "123 Main St",
      "city": "Springfield",
      "state": "IL"
    }
  ]
}
```

---

## 2. Test Resident

**Endpoint:** `GET /admin/test-resident/:residentId`

**Description:** Fetch detailed resident data from ALIS

**Example:**
```bash
curl -u "user:pass" https://your-app.com/admin/test-resident/12345
```

**Response:**
```json
{
  "success": true,
  "residentId": 12345,
  "timestamp": "2025-11-10T17:00:00.000Z",
  "data": {
    "detail": {
      "ResidentId": 12345,
      "FirstName": "John",
      "LastName": "Doe",
      "Status": "Active",
      "Rooms": [...]
    },
    "basicInfo": {
      "ResidentId": 12345,
      "Classification": "Independent Living",
      "ProductType": "Apartment"
    }
  }
}
```

**Use Cases:**
- Debug why a specific resident didn't sync
- Verify resident data format
- Compare ALIS data with local database

---

## 3. Test Leaves

**Endpoint:** `GET /admin/test-leaves/:residentId`

**Description:** Fetch leave (temporary absence) data for a resident

**Example:**
```bash
curl -u "user:pass" https://your-app.com/admin/test-leaves/12345
```

**Response:**
```json
{
  "success": true,
  "residentId": 12345,
  "count": 1,
  "timestamp": "2025-11-10T17:00:00.000Z",
  "leaves": [
    {
      "LeaveId": 789,
      "ResidentId": 12345,
      "StartDate": "2025-11-05",
      "ExpectedReturnDate": "2025-11-10",
      "EndDate": null,
      "Reason": "Hospital Visit",
      "Status": "Active"
    }
  ]
}
```

**Use Cases:**
- Debug leave-related events that failed
- Verify leave data structure
- Check current active leaves

---

## 4. List Residents

**Endpoint:** `GET /admin/list-residents`

**Description:** List residents with optional filtering and pagination

**Query Parameters:**
- `companyKey` (optional) - Filter by company (e.g., "appstoresandbox")
- `communityId` (optional) - Filter by community ID
- `page` (optional) - Page number (default: 1)
- `pageSize` (optional) - Results per page (default: 50)

**Examples:**
```bash
# List all residents
curl -u "user:pass" https://your-app.com/admin/list-residents

# Filter by company
curl -u "user:pass" \
  "https://your-app.com/admin/list-residents?companyKey=appstoresandbox"

# Filter by community with pagination
curl -u "user:pass" \
  "https://your-app.com/admin/list-residents?communityId=123&page=1&pageSize=10"
```

**Response:**
```json
{
  "success": true,
  "count": 2,
  "hasMore": true,
  "timestamp": "2025-11-10T17:00:00.000Z",
  "filters": {
    "companyKey": "appstoresandbox",
    "communityId": 123,
    "page": 1,
    "pageSize": 10
  },
  "residents": [
    {
      "residentId": 12345,
      "firstName": "John",
      "lastName": "Doe",
      "status": "Active",
      "classification": "Independent Living",
      "productType": "Apartment",
      "dateOfBirth": "1950-01-15",
      "rooms": [{"roomNumber": "101", "bed": "A"}]
    }
  ]
}
```

**Use Cases:**
- Find resident IDs for testing
- Verify resident count in ALIS
- Explore available residents
- Test pagination

---

## Error Responses

### 400 Bad Request (Invalid Parameters)
```json
{
  "success": false,
  "error": "Invalid residentId parameter",
  "timestamp": "2025-11-10T17:00:00.000Z"
}
```

### 401 Unauthorized (Bad Credentials)
```json
{
  "error": "Unauthorized"
}
```

### 500 Internal Server Error (ALIS API Error)
```json
{
  "success": false,
  "error": "Unauthorized to call ALIS API (401)",
  "timestamp": "2025-11-10T17:00:00.000Z"
}
```

---

## Using Swagger UI

All endpoints are documented in Swagger at `/docs`:

1. Navigate to `https://your-app.com/docs`
2. Find endpoints under the **Admin** section
3. Click "Authorize" and enter BasicAuth credentials
4. Click "Try it out" on any endpoint
5. Fill in parameters (if needed)
6. Click "Execute"

**Benefits:**
- No need to write curl commands
- Interactive parameter input
- See response immediately
- View examples and schemas

---

## Authentication

All endpoints use the same BasicAuth as your webhook:

**Username:** Your `WEBHOOK_BASIC_USER`  
**Password:** Your `WEBHOOK_BASIC_PASS`

**Not** the ALIS credentials! Your application uses ALIS credentials internally.

---

## Logging

All requests are logged with structured data:

**Success:**
```json
{
  "level": "info",
  "msg": "test_resident_success",
  "residentId": 12345
}
```

**Failure:**
```json
{
  "level": "error",
  "msg": "test_resident_failed",
  "error": "Not found",
  "residentId": 12345
}
```

Check production logs for:
- `admin_test_communities_called`
- `admin_test_resident_called`
- `admin_test_leaves_called`
- `admin_list_residents_called`

---

## Common Workflows

### Debug a Failed Resident Sync

1. Check EventLog for failed event with residentId
2. Call `/admin/test-resident/:residentId` to see ALIS data
3. Compare with local database
4. Check logs for transformation errors

### Verify Leave Data

1. Resident has leave event that failed
2. Call `/admin/test-leaves/:residentId`
3. Verify leave exists in ALIS
4. Check leave status and dates

### Find Test Resident IDs

1. Call `/admin/list-residents?companyKey=appstoresandbox`
2. Pick a resident ID from results
3. Use for testing other endpoints

### Explore Community Data

1. Call `/admin/test-communities`
2. Note community IDs
3. Use in `/admin/list-residents?communityId=X` to see residents

---

## Security

✅ **Protected with BasicAuth** - Same credentials as webhook  
✅ **No IP restrictions** - Unlike webhook, works from any IP  
✅ **Read-only operations** - Cannot modify ALIS data  
✅ **Fully logged** - All access tracked  
✅ **HTTPS in production** - Credentials encrypted  

---

## Future Endpoints (Phase 2+)

Potential additions based on needs:
- `GET /admin/events` - Query local EventLog
- `GET /admin/residents` - Query local Resident table
- `POST /admin/reprocess-event/:id` - Retry failed event
- `GET /admin/backfill-status` - Check backfill progress

These will be added based on actual usage and feedback.

---

## Quick Reference Table

| Endpoint | Method | Parameters | Use Case |
|----------|--------|------------|----------|
| `/admin/test-communities` | GET | None | List all communities |
| `/admin/test-resident/:id` | GET | residentId (path) | Debug resident sync |
| `/admin/test-leaves/:id` | GET | residentId (path) | Debug leave events |
| `/admin/list-residents` | GET | companyKey, communityId, page, pageSize (query) | Find residents, explore data |

---

## Next Steps

1. Deploy to production
2. Test endpoints in Swagger UI at `/docs`
3. Bookmark useful queries
4. Share with team
5. Provide feedback for Phase 2

Happy debugging! 🚀

