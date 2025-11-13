# Real-Time Webhook Monitor Guide

## 🎯 Quick Start

### Access the Monitor

**Local Development:**
```
http://localhost:3000/monitor
```

**Production (Railway):**
```
https://your-railway-app.railway.app/monitor
```

## 🖥️ What You Get

A beautiful, real-time dashboard that shows webhook events as they arrive, just like watching a live console!

### Features

- **🔴 Live Stream** - Events appear instantly as they're received
- **📊 Real-Time Statistics** - Total events, processed, failed counts
- **🎨 Color-Coded Status** - Easy visual identification of event states
- **🔍 Expandable Payloads** - Click to view full JSON payloads
- **⏱️ Timestamps** - See exactly when events arrived
- **🔄 Auto-Scroll** - Automatically shows newest events (can be toggled)
- **🗑️ Clear Display** - Remove old events from view
- **💾 Credential Storage** - Saves your login for convenience

## 📖 How to Use

### Step 1: Open the Monitor

Navigate to `/monitor` in your browser.

### Step 2: Enter Credentials

1. Enter your `WEBHOOK_USERNAME`
2. Enter your `WEBHOOK_PASSWORD`
3. Click **"Connect"**

The credentials are saved in your browser for next time.

### Step 3: Watch Events

Once connected, you'll see:
- **Green dot** = Connected and listening
- Events appear automatically as they arrive
- Statistics update in real-time

### Step 4: Interact with Events

- **Click "View Payload"** on any event to see the full JSON
- **Toggle Auto-scroll** to stop/start automatic scrolling
- **Click "Clear"** to remove all events from display
- **Click "Disconnect"** to stop the stream

## 🎨 Understanding the Display

### Status Colors

| Color | Status | Meaning |
|-------|--------|---------|
| 🔵 Blue | `received` | Just arrived |
| 🟡 Yellow | `queued` | Waiting to process |
| 🟢 Green | `processed` | Successfully completed |
| 🔴 Red | `failed` | Error occurred |
| ⚪ Gray | `ignored` | Acknowledged but not processed |

### Event Information

Each event shows:
- **Event Type** - What kind of event (move_in, leave_start, etc.)
- **Event ID** - Unique identifier from ALIS
- **Status Badge** - Current processing status
- **Company Key** - Which company sent it
- **Community ID** - Which community (if applicable)
- **Timestamp** - When it was received
- **Error Message** - If processing failed
- **Full Payload** - Complete JSON data (expandable)

### Statistics Panel

- **Total Events** - All events received this session
- **Processed** - Successfully completed events (green)
- **Failed** - Events with errors (red)
- **Last Event** - Time of most recent event

## 💡 Use Cases

### 1. Testing Alis Integration

**Scenario:** Verify Alis can send webhooks

1. Open the monitor
2. Connect with your credentials
3. Ask Alis to send a test event
4. Watch it appear in real-time!

**Success:** Event appears with status `ignored` (test events are acknowledged but not processed)

### 2. Monitoring Production

**Scenario:** Watch live webhook traffic

1. Keep monitor open during business hours
2. See events as residents move in/out
3. Catch errors immediately
4. Verify processing times

**Benefit:** Immediate visibility into system health

### 3. Debugging Issues

**Scenario:** Investigate why events are failing

1. Open monitor
2. Wait for or simulate a failing event
3. Click "View Payload" to see what was sent
4. Check error message for clues
5. Fix the issue and verify with new events

**Benefit:** Real-time debugging without checking logs

### 4. Demo/Presentation

**Scenario:** Show stakeholders the system working

1. Open monitor on a large screen
2. Simulate some events or wait for real ones
3. Show live processing and statistics
4. Demonstrate system reliability

**Benefit:** Visual proof of system operation

## 🔧 Technical Details

### How It Works

The monitor uses **Server-Sent Events (SSE)** to stream data from the server:

1. Browser connects to `/admin/webhook-events-stream`
2. Server polls database every 2 seconds for new events
3. New events are pushed to browser immediately
4. Browser updates display in real-time

### Connection Management

- **Heartbeat** - Server sends heartbeat every 2 seconds to keep connection alive
- **Auto-Reconnect** - Browser automatically reconnects if connection drops
- **Clean Disconnect** - Properly closes connection when you navigate away

### Performance

- **Lightweight** - Only sends new events, not entire history
- **Efficient** - Polls database, not constant queries
- **Scalable** - Multiple users can monitor simultaneously

## 🚨 Troubleshooting

### Monitor Won't Connect

**Check:**
1. Are credentials correct?
2. Is server running?
3. Check browser console for errors
4. Try `/health` endpoint to verify server is up

### No Events Showing

**Check:**
1. Are you connected? (green dot)
2. Have any webhooks been received?
3. Try simulating an event via Swagger UI
4. Check if auto-scroll is off (events might be below)

### Events Not Updating

**Check:**
1. Connection status (should be green)
2. Browser console for errors
3. Try disconnecting and reconnecting
4. Refresh the page

### Credentials Not Saving

**Check:**
1. Browser allows localStorage
2. Not in private/incognito mode
3. Clear browser cache and try again

## 📱 Mobile Support

The monitor is responsive and works on mobile devices:
- Optimized layout for small screens
- Touch-friendly controls
- Readable text sizes
- Efficient data usage

## 🔐 Security

- **Authentication Required** - Must provide valid credentials
- **Credentials Stored Locally** - Only in your browser, never sent to server except for auth
- **Secure Connection** - Use HTTPS in production
- **Session-Based** - Credentials only valid while connected

## 💡 Pro Tips

1. **Keep It Open** - Leave monitor open in a browser tab during integration
2. **Use Multiple Windows** - Monitor in one window, Swagger in another
3. **Bookmark It** - Quick access to `/monitor`
4. **Clear Regularly** - Keep display clean by clearing old events
5. **Watch Patterns** - Learn what normal traffic looks like
6. **Screenshot Errors** - Capture error events for debugging
7. **Share Screen** - Great for remote debugging with team

## 🎓 Keyboard Shortcuts

While the monitor doesn't have built-in shortcuts, you can use browser shortcuts:
- **Ctrl+F** (Cmd+F on Mac) - Search for specific event IDs
- **F5** - Refresh page (will disconnect and reconnect)
- **Ctrl+W** (Cmd+W on Mac) - Close tab (will disconnect cleanly)

## 🔗 Related Endpoints

### For Programmatic Access

If you want to build your own monitor or integrate the stream:

**Connect to stream:**
```javascript
const eventSource = new EventSource('/admin/webhook-events-stream', {
  headers: {
    'Authorization': 'Basic ' + btoa('username:password')
  }
});

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('New event:', data);
};
```

**Alternative: Polling**
```javascript
// Poll every 5 seconds
setInterval(async () => {
  const response = await fetch('/admin/webhook-events?limit=10', {
    headers: {
      'Authorization': 'Basic ' + btoa('username:password')
    }
  });
  const data = await response.json();
  console.log('Recent events:', data.events);
}, 5000);
```

## 📊 Comparison with Other Methods

| Method | Real-Time | Visual | Easy Setup | Best For |
|--------|-----------|--------|------------|----------|
| **Monitor Dashboard** | ✅ Yes | ✅ Yes | ✅ Easy | Human monitoring |
| Swagger UI | ❌ No | ⚠️ Basic | ✅ Easy | API testing |
| cURL/Scripts | ❌ No | ❌ No | ⚠️ Medium | Automation |
| Direct SSE | ✅ Yes | ❌ No | ❌ Hard | Custom integration |
| Railway Logs | ⚠️ Near | ❌ No | ✅ Easy | Debugging |

## 🎉 Benefits

- **Instant Feedback** - See events as they happen
- **No Refresh Needed** - Updates automatically
- **Beautiful UI** - Easy to read and understand
- **No Setup** - Just open and connect
- **Shareable** - Send URL to team members
- **Professional** - Great for demos and presentations

## 📞 Support

If you have issues:

1. Check browser console (F12) for errors
2. Verify credentials with Swagger UI first
3. Test `/health` endpoint
4. Try `/admin/webhook-events` (non-streaming) to verify auth
5. Check Railway logs for server-side errors

---

**You're ready to monitor!** Open `/monitor` and start watching webhook events in real-time. 🚀

