#pragma once

// Local (gitignored) secrets — copy src/secrets.example.h and fill in
// YOUR bench Wi-Fi network and n8n instance before flashing.

const char* const WIFI_SSID = "your-wifi-ssid";
const char* const WIFI_PASSWORD = "your-wifi-password";

// Outbound notify target: n8n Webhook Trigger URL for item-detected events.
const char* const N8N_NOTIFY_URL = "http://n8n.local:5678/webhook/item-detected";
const uint32_t N8N_NOTIFY_TIMEOUT_MS = 1500;