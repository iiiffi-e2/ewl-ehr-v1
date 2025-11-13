# Webhook Event Flow Diagram

## Complete Webhook Processing Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           ALIS SYSTEM                                    │
│                                                                          │
│  Event occurs (resident move-in, leave start, etc.)                     │
│                           │                                              │
│                           ▼                                              │
│                  Generates Webhook Event                                 │
│                           │                                              │
└───────────────────────────┼──────────────────────────────────────────────┘
                            │
                            │ HTTP POST
                            │ /webhook/alis
                            │
┌───────────────────────────▼──────────────────────────────────────────────┐
│                      YOUR EWL-EHR SYSTEM                                 │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │ 1. WEBHOOK ENDPOINT (/webhook/alis)                            │    │
│  │                                                                 │    │
│  │  ✓ Verify IP allowlist (if configured)                         │    │
│  │  ✓ Verify Basic Auth credentials                               │    │
│  │  ✓ Validate payload schema (Zod)                               │    │
│  │                                                                 │    │
│  └────────────────────────┬────────────────────────────────────────┘    │
│                           │                                              │
│                           ▼                                              │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │ 2. RECORD EVENT (Database)                                      │    │
│  │                                                                 │    │
│  │  ✓ Upsert company by CompanyKey                                │    │
│  │  ✓ Check for duplicate EventMessageId                          │    │
│  │  ✓ Create EventLog record (status: "received")                 │    │
│  │  ✓ Store complete payload                                      │    │
│  │                                                                 │    │
│  └────────────────────────┬────────────────────────────────────────┘    │
│                           │                                              │
│                           ▼                                              │
│                    Is Duplicate?                                         │
│                     ┌─────┴─────┐                                        │
│                     │           │                                        │
│                   YES          NO                                        │
│                     │           │                                        │
│                     │           ▼                                        │
│                     │  ┌────────────────────────────────────────┐       │
│                     │  │ 3. CHECK EVENT TYPE                    │       │
│                     │  │                                         │       │
│                     │  │  Supported types:                      │       │
│                     │  │  • residents.move_in                   │       │
│                     │  │  • residents.move_out                  │       │
│                     │  │  • residents.leave_start               │       │
│                     │  │  • residents.leave_end                 │       │
│                     │  │  • residents.leave_cancelled           │       │
│                     │  │  • residents.basic_info_updated        │       │
│                     │  │  • test.event                          │       │
│                     │  │                                         │       │
│                     │  └────────────┬────────────────────────────┘       │
│                     │               │                                    │
│                     │               ▼                                    │
│                     │        Is test.event?                              │
│                     │         ┌─────┴─────┐                              │
│                     │         │           │                              │
│                     │       YES          NO                              │
│                     │         │           │                              │
│                     │         │           ▼                              │
│                     │         │  ┌────────────────────────────────┐     │
│                     │         │  │ 4. ENQUEUE JOB (Redis)         │     │
│                     │         │  │                                 │     │
│                     │         │  │  ✓ Add to processAlisEventQueue│     │
│                     │         │  │  ✓ Update status: "queued"     │     │
│                     │         │  │  ✓ Return 202 Accepted         │     │
│                     │         │  │                                 │     │
│                     │         │  └────────────┬────────────────────┘     │
│                     │         │               │                          │
│                     │         │               ▼                          │
│                     │         │  ┌────────────────────────────────┐     │
│                     │         │  │ 5. WORKER PROCESSES JOB        │     │
│                     │         │  │                                 │     │
│                     │         │  │  ✓ Fetch resident data (ALIS)  │     │
│                     │         │  │  ✓ Transform to Caspio format  │     │
│                     │         │  │  ✓ Upsert to Caspio            │     │
│                     │         │  │  ✓ Update status: "processed"  │     │
│                     │         │  │                                 │     │
│                     │         │  └────────────────────────────────┘     │
│                     │         │                                          │
│                     │         ▼                                          │
│                     │  Mark as "ignored"                                 │
│                     │  (test_acknowledged)                               │
│                     │                                                    │
│                     ▼                                                    │
│              Return 200 OK                                               │
│              (duplicate)                                                 │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────┐
│                    MONITORING & TESTING LAYER                            │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │ GET /admin/webhook-events                                       │    │
│  │                                                                 │    │
│  │  • View all received events                                    │    │
│  │  • Filter by status, eventType                                 │    │
│  │  • See summary statistics                                      │    │
│  │  • Inspect complete payloads                                   │    │
│  │                                                                 │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │ GET /admin/webhook-events/{eventMessageId}                      │    │
│  │                                                                 │    │
│  │  • Get detailed event information                              │    │
│  │  • View processing timestamps                                  │    │
│  │  • Check error messages                                        │    │
│  │  • Inspect company data                                        │    │
│  │                                                                 │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │ POST /admin/simulate-webhook                                    │    │
│  │                                                                 │    │
│  │  • Manually trigger test events                                │    │
│  │  • Customize event type & data                                 │    │
│  │  • Test without external dependencies                          │    │
│  │  • Verify processing logic                                     │    │
│  │                                                                 │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Event Status Lifecycle

```
┌──────────┐
│ received │  ← Event just arrived from Alis
└────┬─────┘
     │
     ▼
┌──────────┐
│  queued  │  ← Added to Redis processing queue
└────┬─────┘
     │
     ▼
┌──────────────┐
│  processed   │  ← Successfully processed ✅
└──────────────┘

     OR

┌──────────┐
│  failed  │  ← Processing error occurred ❌
└──────────┘

     OR

┌──────────┐
│ ignored  │  ← Acknowledged but not processed (test events)
└──────────┘
```

## Testing Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     TESTING WORKFLOW                             │
└─────────────────────────────────────────────────────────────────┘

1. SIMULATE EVENT
   │
   │  POST /admin/simulate-webhook
   │  {
   │    "eventType": "residents.move_in",
   │    "companyKey": "appstoresandbox",
   │    "notificationData": { "ResidentId": 456 }
   │  }
   │
   ▼
2. EVENT PROCESSED
   │
   │  • Webhook handler receives event
   │  • Event saved to database
   │  • Job queued in Redis
   │  • Worker processes event
   │
   ▼
3. VERIFY RESULTS
   │
   │  GET /admin/webhook-events?limit=1
   │
   │  • Check status is "processed"
   │  • Verify no errors
   │  • Inspect payload
   │  • Check processing time
   │
   ▼
4. INSPECT DETAILS (if needed)
   │
   │  GET /admin/webhook-events/{eventMessageId}
   │
   │  • View complete event data
   │  • Check timestamps
   │  • Review error messages
   │
   ▼
✅ CONFIRMED WORKING
```

## Integration Testing Flow

```
┌─────────────────────────────────────────────────────────────────┐
│              INTEGRATION WITH ALIS WORKFLOW                      │
└─────────────────────────────────────────────────────────────────┘

PHASE 1: SETUP
│
├─ Provide webhook URL to Alis
├─ Configure authentication credentials
├─ Set up IP allowlist (if required)
└─ Verify health endpoints working

PHASE 2: INITIAL TESTING
│
├─ Ask Alis to send test.event
│  └─ Monitor: GET /admin/webhook-events
│     └─ Verify: status = "ignored", no errors
│
├─ Simulate events locally
│  └─ POST /admin/simulate-webhook
│     └─ Verify: events process correctly
│
└─ Check system health
   └─ GET /health/deps
      └─ Verify: ALIS, database, Redis all OK

PHASE 3: REAL EVENT TESTING
│
├─ Ask Alis to trigger real event
│  └─ Example: Update a resident's info
│
├─ Monitor event arrival
│  └─ GET /admin/webhook-events
│     └─ Verify: event received
│
├─ Check processing
│  └─ Verify: status moves to "processed"
│  └─ Check: processing time is reasonable
│
└─ Verify data in Caspio
   └─ Confirm: data synced correctly

PHASE 4: PRODUCTION MONITORING
│
├─ Regular checks
│  └─ GET /admin/webhook-events?status=failed
│     └─ Monitor for failures
│
├─ Performance monitoring
│  └─ Check processing times
│  └─ Monitor event volume
│
└─ Error investigation
   └─ GET /admin/webhook-events/{id}
      └─ Inspect failed events
      └─ Review error messages

✅ PRODUCTION READY
```

## Data Flow

```
ALIS → Webhook → Database → Queue → Worker → ALIS API → Caspio
                    ↓                           ↓
                EventLog                  Resident Data
                (payload)                 (transformed)
                    ↓
              Admin Endpoints
              (monitoring)
```

## Security Layers

```
┌─────────────────────────────────────────────────────────────┐
│                    SECURITY LAYERS                           │
└─────────────────────────────────────────────────────────────┘

Request from Alis
      │
      ▼
┌──────────────┐
│ IP Allowlist │  ← WEBHOOK_ALLOWED_IPS (optional)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Basic Auth  │  ← WEBHOOK_USERNAME / WEBHOOK_PASSWORD
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   Validate   │  ← Zod schema validation
│   Payload    │
└──────┬───────┘
       │
       ▼
   Process Event

Admin Endpoints
      │
      ▼
┌──────────────┐
│  Basic Auth  │  ← Same credentials as webhook
└──────┬───────┘
       │
       ▼
   View/Test Events
```

---

This diagram shows the complete flow from Alis sending a webhook through to monitoring and testing. All components are now in place and ready to use!

