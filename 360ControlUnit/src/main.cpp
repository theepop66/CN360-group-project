#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ESP32Servo.h>
#include <ArduinoJson.h>
#include <esp_task_wdt.h>

#include "secrets.h"
#include "ControlUnitState.h"

using namespace controlunit;

// ---- Pin mapping (bench layout, see ControlUnit/control-unit.md) ----
#define PIN_IR_SENSOR  4   // NPN open-collector sensor: LOW = item in beam
#define PIN_SERVO      18
#define PIN_RELAY      19
#define PIN_BUZZER     21
#define PIN_LED_RED    22
#define PIN_LED_GREEN  23

// ---- Static network configuration (adjust to your LAN) ----
IPAddress staticIp(192, 168, 1, 50);
IPAddress gateway(192, 168, 1, 1);
IPAddress subnet(255, 255, 255, 0);
IPAddress dns(8, 8, 8, 8);

const uint32_t WIFI_RETRY_INTERVAL_MS = 5000;

WebServer server(80);
Servo rejectServo;
ControlUnit machine;
Config machineConfig;

// ---- Outbound notify (n8n webhook), parsed from N8N_NOTIFY_URL ----
String notifyHost;
uint16_t notifyPort = 80;
String notifyPath;

class NotifySender {
 public:
  void begin() { parseUrl(N8N_NOTIFY_URL, notifyHost, notifyPort, notifyPath); }

  void fire(const String& payload) {
    if (busy()) {
      return;
    }
    request_ = buildRequest(payload);
    stage_ = Stage::Connecting;
    startedAt_ = millis();
  }

  void update() {
    if (stage_ == Stage::Idle) {
      return;
    }
    if ((uint32_t)(millis() - startedAt_) >= N8N_NOTIFY_TIMEOUT_MS) {
      abort_();
      return;
    }
    switch (stage_) {
      case Stage::Connecting:
        if (client_.connect(notifyHost.c_str(), notifyPort)) {
          stage_ = Stage::Sending;
        } else {
          abort_();
        }
        break;
      case Stage::Sending:
        client_.print(request_);
        stage_ = Stage::Draining;
        break;
      case Stage::Draining:
        while (client_.available()) {
          client_.read();
        }
        if (!client_.connected()) {
          abort_();
        }
        break;
      default:
        break;
    }
  }

  bool busy() const { return stage_ != Stage::Idle; }

 private:
  enum class Stage : uint8_t { Idle, Connecting, Sending, Draining };

  static void parseUrl(const char* url, String& host, uint16_t& port, String& path) {
    const char* p = url;
    if (strncmp(p, "http://", 7) == 0) {
      p += 7;
    }
    String authority(p);
    int slash = authority.indexOf('/');
    String base = (slash >= 0) ? authority.substring(0, slash) : authority;
    path = (slash >= 0) ? authority.substring(slash) : "/";
    int colon = base.indexOf(':');
    if (colon >= 0) {
      host = base.substring(0, colon);
      port = (uint16_t)base.substring(colon + 1).toInt();
    } else {
      host = base;
      port = 80;
    }
  }

  static String buildRequest(const String& payload) {
    String r;
    r += "POST ";
    r += notifyPath;
    r += " HTTP/1.1\r\n";
    r += "Host: ";
    r += notifyHost;
    r += "\r\n";
    r += "Content-Type: application/json\r\n";
    r += "Connection: close\r\n";
    r += "Content-Length: ";
    r += payload.length();
    r += "\r\n\r\n";
    r += payload;
    return r;
  }

  void abort_() {
    client_.stop();
    stage_ = Stage::Idle;
  }

  WiFiClient client_;
  Stage stage_ = Stage::Idle;
  unsigned long startedAt_ = 0;
  String request_;
};

NotifySender notifySender;

// ---- Human-readable names for the status payload ----
static const char* stateName(State s) {
  switch (s) {
    case State::AwaitingVerdict: return "awaiting_verdict";
    case State::Rejecting: return "rejecting";
    case State::Passing: return "passing";
    default: return "idle";
  }
}

static const char* modeName(Mode m) { return m == Mode::Manual ? "manual" : "auto"; }

// ---- Actuator / feedback adapters ----
static void applyAll(Action* out, uint8_t n) {
  for (uint8_t i = 0; i < n; ++i) {
    const Action& a = out[i];
    switch (a.kind) {
      case Action::Kind::Notify:
        notifySender.fire("{\"event\":\"item_detected\"}");
        break;
      case Action::Kind::ServoAngle:
#ifdef ACTUATOR_RELAY
        digitalWrite(PIN_RELAY, a.angle >= machineConfig.rejectAngle ? HIGH : LOW);
#else
        rejectServo.write(a.angle);
#endif
        break;
      case Action::Kind::RedLedOn:
        digitalWrite(PIN_LED_RED, HIGH);
        break;
      case Action::Kind::RedLedOff:
        digitalWrite(PIN_LED_RED, LOW);
        break;
      case Action::Kind::GreenLedOn:
        digitalWrite(PIN_LED_GREEN, HIGH);
        break;
      case Action::Kind::GreenLedOff:
        digitalWrite(PIN_LED_GREEN, LOW);
        break;
      case Action::Kind::BuzzerOn:
        digitalWrite(PIN_BUZZER, HIGH);
        break;
      case Action::Kind::BuzzerOff:
        digitalWrite(PIN_BUZZER, LOW);
        break;
      default:
        break;
    }
  }
}

// ---- CORS so the HUD browser can call the unit directly ----
static void addCorsHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  server.sendHeader("Cache-Control", "no-store");
}

static void sendJson(int code, JsonDocument& doc) {
  String body;
  serializeJson(doc, body);
  addCorsHeaders();
  server.send(code, "application/json", body);
}

static void handlePreflight() {
  addCorsHeaders();
  server.send(204, "text/plain", "");
}

// ---- HTTP handlers ----
static void handleVerdict() {
  Action out[4];
  JsonDocument req;
  deserializeJson(req, server.arg("plain"));
  const char* action = req["action"] | "";
  bool rejected = false;

  uint8_t n = 0;
  if (strcmp(action, "reject") == 0) {
    rejected = true;
    n = machine.acceptVerdict(millis(), Verdict::Reject, out, 4);
  } else if (strcmp(action, "pass") == 0) {
    n = machine.acceptVerdict(millis(), Verdict::Pass, out, 4);
  }
  applyAll(out, n);

  JsonDocument res;
  res["accepted"] = (n > 0);
  if (n > 0) {
    res["status"] = rejected ? "rejected" : "passed";
  } else {
    res["status"] = "ignored";
  }
  sendJson(200, res);
}

static void handleReject() {
  Action out[4];
  uint8_t n = machine.acceptVerdict(millis(), Verdict::Reject, out, 4);
  applyAll(out, n);

  JsonDocument res;
  res["status"] = (n > 0) ? "rejected" : "ignored";
  sendJson(200, res);
}

static void handleMode() {
  JsonDocument req;
  deserializeJson(req, server.arg("plain"));
  const char* requested = req["mode"] | "";

  bool accepted = false;
  if (strcmp(requested, "manual") == 0) {
    accepted = machine.setMode(millis(), Mode::Manual);
  } else if (strcmp(requested, "auto") == 0) {
    accepted = machine.setMode(millis(), Mode::Auto);
  }

  JsonDocument res;
  res["accepted"] = accepted;
  res["mode"] = modeName(machine.mode());
  sendJson(200, res);
}

static void handleServo() {
  Action out[4];
  uint8_t n = 0;
  JsonDocument req;
  deserializeJson(req, server.arg("plain"));

  if (req["sweep"] | false) {
    n = machine.manualSweep(millis(), out, 4);
  } else if (req["angle"].is<int>()) {
    n = machine.manualAngle(millis(), req["angle"].as<int>(), out, 4);
  }
  applyAll(out, n);

  JsonDocument res;
  res["accepted"] = (n > 0);
  sendJson(200, res);
}

static void handleStatus() {
  JsonDocument res;
  res["item_present"] = machine.itemPresent();
  res["state"] = stateName(machine.state());
  res["mode"] = modeName(machine.mode());
  res["pass_count"] = machine.passCount();
  res["reject_count"] = machine.rejectCount();
  sendJson(200, res);
}

static void handleHealth() {
  JsonDocument res;
  res["status"] = "ok";
  res["uptime"] = (uint32_t)(millis() / 1000);
  sendJson(200, res);
}

// ---- Setup / loop ----
static unsigned long lastWifiAttemptMs = 0;

void setup() {
  Serial.begin(115200);

  pinMode(PIN_IR_SENSOR, INPUT_PULLUP);
  pinMode(PIN_RELAY, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  pinMode(PIN_LED_GREEN, OUTPUT);
  digitalWrite(PIN_RELAY, LOW);
  digitalWrite(PIN_BUZZER, LOW);
  digitalWrite(PIN_LED_RED, LOW);
  digitalWrite(PIN_LED_GREEN, LOW);
  rejectServo.attach(PIN_SERVO);
  rejectServo.write(machineConfig.restAngle);

  notifySender.begin();
  machine.init(millis(), machineConfig);

  WiFi.mode(WIFI_STA);
  WiFi.config(staticIp, gateway, subnet, dns);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWifiAttemptMs = millis();

  server.on("/verdict", HTTP_POST, handleVerdict);
  server.on("/verdict", HTTP_OPTIONS, handlePreflight);
  server.on("/reject", HTTP_POST, handleReject);
  server.on("/reject", HTTP_OPTIONS, handlePreflight);
  server.on("/mode", HTTP_POST, handleMode);
  server.on("/mode", HTTP_OPTIONS, handlePreflight);
  server.on("/servo", HTTP_POST, handleServo);
  server.on("/servo", HTTP_OPTIONS, handlePreflight);
  server.on("/status", HTTP_GET, handleStatus);
  server.on("/status", HTTP_OPTIONS, handlePreflight);
  server.on("/health", HTTP_GET, handleHealth);
  server.on("/health", HTTP_OPTIONS, handlePreflight);
  server.begin();

  esp_task_wdt_init(5, true);  // best-effort: timed out -> restart
  esp_task_wdt_add(NULL);

  Serial.print("Control unit ready. IP: ");
  Serial.println(WiFi.localIP());
}

void loop() {
  esp_task_wdt_reset();

  if (WiFi.status() != WL_CONNECTED) {
    unsigned long now = millis();
    if ((uint32_t)(now - lastWifiAttemptMs) >= WIFI_RETRY_INTERVAL_MS) {
      WiFi.disconnect();
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      lastWifiAttemptMs = now;
    }
  }

  server.handleClient();
  notifySender.update();

  bool present = (digitalRead(PIN_IR_SENSOR) == LOW);
  Action out[4];
  uint8_t n = machine.step(millis(), present, out, 4);
  applyAll(out, n);
}