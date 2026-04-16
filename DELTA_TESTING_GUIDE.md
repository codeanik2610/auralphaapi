# Delta Exchange Wallet Adapter - Comprehensive Testing Guide

## 🎯 Overview

This guide provides step-by-step instructions for comprehensively testing the Delta Exchange wallet adapter changes before production deployment.

**Change Summary:**
- Delta `getWalletFunds()` now returns all zeros (no separate spot wallet)
- Delta `getFuturesFunds()` unchanged (returns actual balance)
- Prevents double-counting of balance in portfolio calculations

---

## ✅ Pre-Deployment Checklist

### Phase 1: Unit Tests (5 mins)
- [ ] Run basic adapter test
- [ ] Verify wallet returns zeros
- [ ] Verify futures returns actual balance

### Phase 2: Integration Tests (15 mins)
- [ ] Test with real Delta Exchange account
- [ ] Verify database writes
- [ ] Check API endpoints

### Phase 3: End-to-End Tests (20 mins)
- [ ] Test overview page
- [ ] Test portfolio calculations
- [ ] Test frontend display

### Phase 4: Production Monitoring (24 hours)
- [ ] Monitor error logs
- [ ] Check user feedback
- [ ] Verify metrics

---

## 📋 Phase 1: Unit Tests

### Test 1.1: Basic Adapter Test

```bash
# Run the basic test script
node --import tsx scripts/test-delta-wallet-adapter.ts
```

**Expected Output:**
```
✅ Delta wallet funds return zeros (no double counting)
✅ Delta futures funds return actual balance (122.53)
✅ Response structures match expected contracts
✅ Portfolio calculations are correct
```

**Pass Criteria:**
- All tests pass
- Wallet total = 0
- Futures balance = string format (e.g., "122.53")

---

### Test 1.2: Existing Test Suite

```bash
# Run existing wallet tests
npm run test:wallets
```

**Expected Output:**
```
✅ All controller routing tests pass
```

**Pass Criteria:**
- No test failures
- No errors in output

---

## 🔌 Phase 2: Integration Tests

### Test 2.1: Real Delta Account Test

**Prerequisites:**
1. Find a real user ID with Delta Exchange account
2. Start the application: `npm run dev:localhost`

```bash
# Get a user ID with Delta account
mysql -h 127.0.0.1 -P 8889 -u root -proot auralpha -e "
SELECT DISTINCT user_id
FROM broker_accounts
WHERE brokerKey = 'delta_exchange'
  AND status IN ('Connected', 'Idle')
LIMIT 1;
"

# Run real account test (replace USER_ID)
node --import tsx scripts/test-delta-real-account.ts USER_ID
```

**Expected Output:**
```
✅ API call successful
✅ PASS: Wallet total is 0 (correct)
✅ PASS: Futures balance is "122.53" (string format)
✅ Snapshot saved
✅ PASS: Stored wallet total is 0
✅ PASS: Delta wallet is 0 (no double counting)
```

**Pass Criteria:**
- API call succeeds
- Wallet funds = 0
- Futures funds = actual balance from API
- Database write successful
- Comparison with Mudrex shows correct totals

---

### Test 2.2: Database Verification

```bash
# Check latest Delta snapshots
mysql -h 127.0.0.1 -P 8889 -u root -proot auralpha -e "
SELECT
  id,
  user_id,
  broker_key,
  JSON_EXTRACT(wallet_funds_json, '$.total') as wallet_total,
  JSON_EXTRACT(futures_funds_json, '$.balance') as futures_balance,
  observed_at,
  fetch_status
FROM funds_snapshots
WHERE broker_key = 'delta_exchange'
ORDER BY observed_at DESC
LIMIT 10;
"
```

**Expected Result:**
- Latest snapshots have `wallet_total = 0`
- Latest snapshots have `futures_balance = actual amount`
- `fetch_status = 'success'`
- Old snapshots may still have real wallet values (historical data)

**Pass Criteria:**
- New snapshots show wallet = 0
- Futures balance is correct
- No NULL or error values

---

### Test 2.3: Funds Scheduler Test

```bash
# Trigger scheduler manually (app must be running)
curl -X POST \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:3000/scheduler/funds/run-now

# Wait 30 seconds for scheduler to complete

# Check scheduler logs
mysql -h 127.0.0.1 -P 8889 -u root -proot auralpha -e "
SELECT
  id,
  status,
  processedAccounts,
  insertedAssets,
  updatedAssets,
  errorMessage,
  finishedAt
FROM scheduler_run_logs
WHERE schedulerKey = 'funds-sync'
ORDER BY startedAt DESC
LIMIT 5;
"
```

**Expected Result:**
- Scheduler completes successfully
- `status = 'Completed'`
- `errorMessage = NULL`
- Accounts processed

**Pass Criteria:**
- No errors in scheduler run
- Database updated with new snapshots
- Delta accounts show wallet = 0

---

### Test 2.4: API Endpoint Tests

```bash
# Test wallet funds endpoint
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:3000/wallet/funds?brokerKey=delta_exchange" | jq

# Expected: {"data": {"total": 0, "withdrawable": 0, ...}}

# Test futures funds endpoint
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:3000/wallet/futures/funds?brokerKey=delta_exchange" | jq

# Expected: {"data": {"balance": "122.53", "locked_amount": "0.00", ...}}

# Test active wallets (all accounts)
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:3000/wallet/funds/active" | jq

# Expected: Delta shows total: 0, Mudrex shows real balance

# Test active futures (all accounts)
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:3000/wallet/futures/funds/active" | jq

# Expected: Delta shows real futures balance, Mudrex shows real balance
```

**Pass Criteria:**
- All endpoints return 200 OK
- Delta wallet = 0
- Delta futures = actual balance
- Mudrex unaffected
- No 500 errors

---

## 🎨 Phase 3: End-to-End Tests

### Test 3.1: Overview Page Test

1. **Open frontend application**
2. **Navigate to Overview/Dashboard page**
3. **Verify display:**

**Expected UI:**
```
💼 Wallet Funds
  Mudrex: $10.00
  Delta Exchange: $0.00 (or hidden)
  Total: $10.00

📊 Futures Funds
  Delta Exchange: $122.53
  Mudrex: $336.49
  Total: $459.02

💵 Total Capital: $469.02
```

**Pass Criteria:**
- Delta wallet shows $0.00 or is hidden with explanation
- Delta futures shows real balance
- Total capital is correct (no double counting)
- No JavaScript errors in console
- Page loads without warnings

---

### Test 3.2: Portfolio Page Test

```bash
# Test portfolio capital endpoint
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:3000/portfolio/capital" | jq
```

1. **Navigate to Portfolio page**
2. **Verify capital breakdown:**

**Expected:**
- Wallet section shows correct total (Mudrex only)
- Futures section shows correct total (Delta + Mudrex)
- Charts render properly
- No calculation errors

**Pass Criteria:**
- Calculations are correct
- No NaN or Infinity values
- Charts display properly
- No UI glitches

---

### Test 3.3: Edge Case Testing

**A. Multiple Delta Accounts**

If user has 2+ Delta accounts:
```
Expected:
- Each Delta account: wallet = 0, futures = actual balance
- Total wallet = 0 (all Delta wallets combined)
- Total futures = sum of all Delta futures balances
```

**B. Zero Balance Account**

If Delta account has 0 balance:
```
Expected:
- Wallet: 0
- Futures: "0.00"
- No errors
- UI handles gracefully
```

**C. Missing Snapshot**

For new Delta account (no snapshot yet):
```
Expected:
- API falls back to live fetch
- Returns correct values
- No errors displayed
```

---

### Test 3.4: Historical Data Test

```bash
# Query historical snapshots
mysql -h 127.0.0.1 -P 8889 -u root -proot auralpha -e "
SELECT
  snapshot_date,
  JSON_EXTRACT(wallet_funds_json, '$.total') as wallet,
  JSON_EXTRACT(futures_funds_json, '$.balance') as futures
FROM funds_snapshots
WHERE broker_key = 'delta_exchange'
  AND snapshot_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
ORDER BY snapshot_date DESC;
"
```

**Expected:**
- Old snapshots: wallet may have real values (historical)
- New snapshots: wallet = 0
- Transition is smooth
- No data corruption

**Pass Criteria:**
- Old data preserved
- New data correct
- No gaps in timeline

---

## 🎯 Phase 4: Production Monitoring

### Day 1 Checklist

**Hour 1:**
- [ ] Check error logs for new exceptions
- [ ] Verify scheduler ran successfully
- [ ] Check database for new snapshots
- [ ] Spot-check a few user accounts

**Hour 4:**
- [ ] Review user support tickets
- [ ] Check frontend error tracking (Sentry, etc.)
- [ ] Verify API response times normal

**Hour 24:**
- [ ] Full metrics review
- [ ] User feedback analysis
- [ ] Performance impact assessment

---

### Monitoring Queries

**Check for errors:**
```sql
-- Recent scheduler failures
SELECT * FROM scheduler_run_logs
WHERE schedulerKey = 'funds-sync'
  AND status = 'Failed'
  AND startedAt >= NOW() - INTERVAL 24 HOUR;

-- Failed snapshot attempts
SELECT * FROM funds_snapshots
WHERE fetch_status = 'failed'
  AND last_attempt_at >= NOW() - INTERVAL 24 HOUR;
```

**Verify data quality:**
```sql
-- Check for unexpected NULL values
SELECT COUNT(*) FROM funds_snapshots
WHERE broker_key = 'delta_exchange'
  AND observed_at >= NOW() - INTERVAL 24 HOUR
  AND (wallet_funds_json IS NULL OR futures_funds_json IS NULL);

-- Verify wallet = 0 for new snapshots
SELECT COUNT(*) FROM funds_snapshots
WHERE broker_key = 'delta_exchange'
  AND observed_at >= NOW() - INTERVAL 24 HOUR
  AND JSON_EXTRACT(wallet_funds_json, '$.total') != 0;
```

---

## 🚨 Rollback Plan

If issues are detected:

### Step 1: Assess Impact
```sql
-- How many users affected?
SELECT COUNT(DISTINCT user_id) FROM funds_snapshots
WHERE broker_key = 'delta_exchange'
  AND observed_at >= NOW() - INTERVAL 24 HOUR;

-- How many snapshots impacted?
SELECT COUNT(*) FROM funds_snapshots
WHERE broker_key = 'delta_exchange'
  AND observed_at >= NOW() - INTERVAL 24 HOUR;
```

### Step 2: Quick Fix (if needed)

Revert the adapter change:
```bash
git revert <commit-hash>
npm run build
pm2 restart all
```

### Step 3: Re-run Scheduler

```bash
# Manually trigger scheduler for affected users
curl -X POST -H "Authorization: Bearer TOKEN" \
  "http://localhost:3000/scheduler/funds/run-now"
```

---

## ✅ Success Criteria

**The deployment is successful if:**

1. ✅ All unit tests pass
2. ✅ Real API integration works
3. ✅ Database writes are correct
4. ✅ API endpoints return expected values
5. ✅ Frontend displays correctly
6. ✅ No errors in production logs (24h)
7. ✅ No user complaints
8. ✅ Portfolio calculations are accurate
9. ✅ Scheduler runs successfully
10. ✅ Historical data is preserved

---

## 📞 Support

If issues arise during testing:

1. Check logs: `tail -f logs/application.log`
2. Review error tracking dashboard
3. Check database state with provided queries
4. Escalate if needed

---

**Testing Duration Estimate:**
- Phase 1: 5 minutes
- Phase 2: 15 minutes
- Phase 3: 20 minutes
- Phase 4: 24 hours monitoring

**Total Active Testing Time:** ~40 minutes
**Total Monitoring Time:** 24 hours

---

*Last Updated: 2026-04-14*
*Change: Delta Exchange wallet adapter returns zeros for wallet funds*
