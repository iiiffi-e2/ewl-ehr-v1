# Configuration
# Usage: .\test-webhook.ps1 [baseUrl] [username] [password]
# Example: .\test-webhook.ps1 "https://your-app.onrender.com" "prod-user" "prod-pass"
param(
    [string]$baseUrl = "http://localhost:8080",
    [string]$username = "test-user",
    [string]$password = "test-pass"
)

# Create auth header
$pair = "$($username):$($password)"
$encodedCreds = [System.Convert]::ToBase64String([System.Text.Encoding]::ASCII.GetBytes($pair))
$headers = @{
    "Authorization" = "Basic $encodedCreds"
    "Content-Type" = "application/json"
}

Write-Host "`n=== Testing Webhook Endpoint ===" -ForegroundColor Cyan
Write-Host "URL: $baseUrl/webhook/alis`n" -ForegroundColor Cyan

# Test 1: No Authentication (should fail)
Write-Host "Test 1: No authentication (expecting 401)..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "$baseUrl/webhook/alis" `
        -Method POST `
        -ContentType "application/json" `
        -Body '{"CompanyKey":"test","EventType":"test.event","EventMessageId":"test-1","EventMessageDate":"2025-11-08T12:00:00Z"}' `
        -ErrorAction Stop
    Write-Host "Status: $($response.StatusCode)" -ForegroundColor Green
    Write-Host "Response: $($response.Content)`n"
} catch {
    Write-Host "Status: $($_.Exception.Response.StatusCode.Value__)" -ForegroundColor Red
    Write-Host "Expected failure - authentication required`n"
}

# Test 2: Test Event with Auth
Write-Host "Test 2: Test event with auth (expecting 202)..." -ForegroundColor Yellow
try {
    $body = @{
        CompanyKey = "appstoresandbox"
        EventType = "test.event"
        EventMessageId = "test-$(Get-Date -Format 'yyyyMMddHHmmss')"
        EventMessageDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    } | ConvertTo-Json

    $response = Invoke-WebRequest -Uri "$baseUrl/webhook/alis" `
        -Method POST `
        -Headers $headers `
        -Body $body `
        -ErrorAction Stop
    
    Write-Host "Status: $($response.StatusCode)" -ForegroundColor Green
    Write-Host "Response: $($response.Content)`n"
} catch {
    Write-Host "Status: $($_.Exception.Response.StatusCode.Value__)" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)`n"
}

# Test 3: Resident Move-In Event
Write-Host "Test 3: Resident move-in event (expecting 202)..." -ForegroundColor Yellow
try {
    $body = @{
        CompanyKey = "appstoresandbox"
        CommunityId = 123
        EventType = "residents.move_in"
        EventMessageId = "move-in-$(Get-Date -Format 'yyyyMMddHHmmss')"
        EventMessageDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        NotificationData = @{
            ResidentId = 456
        }
    } | ConvertTo-Json

    $response = Invoke-WebRequest -Uri "$baseUrl/webhook/alis" `
        -Method POST `
        -Headers $headers `
        -Body $body `
        -ErrorAction Stop
    
    Write-Host "Status: $($response.StatusCode)" -ForegroundColor Green
    Write-Host "Response: $($response.Content)`n"
} catch {
    Write-Host "Status: $($_.Exception.Response.StatusCode.Value__)" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)`n"
}

# Test 4: Duplicate Event
Write-Host "Test 4: Duplicate event (expecting 200 on second call)..." -ForegroundColor Yellow
try {
    $duplicateId = "duplicate-test-$(Get-Date -Format 'yyyyMMddHHmmss')"
    $body = @{
        CompanyKey = "appstoresandbox"
        EventType = "residents.move_in"
        EventMessageId = $duplicateId
        EventMessageDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    } | ConvertTo-Json

    # First call
    Write-Host "  First call..." -ForegroundColor Gray
    $response1 = Invoke-WebRequest -Uri "$baseUrl/webhook/alis" `
        -Method POST `
        -Headers $headers `
        -Body $body `
        -ErrorAction Stop
    Write-Host "  Status: $($response1.StatusCode) - $($response1.Content)" -ForegroundColor Green

    # Second call (duplicate)
    Start-Sleep -Milliseconds 500
    Write-Host "  Second call (duplicate)..." -ForegroundColor Gray
    $response2 = Invoke-WebRequest -Uri "$baseUrl/webhook/alis" `
        -Method POST `
        -Headers $headers `
        -Body $body `
        -ErrorAction Stop
    Write-Host "  Status: $($response2.StatusCode) - $($response2.Content)" -ForegroundColor Green
    Write-Host ""
} catch {
    Write-Host "Status: $($_.Exception.Response.StatusCode.Value__)" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)`n"
}

Write-Host "=== All Tests Complete ===" -ForegroundColor Cyan