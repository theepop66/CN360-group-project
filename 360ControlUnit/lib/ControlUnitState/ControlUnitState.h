#pragma once

#include <cstdint>

namespace controlunit {

enum class Mode : uint8_t { Auto, Manual };

enum class Verdict : uint8_t { Pass, Reject };

enum class State : uint8_t { Idle, AwaitingVerdict, Rejecting, Passing };

struct Config {
  uint32_t debounceMs = 30;
  uint32_t verdictTimeoutMs = 3000;
  int restAngle = 0;
  int rejectAngle = 90;
  uint32_t rejectOutMs = 150;
  uint32_t rejectHoldMs = 400;
  uint32_t rejectReturnMs = 150;
  uint32_t passSignalMs = 200;
  uint32_t alertHoldMs = 400;
};

struct Action {
  enum class Kind : uint8_t {
    None,
    Notify,
    ServoAngle,
    RedLedOn,
    RedLedOff,
    GreenLedOn,
    GreenLedOff,
    BuzzerOn,
    BuzzerOff
  };
  Kind kind = Kind::None;
  int angle = 0;
};

class ControlUnit {
 public:
  void init(uint32_t now, Config config = Config{});

  uint8_t step(uint32_t now, bool sensorPresent, Action* out, uint8_t cap);
  uint8_t acceptVerdict(uint32_t now, Verdict verdict, Action* out, uint8_t cap);
  bool setMode(uint32_t now, Mode mode);
  uint8_t manualAngle(uint32_t now, int angle, Action* out, uint8_t cap);
  uint8_t manualSweep(uint32_t now, Action* out, uint8_t cap);

  State state() const;
  Mode mode() const;
  bool itemPresent() const;
  uint32_t passCount() const;
  uint32_t rejectCount() const;

 private:
  enum class Phase : uint8_t {
    Idle,
    AwaitVerdict,
    RejectRising,
    RejectHold,
    RejectReturn,
    AlertHold,
    PassSignal
  };

  uint8_t emit(Action::Kind kind, int angle, Action* out, uint8_t cap, uint8_t idx) const;
  uint8_t resolvePass(uint32_t now, Action* out, uint8_t cap, uint8_t idx);

  Config config_;
  uint32_t now_ = 0;
  uint32_t debounceStart_ = 0;
  uint32_t phaseStart_ = 0;
  bool sensorState_ = false;
  bool awaitClear_ = false;
  bool itemPresent_ = false;
  Mode mode_ = Mode::Auto;
  Phase phase_ = Phase::Idle;
  bool rejectSequenceAlerted_ = false;
  uint32_t passCount_ = 0;
  uint32_t rejectCount_ = 0;
};

}  // namespace controlunit