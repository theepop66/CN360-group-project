#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ESP32Servo.h>
#include <ArduinoJson.h>
#include <esp_task_wdt.h>
#include <esp_system.h>
#include <atomic>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include <freertos/semphr.h>

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
SemaphoreHandle_t machineMutex;
QueueHandle_t notificationQueue;
struct Notification { char payload[256]; };
std::atomic<uint32_t> notifyFailures{0};

// No automatic admission until reject/retention has been validated on the bench.
#ifndef CN360_BENCH_ADMISSION_ENABLED
#define CN360_BENCH_ADMISSION_ENABLED 0
#endif

// ---- Outbound notify (n8n webhook), parsed from N8N_NOTIFY_URL ----
String notifyHost;
uint16_t notifyPort = 80;
String notifyPath;

class NotifySender {
 public:
  void begin() { parseUrl(N8N_NOTIFY_URL, notifyHost, notifyPort, notifyPath); }

  void fire(const String& payload) {
    if (busy()) {
      ++notifyFailures;
      return;
    }
    request_ = buildRequest(payload);
    stage_ = Stage::Connecting;
    responseLine_ = "";
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
        if (client_.connect(notifyHost.c_str(), notifyPort, 100)) {
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
        for (int read = 0; read < 256 && client_.available(); ++read) {
          const char c = static_cast<char>(client_.read());
          if (!responseLine_.endsWith("\n") && responseLine_.length() < 100) responseLine_ += c;
        }
        if (!client_.connected()) {
          abort_(responseLine_.startsWith("HTTP/1.1 200 ") || responseLine_.startsWith("HTTP/1.0 200 "));
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

  void abort_(bool delivered = false) {
    if (!delivered) ++notifyFailures;
    client_.stop();
    stage_ = Stage::Idle;
  }

  WiFiClient client_;
  Stage stage_ = Stage::Idle;
  unsigned long startedAt_ = 0;
  String request_;
  String responseLine_;
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
        {
          Notification message{};
          const auto& item = machine.itemIdentity();
          snprintf(message.payload, sizeof(message.payload),
                   "{\"event\":\"item_detected\",\"controller_session\":\"%s\",\"item_id\":\"%s\",\"verdict_window_ms\":%lu}",
                   item.controllerSession.c_str(), item.itemId.c_str(),
                   static_cast<unsigned long>(machineConfig.verdictTimeoutMs));
          if (xQueueSend(notificationQueue, &message, 0) != pdTRUE) ++notifyFailures;
        }
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
  const auto error = deserializeJson(req, server.arg("plain"));
  const char* action = req["action"] | "";
  const char* session = req["controller_session"] | "";
  const char* item = req["item_id"] | "";
  const ItemIdentity submitted{std::string(session, req["controller_session"].as<JsonString>().size()),
                               std::string(item, req["item_id"].as<JsonString>().size())};
  const size_t actionLength = req["action"].as<JsonString>().size();
  const bool valid = !error && req["action"].is<const char*>() &&
      req["controller_session"].is<const char*>() && req["item_id"].is<const char*>() &&
      validItemIdentity(submitted) &&
      ((actionLength == 4 && strcmp(action, "pass") == 0) ||
       (actionLength == 6 && strcmp(action, "reject") == 0));
  VerdictReceipt receipt;
  receipt.reason = ReceiptReason::InvalidRequest;
  if (valid) {
    xSemaphoreTake(machineMutex, portMAX_DELAY);
    receipt = machine.acceptVerdict(millis(), submitted,
        strcmp(action, "pass") == 0 ? Verdict::Pass : Verdict::Reject, out, 4);
    applyAll(out, receipt.actionCount);
    xSemaphoreGive(machineMutex);
  }
  JsonDocument res;
  res["accepted"] = receipt.accepted;
  res["status"] = receipt.accepted ? (strcmp(action, "pass") == 0 ? "passed" : "rejected") : "ignored";
  res["reason"] = receiptReasonName(receipt.reason);
  res["controller_session"] = req["controller_session"];
  res["item_id"] = req["item_id"];
  sendJson(valid ? 200 : 400, res);
}

static void handleReject() {
  JsonDocument res;
  res["accepted"] = false;
  res["status"] = "ignored";
  res["reason"] = "item_identity_required";
  sendJson(400, res);
}

static void handleMode() {
  JsonDocument req;
  deserializeJson(req, server.arg("plain"));
  const char* requested = req["mode"] | "";

  bool accepted = false;
  xSemaphoreTake(machineMutex, portMAX_DELAY);
  if (strcmp(requested, "manual") == 0) {
    accepted = machine.setMode(millis(), Mode::Manual);
  } else if (strcmp(requested, "auto") == 0) {
    accepted = machine.setMode(millis(), Mode::Auto);
  }

  JsonDocument res;
  res["accepted"] = accepted;
  res["mode"] = modeName(machine.mode());
  xSemaphoreGive(machineMutex);
  sendJson(200, res);
}

static void handleServo() {
  Action out[4];
  uint8_t n = 0;
  JsonDocument req;
  deserializeJson(req, server.arg("plain"));
  xSemaphoreTake(machineMutex, portMAX_DELAY);
  if (req["sweep"] | false) {
    n = machine.manualSweep(millis(), out, 4);
  } else if (req["angle"].is<int>()) {
    n = machine.manualAngle(millis(), req["angle"].as<int>(), out, 4);
  }
  applyAll(out, n);
  xSemaphoreGive(machineMutex);

  JsonDocument res;
  res["accepted"] = (n > 0);
  sendJson(200, res);
}

static void handleStatus() {
  JsonDocument res;
  xSemaphoreTake(machineMutex, portMAX_DELAY);
  res["item_present"] = machine.itemPresent();
  res["state"] = stateName(machine.state());
  res["mode"] = modeName(machine.mode());
  res["pass_count"] = machine.passCount();
  res["reject_count"] = machine.rejectCount();
  res["controller_session"] = String(machine.itemIdentity().controllerSession.c_str());
  res["item_id"] = String(machine.itemIdentity().itemId.c_str());
  res["resolution_reason"] = machine.resolutionReason();
  res["admission_ready"] = machine.admissionReady();
  res["automatic_admission_enabled"] = machineConfig.admissionEnabled;
  res["verdict_window_ms"] = machineConfig.verdictTimeoutMs;
  res["notify_failures"] = notifyFailures.load();
  xSemaphoreGive(machineMutex);
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

// This task owns local progress independently of HTTP/DNS/socket stalls.
static void controlTask(void*) {
  esp_task_wdt_add(NULL);
  for (;;) {
    esp_task_wdt_reset();
    Action out[4];
    xSemaphoreTake(machineMutex, portMAX_DELAY);
    const auto n = machine.step(millis(), digitalRead(PIN_IR_SENSOR) == LOW, out, 4);
    applyAll(out, n);
    xSemaphoreGive(machineMutex);
    vTaskDelay(pdMS_TO_TICKS(1));
  }
}

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
  WiFi.mode(WIFI_STA);  // Enable RF entropy before generating this boot's token.
  char session[33];
  snprintf(session, sizeof(session), "%08lx%08lx%08lx%08lx",
           static_cast<unsigned long>(esp_random()), static_cast<unsigned long>(esp_random()),
           static_cast<unsigned long>(esp_random()), static_cast<unsigned long>(esp_random()));
  machineConfig.admissionEnabled = CN360_BENCH_ADMISSION_ENABLED == 1;
  machine.init(millis(), machineConfig, session);
  machineMutex = xSemaphoreCreateMutex();
  notificationQueue = xQueueCreate(2, sizeof(Notification));
  esp_task_wdt_init(5, true);
  if (!machineMutex || !notificationQueue ||
      xTaskCreatePinnedToCore(controlTask, "item-control", 6144, nullptr, 2, nullptr, 1) != pdPASS) {
    Serial.println("Control task unavailable; admission disabled.");
    for (;;) delay(1000);
  }

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

  Serial.print("Control unit ready. IP: ");
  Serial.println(WiFi.localIP());
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    unsigned long now = millis();
    if ((uint32_t)(now - lastWifiAttemptMs) >= WIFI_RETRY_INTERVAL_MS) {
      WiFi.disconnect();
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      lastWifiAttemptMs = now;
    }
  }

  server.handleClient();
  Notification message;
  if (!notifySender.busy() && xQueueReceive(notificationQueue, &message, 0) == pdTRUE) {
    notifySender.fire(message.payload);
  }
  notifySender.update();
  delay(1);
}
