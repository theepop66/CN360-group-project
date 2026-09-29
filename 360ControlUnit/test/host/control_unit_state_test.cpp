#include <cstdio>
#include <vector>

#include "ControlUnitState.h"

using namespace controlunit;

static int failures = 0;
static int checks = 0;

#define CHECK(cond)                                                       \
  do {                                                                    \
    ++checks;                                                             \
    if (!(cond)) {                                                        \
      ++failures;                                                         \
      std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);         \
    }                                                                     \
  } while (0)

namespace {

struct Journal {
  Action actions[4];
  uint8_t count = 0;
};

Journal run(ControlUnit& u, uint32_t now, bool present) {
  Journal j;
  j.count = u.step(now, present, j.actions, 4);
  return j;
}

bool has(const Journal& j, Action::Kind kind) {
  for (uint8_t i = 0; i < j.count; ++i) {
    if (j.actions[i].kind == kind) return true;
  }
  return false;
}

int angleOf(const Journal& j) {
  for (uint8_t i = 0; i < j.count; ++i) {
    if (j.actions[i].kind == Action::Kind::ServoAngle) return j.actions[i].angle;
  }
  return -999;
}

void stepRange(ControlUnit& u, uint32_t from, uint32_t to, bool present,
               std::vector<int>* angles = nullptr) {
  for (uint32_t t = from; t <= to; ++t) {
    Journal j = run(u, t, present);
    if (angles) {
      int a = angleOf(j);
      if (a != -999) angles->push_back(a);
    }
  }
}

// Bring the beam high at `presentSince`, then let the debounce elapse before
// `now` so the cycle opens exactly once.
void detectItem(ControlUnit& u, uint32_t presentSince, uint32_t now) {
  (void)run(u, presentSince, true);
  (void)run(u, now, true);
}

Config fastConfig() {
  Config c;
  c.debounceMs = 10;
  c.verdictTimeoutMs = 1000;
  c.rejectOutMs = 50;
  c.rejectHoldMs = 100;
  c.rejectReturnMs = 50;
  c.passSignalMs = 40;
  c.alertHoldMs = 50;
  return c;
}

}  // namespace

void testDetectionOpensCycleAndNotifies() {
  ControlUnit u;
  u.init(0, fastConfig());
  detectItem(u, 20, 41);

  CHECK(u.state() == State::AwaitingVerdict);
  CHECK(u.itemPresent() == true);
  Journal none = run(u, 50, true);
  CHECK(!has(none, Action::Kind::Notify));  // notify fired exactly once at open
}

void testRejectSweepSequencedAndCounted() {
  ControlUnit u;
  u.init(0, fastConfig());
  detectItem(u, 20, 41);
  CHECK(u.state() == State::AwaitingVerdict);

  Action a[4];
  uint8_t written = u.acceptVerdict(50, Verdict::Reject, a, 4);

  CHECK(written >= 3);                       // red on, buzzer on, servo out
  CHECK(u.state() == State::Rejecting);
  CHECK(u.rejectCount() == 1);
  CHECK(u.passCount() == 0);

  std::vector<int> angles;
  for (uint8_t i = 0; i < written; ++i) {
    if (a[i].kind == Action::Kind::ServoAngle) angles.push_back(a[i].angle);
  }
  stepRange(u, 51, 1200, true, &angles);
  CHECK(u.state() == State::Idle);
  CHECK(u.rejectCount() == 1);
  CHECK(angles.size() == 2);                 // out to reject, back to rest
  CHECK(angles[0] == fastConfig().rejectAngle);
  CHECK(angles[1] == fastConfig().restAngle);
}

void testExplicitPassSkipsActuation() {
  ControlUnit u;
  u.init(0, fastConfig());
  detectItem(u, 20, 41);

  Action a[4];
  uint8_t written = u.acceptVerdict(60, Verdict::Pass, a, 4);

  CHECK(written >= 1);
  CHECK(u.passCount() == 1);
  CHECK(u.rejectCount() == 0);
  std::vector<int> angles;
  stepRange(u, 61, 1200, true, &angles);
  CHECK(u.state() == State::Idle);
  CHECK(angles.empty());
}

void testTimeoutResolvesToPassByDefault() {
  ControlUnit u;
  u.init(0, fastConfig());
  detectItem(u, 20, 41);

  std::vector<int> angles;
  stepRange(u, 50, 1200, true, &angles);
  CHECK(u.state() == State::Idle);
  CHECK(u.passCount() == 1);
  CHECK(u.rejectCount() == 0);
  CHECK(angles.empty());
}

void testExplicitPassBeforeTimeoutWins() {
  ControlUnit u;
  u.init(0, fastConfig());
  detectItem(u, 20, 41);

  Action a[4];
  uint8_t written = u.acceptVerdict(200, Verdict::Pass, a, 4);
  CHECK(written >= 1);
  stepRange(u, 201, 1200, true);
  CHECK(u.passCount() == 1);
  CHECK(u.state() == State::Idle);
}

void testLateVerdictIgnored() {
  ControlUnit u;
  u.init(0, fastConfig());
  detectItem(u, 20, 41);
  Action a[4];
  CHECK(u.acceptVerdict(50, Verdict::Reject, a, 4) >= 1);
  stepRange(u, 51, 1200, true);
  CHECK(u.state() == State::Idle);

  CHECK(u.acceptVerdict(1500, Verdict::Reject, a, 4) == 0);
  CHECK(u.rejectCount() == 1);
  CHECK(u.acceptVerdict(1600, Verdict::Pass, a, 4) == 0);
  CHECK(u.passCount() == 0);
}

void testRetriggerDuringCycleIgnored() {
  ControlUnit u;
  u.init(0, fastConfig());
  detectItem(u, 20, 41);
  CHECK(u.state() == State::AwaitingVerdict);

  int notifyCount = 0;
  for (uint32_t t = 50; t < 1041; ++t) {    // cycle resolves at 41+1000
    bool present = (t / 40) % 2 == 0;       // 40ms-high/40ms-low flicker
    Journal j = run(u, t, present);
    if (has(j, Action::Kind::Notify)) ++notifyCount;
  }
  CHECK(notifyCount == 0);
  CHECK(u.state() == State::AwaitingVerdict);
  CHECK(u.passCount() == 0);
  CHECK(u.rejectCount() == 0);
}

void testDebounceSuppressesFlicker() {
  ControlUnit u;
  u.init(0, fastConfig());

  // Sub-debounce blip at t=5..9 must not open a cycle.
  (void)run(u, 5, true);
  (void)run(u, 9, false);
  CHECK(u.state() == State::Idle);

  // Sustained block now opens a cycle.
  detectItem(u, 20, 41);
  CHECK(u.state() == State::AwaitingVerdict);
}

void testManualCommandsRefusedInAutoMode() {
  ControlUnit u;
  u.init(0, fastConfig());
  CHECK(u.mode() == Mode::Auto);

  Action a[4];
  CHECK(u.manualAngle(10, 45, a, 4) == 0);
  CHECK(u.manualSweep(10, a, 4) == 0);
  CHECK(u.state() == State::Idle);
}

void testModeSwitchOnlyAtIdle() {
  ControlUnit u;
  u.init(0, fastConfig());
  Action a[4];
  CHECK(u.setMode(1, Mode::Manual));

  u.setMode(3, Mode::Auto);
  detectItem(u, 20, 41);
  CHECK(u.state() == State::AwaitingVerdict);
  CHECK(!u.setMode(100, Mode::Manual));
  CHECK(u.mode() == Mode::Auto);

  stepRange(u, 101, 1200, true);
  CHECK(u.state() == State::Idle);
  CHECK(u.setMode(1210, Mode::Manual));
  CHECK(u.mode() == Mode::Manual);
}

void testManualAngleAndSweepInManualMode() {
  ControlUnit u;
  u.init(0, fastConfig());
  Action a[4];
  u.setMode(1, Mode::Manual);

  CHECK(u.manualAngle(10, 45, a, 4) == 1);
  uint8_t written = u.manualAngle(11, 300, a, 4);  // clamped to 180
  CHECK(written == 1);
  CHECK(a[0].kind == Action::Kind::ServoAngle);
  CHECK(a[0].angle == 180);
  written = u.manualAngle(12, -5, a, 4);  // clamped to 0
  CHECK(written == 1);
  CHECK(a[0].angle == 0);

  std::vector<int> angles;
  written = u.manualSweep(100, a, 4);
  CHECK(written >= 1);
  CHECK(u.state() == State::Rejecting);
  stepRange(u, 101, 1200, false, &angles);
  CHECK(u.state() == State::Idle);
  CHECK(angles.size() == 1);              // only the return to rest
  CHECK(angles[0] == fastConfig().restAngle);
}

void testManualSweepRefusedWhileBusy() {
  ControlUnit u;
  u.init(0, fastConfig());
  Action a[4];
  u.setMode(1, Mode::Manual);

  CHECK(u.manualSweep(10, a, 4) >= 1);
  CHECK(u.manualSweep(20, a, 4) == 0);    // still sweeping
  CHECK(u.manualAngle(21, 30, a, 4) == 0);
  stepRange(u, 22, 1200, false);
  CHECK(u.state() == State::Idle);
}

void testManualRejectAlertsWithoutServo() {
  ControlUnit u;
  u.init(0, fastConfig());
  Action a[4];
  u.setMode(1, Mode::Manual);
  detectItem(u, 20, 41);

  uint8_t written = u.acceptVerdict(50, Verdict::Reject, a, 4);
  CHECK(written >= 1);
  for (uint8_t i = 0; i < written; ++i) {
    CHECK(a[i].kind != Action::Kind::ServoAngle);  // never actuates the servo
  }
  CHECK(u.state() == State::Rejecting);
  CHECK(u.rejectCount() == 1);

  std::vector<int> angles;
  stepRange(u, 51, 1200, true, &angles);
  CHECK(u.state() == State::Idle);
  CHECK(angles.empty());
}

void testCountersTrackRepeatedCycles() {
  ControlUnit u;
  u.init(0, fastConfig());
  Action a[4];

  detectItem(u, 20, 41);
  CHECK(u.acceptVerdict(50, Verdict::Reject, a, 4) >= 1);
  stepRange(u, 51, 1200, false);
  CHECK(u.rejectCount() == 1);

  detectItem(u, 1300, 1320);
  stepRange(u, 1321, 2600, false);
  CHECK(u.passCount() == 1);

  detectItem(u, 2700, 2720);
  CHECK(u.acceptVerdict(2800, Verdict::Pass, a, 4) >= 1);
  stepRange(u, 2801, 4000, false);
  CHECK(u.passCount() == 2);
  CHECK(u.state() == State::Idle);
}

int main() {
  testDetectionOpensCycleAndNotifies();
  testRejectSweepSequencedAndCounted();
  testExplicitPassSkipsActuation();
  testTimeoutResolvesToPassByDefault();
  testExplicitPassBeforeTimeoutWins();
  testLateVerdictIgnored();
  testRetriggerDuringCycleIgnored();
  testDebounceSuppressesFlicker();
  testManualCommandsRefusedInAutoMode();
  testModeSwitchOnlyAtIdle();
  testManualAngleAndSweepInManualMode();
  testManualSweepRefusedWhileBusy();
  testManualRejectAlertsWithoutServo();
  testCountersTrackRepeatedCycles();

  std::printf("%d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}