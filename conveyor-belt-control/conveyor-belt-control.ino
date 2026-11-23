#include <Stepper.h>

const int stepsPerRevolution = 2048;
Stepper myStepper(stepsPerRevolution, 2, 4, 3, 5);   // IN1..IN4 = D2..D5

const int BUTTON_PIN = 6;              // ปุ่ม: D6 <-> GND
const int LED_PIN = LED_BUILTIN;       // ไฟบนบอร์ด ติด = กำลังวิ่ง
const unsigned long DEBOUNCE_MS = 50;

bool isRunning = true;
int lastReading = HIGH;
int stableState = HIGH;
unsigned long lastChangeTime = 0;

void releaseMotor() {                  // ตัดไฟขดลวดตอนหยุด กันร้อน
  for (int pin = 2; pin <= 5; pin++) digitalWrite(pin, LOW);
}

void setup() {
  Serial.begin(9600);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  myStepper.setSpeed(10);
  digitalWrite(LED_PIN, isRunning);
}

void loop() {
  int reading = digitalRead(BUTTON_PIN);
  if (reading != lastReading) {
    lastChangeTime = millis();
    lastReading = reading;
  }
  if ((millis() - lastChangeTime) > DEBOUNCE_MS && reading != stableState) {
    stableState = reading;
    if (stableState == LOW) {          // กดลง 1 ครั้ง = สลับสถานะ
      isRunning = !isRunning;
      digitalWrite(LED_PIN, isRunning);
      if (!isRunning) releaseMotor();
      Serial.println(isRunning ? "Motor resumed." : "Motor stopped.");
    }
  }

  if (isRunning) myStepper.step(1);
}