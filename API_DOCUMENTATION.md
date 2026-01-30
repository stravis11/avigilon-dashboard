# API Documentation

## Overview

This document describes the REST API endpoints available in the Avigilon ACC Web Application backend.

**Base URL:** `http://localhost:3001/api`

All responses follow this format:
```json
{
  "success": true,
  "data": { ... }
}
```

Error responses:
```json
{
  "success": false,
  "error": "Error message"
}
```

## Authentication

The API uses server-side authentication with ACC. The backend handles authentication automatically using credentials from the `.env` file.

## Endpoints

### Health & Status

#### GET /health
Check if the API server is running.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

#### GET /test-connection
Test connection to the ACC server.

**Response:**
```json
{
  "success": true,
  "message": "Connection successful"
}
```

### Server Information

#### GET /server/info
Get ACC server information.

**Response:**
```json
{
  "success": true,
  "data": {
    "version": "7.14.0",
    "serverName": "ACC-Server-01",
    "uptime": 12345678
  }
}
```

### Sites

#### GET /sites
Get all sites configured in ACC.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "site-123",
      "name": "Main Office",
      "location": "New York",
      "cameraCount": 25
    }
  ]
}
```

#### GET /sites/:siteId
Get detailed information about a specific site.

**Parameters:**
- `siteId` (path) - The unique identifier of the site

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "site-123",
    "name": "Main Office",
    "location": "New York",
    "cameraCount": 25,
    "serverUrl": "http://192.168.1.100:8080",
    "status": "online"
  }
}
```

### Cameras

#### GET /cameras
Get all cameras, optionally filtered by site.

**Query Parameters:**
- `siteId` (optional) - Filter cameras by site ID

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "camera-456",
      "name": "Entrance Camera",
      "model": "H4 Dome",
      "location": "Main Entrance",
      "siteId": "site-123",
      "status": "online"
    }
  ]
}
```

#### GET /cameras/:cameraId
Get detailed information about a specific camera.

**Parameters:**
- `cameraId` (path) - The unique identifier of the camera

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "camera-456",
    "name": "Entrance Camera",
    "model": "H4 Dome",
    "location": "Main Entrance",
    "siteId": "site-123",
    "ipAddress": "192.168.1.201",
    "resolution": "1920x1080",
    "fps": 30,
    "capabilities": {
      "ptz": false,
      "audio": true,
      "analytics": true
    }
  }
}
```

#### GET /cameras/:cameraId/status
Get the current status of a camera.

**Parameters:**
- `cameraId` (path) - The unique identifier of the camera

**Response:**
```json
{
  "success": true,
  "data": {
    "online": true,
    "recording": true,
    "motionDetected": false,
    "lastSnapshot": "2024-01-15T10:30:00.000Z",
    "bandwidth": "2.5 Mbps",
    "storage": {
      "used": 45.2,
      "total": 500,
      "unit": "GB"
    }
  }
}
```

#### GET /cameras/:cameraId/snapshot
Get a snapshot image from the camera.

**Parameters:**
- `cameraId` (path) - The unique identifier of the camera

**Response:**
- Content-Type: `image/jpeg`
- Binary image data

**Usage in HTML:**
```html
<img src="http://localhost:3001/api/cameras/camera-456/snapshot" alt="Camera snapshot" />
```

#### PUT /cameras/:cameraId
Update camera settings.

**Parameters:**
- `cameraId` (path) - The unique identifier of the camera

**Request Body:**
```json
{
  "name": "New Camera Name",
  "location": "New Location",
  "settings": {
    "motionDetection": true,
    "recordingQuality": "high"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "camera-456",
    "name": "New Camera Name",
    "location": "New Location",
    "updated": true
  }
}
```

## Error Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 400 | Bad Request - Invalid parameters |
| 401 | Unauthorized - Authentication failed |
| 404 | Not Found - Resource doesn't exist |
| 500 | Internal Server Error - Server error or ACC connection issue |
| 503 | Service Unavailable - ACC server is unreachable |

## Rate Limiting

The API implements rate limiting to prevent abuse:
- **Limit:** 100 requests per 15 minutes per IP address
- **Headers:** Response includes `X-RateLimit-*` headers

When rate limit is exceeded:
```json
{
  "success": false,
  "error": "Too many requests from this IP, please try again later."
}
```

## Examples

### JavaScript/Fetch

```javascript
// Get all cameras
fetch('http://localhost:3001/api/cameras')
  .then(response => response.json())
  .then(data => {
    console.log('Cameras:', data.data);
  })
  .catch(error => {
    console.error('Error:', error);
  });

// Get camera status
async function getCameraStatus(cameraId) {
  try {
    const response = await fetch(`http://localhost:3001/api/cameras/${cameraId}/status`);
    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Failed to get camera status:', error);
    throw error;
  }
}

// Update camera
async function updateCamera(cameraId, settings) {
  try {
    const response = await fetch(`http://localhost:3001/api/cameras/${cameraId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(settings),
    });
    return await response.json();
  } catch (error) {
    console.error('Failed to update camera:', error);
    throw error;
  }
}
```

### cURL

```bash
# Test connection
curl http://localhost:3001/api/test-connection

# Get all cameras
curl http://localhost:3001/api/cameras

# Get specific camera
curl http://localhost:3001/api/cameras/camera-456

# Get camera snapshot (save to file)
curl http://localhost:3001/api/cameras/camera-456/snapshot -o snapshot.jpg

# Update camera
curl -X PUT http://localhost:3001/api/cameras/camera-456 \
  -H "Content-Type: application/json" \
  -d '{"name":"Updated Camera Name"}'
```

### Python

```python
import requests

BASE_URL = "http://localhost:3001/api"

# Get all cameras
response = requests.get(f"{BASE_URL}/cameras")
cameras = response.json()['data']

# Get camera status
camera_id = "camera-456"
response = requests.get(f"{BASE_URL}/cameras/{camera_id}/status")
status = response.json()['data']

# Download snapshot
response = requests.get(f"{BASE_URL}/cameras/{camera_id}/snapshot")
with open('snapshot.jpg', 'wb') as f:
    f.write(response.content)
```

## Integration Notes

### ACC Web Endpoint API Mapping

This application serves as a wrapper around the Avigilon ACC Web Endpoint API. The actual API endpoints and data structures depend on your ACC version and configuration.

**Important:**
- Not all ACC features may be available through the Web Endpoint API
- Some endpoints may require specific ACC versions
- Camera capabilities vary by model
- Consult the official ACC API documentation for detailed specifications

### WebSocket Support (Future)

Real-time updates are planned for future versions using WebSocket connections for:
- Live camera status updates
- Event notifications
- Motion detection alerts
- System status changes

### Best Practices

1. **Polling Frequency:** Don't poll camera snapshots more than once per second
2. **Error Handling:** Always implement proper error handling
3. **Timeouts:** Set appropriate timeouts for long-running operations
4. **Caching:** Cache site and camera lists to reduce API calls
5. **Batch Operations:** Use bulk endpoints when available

## Support

For issues or questions:
- Review the main README.md
- Check ACC API documentation at https://docs.avigilon.com
- Contact Avigilon support for ACC-specific issues
