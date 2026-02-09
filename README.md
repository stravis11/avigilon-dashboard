# Avigilon Dashboard

A full-stack web application for managing and monitoring Avigilon Control Center (ACC) cameras, sites, and cloud hardware health. Built with React frontend, Node.js backend, and an automated cloud token fetcher.

## Screenshots

### Login Page
![Login Page](docs/screenshots/login.png)

### Dashboard
![Dashboard](docs/screenshots/dashboard.png)

### Cameras View
![Cameras](docs/screenshots/cameras.png)

### User Management (Admin)
![User Management](docs/screenshots/users.png)

## Features

- **User Authentication**: Secure JWT-based login with role-based access control
- **Admin User Management**: Create, edit, and delete user accounts (admin only)
- **Dashboard Overview**: View system statistics, server information, and site summary
- **Cloud Hardware Health**: Monitor PSUs, temperatures, cooling, disks, CPU, and memory via Avigilon Cloud HMS API
- **Automated Token Fetcher**: Docker sidecar that automatically captures cloud JWT tokens every 24 hours
- **Camera Management**: Browse all cameras, view snapshots, and manage camera settings
- **Site Information**: Access detailed information about ACC sites
- **Real-time Status**: Monitor connection status and camera availability
- **RESTful API**: Clean API interface to ACC Web Endpoint Service
- **Dark Mode**: Toggle between light and dark themes

## Prerequisites

Before you begin, ensure you have the following installed:

- **Docker and Docker Compose** (recommended for deployment)
- **Node.js** (v18 or higher) — only needed for local development without Docker
- **Avigilon Control Center** (ACC 6 or ACC 7)
- **ACC Web Endpoint Service** installed on your ACC server
- **API Credentials**: User nonce and user key from Avigilon Technology Partner Program
- **Avigilon Cloud Account** (optional, for hardware health monitoring)

### Getting API Credentials

To use this application, you need to register for the Avigilon Technology Partner Program:

1. Visit the Avigilon Partner Portal
2. Register for API access
3. Obtain your `user_nonce` and `user_key`
4. Ensure the ACC Web Endpoint Service is installed on your ACC server

For more information, visit: https://support.avigilon.com/s/article/How-to-obtain-REST-API-SDK-Support

## Quick Start with Docker (Recommended)

### 1. Clone or Extract the Project

```bash
cd avigilon-app
```

### 2. Configure Environment

```bash
cp backend/.env.example backend/.env
# Edit backend/.env with your credentials
```

**Configure your `backend/.env` file:**

```env
PORT=3001
NODE_ENV=development

# Your ACC Server Details
ACC_SERVER_URL=https://your-acc-server-ip:8443
ACC_USERNAME=your_username
ACC_PASSWORD=your_password
ACC_USER_NONCE=your_user_nonce_from_avigilon
ACC_USER_KEY=your_user_key_from_avigilon

# Avigilon Cloud API (optional, for hardware health monitoring)
CLOUD_SITE_ID=your_cloud_site_id
CLOUD_TOKEN_SECRET=pick-a-secret-passphrase
CLOUD_EMAIL=your_cloud_portal_email
CLOUD_PASSWORD=your_cloud_portal_password

# CORS Configuration
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

### 3. Build and Start

```bash
docker compose build
docker compose up -d
```

### 4. Access the Application

- Frontend: http://localhost:3000
- Backend API: http://localhost:3001

### 5. Login

Use the default admin credentials:
- **Username:** `admin`
- **Password:** `Avigilon`

> **Note:** Change the default password after first login.

## Docker Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                       Docker Network                             │
│                                                                  │
│  ┌──────────────┐        ┌──────────────────────┐               │
│  │   Frontend   │        │      Backend         │               │
│  │   (nginx)    │ ────>  │   (Node.js/Express)  │               │
│  │   Port 3000  │        │      Port 3001       │               │
│  └──────────────┘        └──────────────────────┘               │
│                                    ▲                             │
│                                    │ POST /api/cloud/token-submit│
│                          ┌─────────┴────────────┐               │
│                          │   Token Fetcher      │               │
│                          │  (Python/Playwright) │               │
│                          │   Runs every 24hrs   │               │
│                          └──────────────────────┘               │
└──────────────────────────────────────────────────────────────────┘
```

**Services:**
- **Frontend**: nginx serving the React build, proxies `/api/` requests to the backend
- **Backend**: Node.js Express API with health checks, ACC proxy, and cloud API integration
- **Token Fetcher**: Python sidecar with headless Chromium that automates Avigilon Cloud login to capture JWT tokens. Runs every 24 hours and supports on-demand refresh via the Cloud Settings page.
- **Data persistence**: User data stored in a mounted volume (`backend/src/data/`)

### Docker Commands

```bash
# Build images
docker compose build

# Start containers (detached)
docker compose up -d

# View logs for all services
docker compose logs -f

# View token-fetcher logs specifically
docker compose logs -f token-fetcher

# Stop containers
docker compose down

# Rebuild and restart
docker compose up -d --build
```

## Cloud Hardware Health Monitoring

The dashboard integrates with the Avigilon Cloud HMS (Health Monitoring Service) API to display hardware health data for each server, including:

- **Power Supplies**: Status, location, and health state
- **Temperature Probes**: Current readings and sensor status
- **Cooling Devices**: Fan status and health
- **Disk Arrays**: Drive state, serial number, and SMART alerts
- **CPU Usage**: System CPU and ACC process CPU percentages
- **Memory Usage**: Used/total with percentage breakdown

### How It Works

1. The **token-fetcher** container launches a headless Chromium browser and logs into `us.cloud.avigilon.com` using your cloud credentials
2. It intercepts the internal HMS JWT token from API requests made during the session
3. The token is submitted to the backend, which immediately fetches and caches health data for all servers (24-hour cache)
4. The token itself expires after ~1 hour, but the cached health data persists on the dashboard until the next refresh cycle
5. Every 24 hours, the process repeats automatically

### Manual Token Refresh

You can trigger a manual token refresh from the **Cloud** page in the dashboard by clicking the **Refresh Token** button. This is useful if you need fresh health data before the next automatic cycle.

## Local Development (Without Docker)

### Backend Setup

```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your credentials
npm run dev  # Uses nodemon for auto-reload
```

The backend will start on `http://localhost:3001`

### Frontend Setup

```bash
cd frontend
npm install
npm run dev  # Vite dev server with HMR
```

The frontend will start on `http://localhost:5173`

## Project Structure

```
avigilon-app/
├── backend/
│   ├── src/
│   │   ├── controllers/
│   │   │   ├── avigilonController.js    # ACC request handlers
│   │   │   ├── cloudController.js       # Cloud API handlers
│   │   │   ├── authController.js        # Login/logout handlers
│   │   │   └── userController.js        # User CRUD handlers
│   │   ├── middleware/
│   │   │   └── authMiddleware.js        # JWT verification
│   │   ├── routes/
│   │   │   ├── api.js                   # ACC & Cloud API routes
│   │   │   └── auth.js                  # Auth routes
│   │   ├── services/
│   │   │   ├── avigilonService.js       # ACC API integration
│   │   │   ├── cloudApiService.js       # Cloud HMS API integration
│   │   │   ├── cloudApiServiceInstance.js # Cloud service singleton
│   │   │   └── authService.js           # JWT & user management
│   │   ├── data/
│   │   │   └── users.json               # User data storage
│   │   └── index.js                     # Express server
│   ├── Dockerfile
│   ├── .env.example
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── ThemeToggle.jsx          # Dark mode toggle
│   │   │   └── ProtectedRoute.jsx       # Auth route guard
│   │   ├── context/
│   │   │   ├── ThemeContext.jsx          # Theme state
│   │   │   └── AuthContext.jsx          # Auth state
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx            # Dashboard with server health
│   │   │   ├── CloudSettings.jsx        # Cloud connection management
│   │   │   ├── Cameras.jsx              # Cameras page
│   │   │   ├── Login.jsx                # Login page
│   │   │   └── UserManagement.jsx       # User admin page
│   │   ├── services/
│   │   │   ├── apiService.js            # ACC & Cloud API client
│   │   │   └── authService.js           # Auth API client
│   │   ├── App.jsx                      # Main app component
│   │   ├── main.jsx                     # Entry point
│   │   └── index.css                    # Global styles
│   ├── Dockerfile
│   ├── nginx.conf
│   └── package.json
│
├── token-fetcher/
│   ├── fetch_token.py                   # Playwright login & token capture
│   ├── Dockerfile                       # Python/Playwright Docker image
│   └── requirements.txt                 # Python dependencies
│
├── docker-compose.yml                   # Docker orchestration (3 services)
│
└── docs/
    └── screenshots/                     # Application screenshots
```

## API Endpoints

### Authentication Routes (Public)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login with username/password |
| POST | `/api/auth/refresh` | Refresh access token |

### Authentication Routes (Protected)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/logout` | Logout user |
| GET | `/api/auth/me` | Get current user info |

### User Management Routes (Admin Only)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/auth/users` | List all users |
| POST | `/api/auth/users` | Create new user |
| PUT | `/api/auth/users/:id` | Update user |
| DELETE | `/api/auth/users/:id` | Delete user |

### ACC API Routes (Protected)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check (public) |
| GET | `/api/test-connection` | Test ACC connection |
| GET | `/api/server/ids` | Get server IDs |
| GET | `/api/servers` | Get all servers |
| GET | `/api/servers/:serverId` | Get server details |
| GET | `/api/servers/:serverId/extended` | Get extended server info |
| GET | `/api/sites` | Get all sites |
| GET | `/api/sites/:siteId` | Get site by ID |
| GET | `/api/cameras` | Get all cameras |
| GET | `/api/cameras/:cameraId` | Get camera details |
| GET | `/api/cameras/:cameraId/snapshot` | Get camera snapshot |
| GET | `/api/dashboard/stats` | Get dashboard statistics |

### Cloud API Routes (Protected)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/cloud/token` | Set cloud JWT token |
| GET | `/api/cloud/status` | Get cloud connection status |
| DELETE | `/api/cloud/token` | Clear cloud token |
| GET | `/api/cloud/servers` | List cloud servers |
| GET | `/api/cloud/servers/:serverId` | Get cloud server details |
| GET | `/api/cloud/health-summary` | Get all servers' health data |
| POST | `/api/cloud/refresh-token` | Trigger manual token refresh |

## Configuration

### Backend Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port (default: 3001) | No |
| `NODE_ENV` | Environment (development/production) | No |
| `ACC_SERVER_URL` | ACC server URL with port | Yes |
| `ACC_USERNAME` | ACC username | Yes |
| `ACC_PASSWORD` | ACC password | Yes |
| `ACC_USER_NONCE` | API nonce from Avigilon | Yes |
| `ACC_USER_KEY` | API key from Avigilon | Yes |
| `CLOUD_SITE_ID` | Avigilon Cloud site ID | For cloud features |
| `CLOUD_TOKEN_SECRET` | Shared secret for token submission | For cloud features |
| `CLOUD_EMAIL` | Avigilon Cloud portal email | For cloud features |
| `CLOUD_PASSWORD` | Avigilon Cloud portal password | For cloud features |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins | No |

## Security Notes

1. **Never commit `.env` files** — Keep your credentials secure
2. **Use HTTPS in production** — Enable SSL/TLS for both frontend and backend
3. **User Authentication** — JWT-based authentication with 15-minute access tokens
4. **Password Security** — Passwords hashed with bcrypt (10 salt rounds)
5. **Rate limiting** — Implemented for API endpoints
6. **CORS configuration** — Update allowed origins for production
7. **Default Admin** — Change the default admin password after first login
8. **Cloud credentials** — The token-fetcher runs on an internal Docker network; cloud credentials never leave the server

## Troubleshooting

### Connection Failed

**Problem:** Cannot connect to ACC server

**Solutions:**
1. Verify ACC Web Endpoint Service is running on your ACC server
2. Check `ACC_SERVER_URL` in `.env` is correct
3. Ensure firewall allows connections to ACC server port
4. Verify your ACC credentials are correct
5. Check that your user_nonce and user_key are valid

### No Cloud Health Data

**Problem:** Server detail modal shows no hardware health

**Solutions:**
1. Check `docker compose logs token-fetcher` for login errors
2. Verify `CLOUD_EMAIL` and `CLOUD_PASSWORD` in `.env` are correct
3. Verify `CLOUD_SITE_ID` matches your Avigilon Cloud site
4. Check screenshots in `token-fetcher/screenshots/` for login flow debugging
5. Try clicking **Refresh Token** on the Cloud Settings page

### Token Fetcher Login Fails

**Problem:** Token-fetcher cannot log into Avigilon Cloud

**Solutions:**
1. Verify your cloud portal credentials work at https://us.cloud.avigilon.com
2. Check for MFA/2FA requirements on the cloud account
3. Review screenshots saved to `token-fetcher/screenshots/` for visual debugging
4. Check `docker compose logs token-fetcher` for detailed error messages

### CORS Errors

**Problem:** CORS policy blocking requests

**Solutions:**
1. Add your frontend URL to `ALLOWED_ORIGINS` in backend `.env`
2. Restart the backend server after changing `.env`

### Authentication Failed

**Problem:** 401 or authentication errors

**Solutions:**
1. Verify `ACC_USER_NONCE` and `ACC_USER_KEY` are correct
2. Ensure you're registered in the Avigilon Technology Partner Program
3. Check ACC user credentials have proper permissions

## Technologies Used

### Backend
- **Express.js** — Web framework
- **Axios** — HTTP client for ACC and Cloud APIs
- **Helmet** — Security middleware
- **CORS** — Cross-origin resource sharing
- **dotenv** — Environment configuration

### Frontend
- **React 18** — UI library
- **Vite** — Build tool
- **React Router** — Routing
- **Tailwind CSS** — Styling
- **Lucide React** — Icons
- **Axios** — API client

### Token Fetcher
- **Python 3** — Runtime
- **Playwright** — Browser automation for cloud login
- **Chromium** — Headless browser (bundled in Docker image)

### Infrastructure
- **Docker & Docker Compose** — Container orchestration
- **nginx** — Frontend static file serving and API proxy

## Future Enhancements

- [x] Live video streaming
- [ ] PTZ camera controls
- [ ] Event notifications
- [ ] Alarm management
- [ ] Recording playback
- [x] User authentication and authorization
- [x] Docker containerization
- [x] Cloud hardware health monitoring
- [x] Automated cloud token management
- [ ] Multi-site support
- [ ] Mobile responsive improvements
- [ ] Real-time camera status updates via WebSocket
- [ ] Export camera snapshots
- [ ] Bulk camera operations

## License

This project is for demonstration and development purposes. Ensure compliance with Avigilon's API terms and conditions.

## Support

For ACC API documentation and support:
- Visit: https://docs.avigilon.com
- Support: https://support.avigilon.com

For application issues:
- Check the troubleshooting section above
- Review container logs: `docker compose logs -f`
- Verify your ACC server is accessible and Web Endpoint Service is running

## ACC Web Endpoint Service Installation

The ACC Web Endpoint Service must be installed on the same system as your ACC Server:

1. Download the appropriate version:
   - ACC 6: https://www.avigilon.com/support-and-downloads/
   - ACC 7: https://www.avigilon.com/support-and-downloads/

2. Install the service on your ACC Server machine

3. Verify the service is running on the configured port (default: 8080)

## Getting Started Checklist

- [ ] Docker and Docker Compose installed
- [ ] ACC Server accessible on the network
- [ ] ACC Web Endpoint Service installed
- [ ] Obtained user_nonce and user_key from Avigilon
- [ ] (Optional) Avigilon Cloud account credentials for health monitoring
- [ ] `backend/.env` configured with credentials
- [ ] Containers built: `docker compose build`
- [ ] Containers running: `docker compose up -d`
- [ ] Application accessible at http://localhost:3000
- [ ] Default admin password changed
