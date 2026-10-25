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
  // What the unit does when no verdict arrives inside verdictTimeoutMs.
  // Reject keeps the line fail-closed: a dead network, n8n, Pi or a slow
  // model can never let an uninspected item through (issue #24).
  Verdict timeoutVerdict = Verdict::Reject;
};

// Result of offering a verdict to the unit.
enum class VerdictResult : uint8_t {
  Accepted,   // applied to the item currently awaiting a verdict
  NotWaiting, // no item is awaiting a verdict (too late or nothing detected)
  Stale       // item_id names an earlier item, not the one awaiting a verdict
};

// One finished item: how long from sensor detection to its outcome.
struct Cycle {
  enum class Outcome : uint8_t { Pass, Reject, Timeout };
  uint32_t itemId = 0;
  uint32_t latencyMs = 0;  // detection -> verdict accepted (or -> timeout)
  Outcome outcome = Outcome::Pass;
};

constexpr uint8_t kCycleHistory = 32;

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
  // itemId == 0 means "unspecified" and matches the current item. A non-zero
  // itemId must equal currentItemId(), or the verdict is refused as Stale.
  uint8_t acceptVerdict(uint32_t now, Verdict verdict, uint32_t itemId, Action* out,
                        uint8_t cap, VerdictResult* result = nullptr);
  bool setMode(uint32_t now, Mode mode);
  uint8_t manualAngle(uint32_t now, int angle, Action* out, uint8_t cap);
  uint8_t manualSweep(uint32_t now, Action* out, uint8_t cap);

  State state() const;
  Mode mode() const;
  bool itemPresent() const;
  uint32_t passCount() const;
  uint32_t rejectCount() const;
  uint32_t timeoutCount() const;
  // Most recent finished items, oldest first; returns how many were written.
  uint8_t recentCycles(Cycle* out, uint8_t cap) const;
  uint32_t cyclesRecorded() const;
  // Id of the most recently detected item (1, 2, 3 ...). 0 before the first.
  uint32_t currentItemId() const;

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
  uint8_t resolveReject(uint32_t now, Action* out, uint8_t cap, uint8_t idx);
  void recordCycle(uint32_t now, Cycle::Outcome outcome);

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
  uint32_t timeoutCount_ = 0;
  uint32_t itemId_ = 0;
  uint32_t detectedAt_ = 0;
  Cycle history_[kCycleHistory];
  uint32_t cyclesRecorded_ = 0;
};

}  // namespace controlunit