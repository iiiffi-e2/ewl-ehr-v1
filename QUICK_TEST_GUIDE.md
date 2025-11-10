# Quick Test Guide - Communities API

## 🚀 Test in Production (30 seconds)

```bash
# Replace YOUR_URL, USER, and PASS with your actual values
curl -u "YOUR_WEBHOOK_USER:YOUR_WEBHOOK_PASS" \
  https://YOUR_PRODUCTION_URL.com/admin/test-communities
```

### Expected Success Response
```json
{
  "success": true,
  "count": 2,
  "timestamp": "2025-11-10T...",
  "communities": [
    {
      "id": 123,
      "name": "Community Name",
      "companyKey": "...",
      ...
    }
  ]
}
```

### If You Get 401
- Double-check your BasicAuth credentials
- These are the same as `WEBHOOK_BASIC_USER` and `WEBHOOK_BASIC_PASS`

### If You Get 500
- Check production logs for details
- Verify ALIS credentials are set: `ALIS_TEST_USERNAME` and `ALIS_TEST_PASSWORD`

---

## 🧪 Test Locally

```bash
npm run test:communities
```

---

## 📋 Common Production URLs

**Heroku:**
```bash
curl -u "user:pass" https://your-app-name.herokuapp.com/admin/test-communities
```

**Render:**
```bash
curl -u "user:pass" https://your-app-name.onrender.com/admin/test-communities
```

**Railway:**
```bash
curl -u "user:pass" https://your-app-name.up.railway.app/admin/test-communities
```

---

## 🔍 Check Logs After Testing

**Heroku:**
```bash
heroku logs --tail -a your-app-name | grep test_communities
```

**Railway:**
```bash
railway logs | grep test_communities
```

**Render:**
Check logs in dashboard, search for `test_communities_success`

---

## ✅ What to Verify

- [ ] Returns 401 without credentials
- [ ] Returns 200 with valid credentials  
- [ ] Communities array is not empty
- [ ] Community data looks correct (names, IDs, etc.)
- [ ] Logs show `admin_test_communities_called`
- [ ] Response time under 3 seconds

---

## 🔐 Security

- Endpoint uses same BasicAuth as webhook
- All access is logged
- Read-only operation (safe to test)
- Can be removed after testing (optional)

---

For complete details, see [TESTING_PRODUCTION.md](./TESTING_PRODUCTION.md)

