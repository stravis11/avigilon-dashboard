#!/usr/bin/env python3
"""
Avigilon Cloud Token Fetcher

Automates login to us.cloud.avigilon.com using Playwright,
captures the internal HMS JWT token, and POSTs it to the backend.
Runs in a loop, refreshing every REFRESH_INTERVAL_HOURS hours.
Exposes a simple HTTP endpoint on port 8080 for manual trigger.
"""

import os
import sys
import time
import json
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
import requests
from playwright.sync_api import sync_playwright, TimeoutError as PwTimeout

# --- Config from environment ---
CLOUD_EMAIL = os.environ.get("CLOUD_EMAIL", "")
CLOUD_PASSWORD = os.environ.get("CLOUD_PASSWORD", "")
BACKEND_URL = os.environ.get("BACKEND_URL", "http://backend:3001")
REFRESH_INTERVAL_HOURS = float(os.environ.get("REFRESH_INTERVAL_HOURS", "24"))
RETRY_INTERVAL_MINUTES = float(os.environ.get("RETRY_INTERVAL_MINUTES", "5"))
TRIGGER_PORT = int(os.environ.get("TRIGGER_PORT", "8080"))

LOGIN_URL = "https://us.cloud.avigilon.com/unity/"
SCREENSHOT_DIR = "/app/screenshots"

# Event used to interrupt sleep for manual trigger
trigger_event = threading.Event()


def log(msg):
    """Print with timestamp."""
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def save_screenshot(page, name):
    """Save a debug screenshot."""
    os.makedirs(SCREENSHOT_DIR, exist_ok=True)
    path = f"{SCREENSHOT_DIR}/{name}.png"
    try:
        page.screenshot(path=path)
        log(f"Screenshot saved: {path}")
    except Exception as e:
        log(f"Screenshot failed: {e}")


def find_and_fill(page, selectors, value, description="field"):
    """Try multiple selectors to find and fill a field."""
    for selector in selectors:
        try:
            el = page.locator(selector)
            if el.count() > 0 and el.first.is_visible():
                el.first.fill(value)
                log(f"Filled {description} using selector: {selector}")
                return True
        except Exception:
            continue
    return False


def find_and_click(page, selectors, description="button"):
    """Try multiple selectors to find and click a button."""
    for selector in selectors:
        try:
            el = page.locator(selector)
            if el.count() > 0 and el.first.is_visible():
                el.first.click()
                log(f"Clicked {description} using selector: {selector}")
                return True
        except Exception:
            continue
    return False


def capture_token(email: str, password: str) -> str:
    """
    Log into Avigilon Cloud and capture the internal HMS JWT token.
    Returns the raw JWT string (without 'Bearer ' prefix).
    """
    captured_token = None

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1280, "height": 720},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        page = context.new_page()

        def handle_request(request):
            nonlocal captured_token
            auth = request.headers.get("authorization", "")
            if auth.startswith("Bearer eyJ") and "ingress.cluster" in request.url:
                captured_token = auth[7:]  # Strip 'Bearer ' prefix
                log(f"Captured JWT token from request to {request.url[:80]}...")

        page.on("request", handle_request)

        # Step 1: Navigate to login page
        log("Navigating to Avigilon Cloud login...")
        page.goto(LOGIN_URL, wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(3000)
        save_screenshot(page, "01_login_page")

        # Log page info for debugging
        log(f"Page URL: {page.url}")
        log(f"Page title: {page.title()}")

        # Step 2: Enter email - try various selectors (Azure AD B2C, standard, etc.)
        log("Looking for email field...")
        email_selectors = [
            'input[type="email"]',
            'input[name="loginfmt"]',           # Microsoft login
            'input#signInName',                  # Azure AD B2C
            'input#logonIdentifier',             # Azure AD B2C variant
            'input#i0116',                       # Microsoft account
            'input[name="Email"]',
            'input[name="email"]',
            'input[name="username"]',
            'input[placeholder*="email" i]',
            'input[placeholder*="Email" i]',
            'input[type="text"]',                # Fallback: first text input
        ]

        if not find_and_fill(page, email_selectors, email, "email"):
            save_screenshot(page, "02_email_not_found")
            # Log all visible inputs for debugging
            inputs = page.locator("input").all()
            log(f"Found {len(inputs)} input elements:")
            for i, inp in enumerate(inputs):
                try:
                    log(f"  Input {i}: type={inp.get_attribute('type')}, "
                        f"name={inp.get_attribute('name')}, "
                        f"id={inp.get_attribute('id')}, "
                        f"placeholder={inp.get_attribute('placeholder')}, "
                        f"visible={inp.is_visible()}")
                except:
                    pass
            # Also check for iframes
            frames = page.frames
            log(f"Found {len(frames)} frames:")
            for f in frames:
                log(f"  Frame: {f.url[:100]}")
            browser.close()
            raise RuntimeError("Could not find email input field")

        page.wait_for_timeout(1000)

        # Step 3: Click submit/next button
        submit_selectors = [
            'button[type="submit"]',
            'input[type="submit"]',
            'button#next',                       # Azure AD B2C
            'input#next',                        # Azure AD B2C
            'button#idSIButton9',                # Microsoft login
            'button:has-text("Next")',
            'button:has-text("Sign in")',
            'button:has-text("Continue")',
        ]

        find_and_click(page, submit_selectors, "submit/next")
        page.wait_for_timeout(3000)
        save_screenshot(page, "03_after_email")
        log(f"Page URL after email: {page.url}")

        # Step 4: Enter password
        log("Looking for password field...")
        password_selectors = [
            'input[type="password"]',
            'input#password',                    # Azure AD B2C
            'input#i0118',                       # Microsoft account
            'input[name="passwd"]',              # Microsoft
            'input[name="Password"]',
            'input[name="password"]',
        ]

        if not find_and_fill(page, password_selectors, password, "password"):
            save_screenshot(page, "04_password_not_found")
            inputs = page.locator("input").all()
            log(f"Found {len(inputs)} input elements on password page:")
            for i, inp in enumerate(inputs):
                try:
                    log(f"  Input {i}: type={inp.get_attribute('type')}, "
                        f"name={inp.get_attribute('name')}, "
                        f"id={inp.get_attribute('id')}, "
                        f"visible={inp.is_visible()}")
                except:
                    pass
            browser.close()
            raise RuntimeError("Could not find password input field")

        page.wait_for_timeout(1000)

        # Step 5: Click sign in button
        signin_selectors = [
            'button[type="submit"]',
            'input[type="submit"]',
            'button#next',
            'button#idSIButton9',
            'button:has-text("Sign in")',
            'button:has-text("Log in")',
            'button:has-text("Submit")',
        ]

        find_and_click(page, signin_selectors, "sign in")
        save_screenshot(page, "05_after_password")

        # Step 6: Handle "Stay signed in?" prompt (Microsoft)
        page.wait_for_timeout(3000)
        stay_signed_in_selectors = [
            'button#idSIButton9',                # "Yes" on stay signed in
            'button:has-text("Yes")',
            'button:has-text("No")',              # Click No to continue
            'input#idBtn_Back',                   # "No" button
        ]
        if find_and_click(page, stay_signed_in_selectors, "stay signed in prompt"):
            log("Handled 'Stay signed in?' prompt")

        # Step 7: Wait for app to load and make API calls
        log("Waiting for app to load and make API calls...")
        page.wait_for_timeout(15000)
        save_screenshot(page, "06_app_loaded")
        log(f"Page URL after login: {page.url}")

        # Step 8: Navigate to Health Monitor to trigger HMS API calls
        if not captured_token:
            log("Token not captured yet, navigating to Health Monitor...")
            try:
                page.goto(LOGIN_URL + "#/healthMonitor", wait_until="networkidle", timeout=30000)
                page.wait_for_timeout(10000)
                save_screenshot(page, "07_health_monitor")
            except PwTimeout:
                log("Health Monitor page load timed out, checking if token was captured...")

        # Step 9: Last resort - navigate to servers page
        if not captured_token:
            log("Still no token, trying servers page...")
            try:
                page.goto(LOGIN_URL + "#/servers", wait_until="networkidle", timeout=30000)
                page.wait_for_timeout(10000)
                save_screenshot(page, "08_servers_page")
            except PwTimeout:
                log("Servers page load timed out")

        browser.close()

    if not captured_token:
        raise RuntimeError("Failed to capture JWT token. Check credentials or login flow. See screenshots in /app/screenshots/")

    return captured_token


def submit_token_to_backend(token: str) -> dict:
    """POST the captured token to the backend API."""
    secret = os.environ.get("CLOUD_TOKEN_SECRET", "")

    if secret:
        url = f"{BACKEND_URL}/api/cloud/token-submit"
        log(f"Submitting token to backend at {url}...")
        response = requests.post(url, json={"token": token, "secret": secret}, timeout=30)
    else:
        url = f"{BACKEND_URL}/api/cloud/token"
        log(f"Submitting token to backend at {url}...")
        response = requests.post(url, json={"token": token}, timeout=30)

    response.raise_for_status()
    data = response.json()

    if data.get("success"):
        expires = data.get("data", {}).get("expiresAt")
        if expires:
            exp_str = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(expires))
            log(f"Token accepted by backend. Expires: {exp_str}")
        else:
            log("Token accepted by backend.")
    else:
        raise RuntimeError(f"Backend rejected token: {data.get('error', 'unknown error')}")

    return data


def run_once():
    """Capture token and submit to backend. Returns True on success."""
    try:
        token = capture_token(CLOUD_EMAIL, CLOUD_PASSWORD)
        submit_token_to_backend(token)
        return True
    except Exception as e:
        log(f"ERROR: {e}")
        return False


# --- HTTP trigger server ---

class TriggerHandler(BaseHTTPRequestHandler):
    """Simple HTTP handler that triggers a token refresh on POST /trigger."""

    def do_POST(self):
        if self.path == "/trigger":
            log("Manual token refresh triggered via HTTP")
            trigger_event.set()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "message": "Token refresh triggered"}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok"}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        # Suppress default request logging
        pass


def start_trigger_server():
    """Start the HTTP trigger server in a background thread."""
    server = HTTPServer(("0.0.0.0", TRIGGER_PORT), TriggerHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    log(f"Trigger server listening on port {TRIGGER_PORT}")


def main():
    """Main loop: fetch token, sleep, repeat. Supports manual trigger via HTTP."""
    log("=" * 60)
    log("Avigilon Cloud Token Fetcher starting")
    log(f"  Backend URL: {BACKEND_URL}")
    log(f"  Cloud email: {CLOUD_EMAIL[:3]}***" if CLOUD_EMAIL else "  Cloud email: NOT SET")
    log(f"  Refresh interval: {REFRESH_INTERVAL_HOURS} hours")
    log(f"  Retry interval: {RETRY_INTERVAL_MINUTES} minutes")
    log(f"  Trigger port: {TRIGGER_PORT}")
    log("=" * 60)

    if not CLOUD_EMAIL or not CLOUD_PASSWORD:
        log("FATAL: CLOUD_EMAIL and CLOUD_PASSWORD environment variables must be set.")
        sys.exit(1)

    # Start HTTP trigger server
    start_trigger_server()

    while True:
        success = run_once()

        if success:
            sleep_seconds = REFRESH_INTERVAL_HOURS * 3600
            log(f"Next refresh in {REFRESH_INTERVAL_HOURS} hours. POST to :{TRIGGER_PORT}/trigger to refresh now.")
        else:
            sleep_seconds = RETRY_INTERVAL_MINUTES * 60
            log(f"Will retry in {RETRY_INTERVAL_MINUTES} minutes.")

        # Wait for either the sleep interval or a manual trigger
        triggered = trigger_event.wait(timeout=sleep_seconds)
        if triggered:
            log("Woken up by manual trigger")
            trigger_event.clear()


if __name__ == "__main__":
    main()
