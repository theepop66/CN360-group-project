// Standalone hardware test: red/green LED, servo, 28BYJ-48 stepper (ULN2003).
// Build/upload: pio run -e hwtest -t upload && pio device monitor -b 115200
// Serial commands: r=red  g=green  s=servo  c=stepper CW  w=stepper CCW  a=all  x=stop
#include <Arduino.h>
#include <ESP32Servo.h>

#define PIN_SERVO      18
#define PIN_LED_RED    22
#define PIN_LED_GREEN  23
static const int stepperPins[] = {32, 33, 25, 26};
static const uint8_t halfSteps[] = {0x1, 0x3, 0x2, 0x6, 0x4, 0xc, 0x8, 0x9};
static const int STEPS_PER_REV = 4096;
static const int STEP_DELAY_MS = 3;

Servo servo;

static void blink(int pin, const char* name) {
  Serial.printf("LED %s: blink x3\n", name);
  for (int i = 0; i < 3; ++i) {
    digitalWrite(pin, HIGH);
    delay(300);
    digitalWrite(pin, LOW);
    delay(300);
  }
}

static void testServo() {
  Serial.println("Servo: 0 -> 90 -> 0");
  const int path[] = {0, 45, 90, 45, 0};
  for (int angle : path) {
    Serial.printf("  angle %d\n", angle);
    servo.write(angle);
    delay(700);
  }
}

static void releaseStepper() {
  for (int pin : stepperPins) digitalWrite(pin, LOW);
}

static void testStepper(int direction) {
  Serial.printf("Stepper: 1 rev %s\n", direction > 0 ? "CW" : "CCW");
  int phase = 0;
  for (int i = 0; i < STEPS_PER_REV; ++i) {
    phase = (phase + direction + 8) % 8;
    for (int p = 0; p < 4; ++p) {
      digitalWrite(stepperPins[p], (halfSteps[phase] & (1 << p)) ? HIGH : LOW);
    }
    delay(STEP_DELAY_MS);
    if (Serial.available() && Serial.peek() == 'x') break;
  }
  releaseStepper();
}

static void runCommand(char cmd) {
  switch (cmd) {
    case 'r': blink(PIN_LED_RED, "red"); break;
    case 'g': blink(PIN_LED_GREEN, "green"); break;
    case 's': testServo(); break;
    case 'c': testStepper(1); break;
    case 'w': testStepper(-1); break;
    case 'a':
      blink(PIN_LED_RED, "red");
      blink(PIN_LED_GREEN, "green");
      testServo();
      testStepper(1);
      delay(500);
      testStepper(-1);
      break;
    case 'x': releaseStepper(); Serial.println("stopped"); break;
    default: return;
  }
  Serial.println("done. r/g/s/c/w/a/x:");
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED_RED, OUTPUT);
  pinMode(PIN_LED_GREEN, OUTPUT);
  digitalWrite(PIN_LED_RED, LOW);
  digitalWrite(PIN_LED_GREEN, LOW);
  for (int pin : stepperPins) {
    pinMode(pin, OUTPUT);
    digitalWrite(pin, LOW);
  }
  servo.attach(PIN_SERVO);
  servo.write(0);
  delay(500);
  Serial.println("\nHW test ready. r=red g=green s=servo c=stepper CW w=CCW a=all x=stop");
  runCommand('a');
}

void loop() {
  if (Serial.available()) runCommand((char)Serial.read());
}
