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

// Issue #24: no verdict inside the window must never let an item through.
void testTimeoutRejectsByDefault() {
  ControlUnit u;
  u.init(0, fastConfig());
  detectItem(u, 20, 41);

  std::vector<int> angles;
  bool alerted = false;
  for (uint32_t t = 50; t <= 1500; ++t) {
    Journal j = run(u, t, true);
    int a = angleOf(j);
    if (a != -999) angles.push_back(a);
    if (has(j, Action::Kind::RedLedOn) && has(j, Action::Kind::BuzzerOn)) alerted = true;
  }
  CHECK(u.state() == State::Idle);
  CHECK(u.passCount() == 0);
  CHECK(u.rejectCount() == 1);
  CHECK(u.timeoutCount() == 1);
  CHECK(alerted);
  CHECK(angles.size() == 2);                 // out to reject, back to rest
  CHECK(angles[0] == fastConfig().rejectAngle);
  CHECK(angles[1] == fastConfig().restAngle);
}

void testTimeoutIsExactlyAtWindow() {
  ControlUnit u;
  u.init(0, fastConfig());
  detectItem(u, 20, 41);                     // window opens at 41
  stepRange(u, 42, 41 + 999, true);
  CHECK(u.state() == State::AwaitingVerdict); // still inside the window
  Journal j = run(u, 41 + 1000, true);
  CHECK(angleOf(j) == fastConfig().rejectAngle);
  CHECK(u.state() == State::Rejecting);
}

void testTimeoutPassOnlyWhenConfigured() {
  Config c = fastConfig();
  c.timeoutVerdict = Verdict::Pass;          // old behaviour, explicit opt-in
  ControlUnit u;
  u.init(0, c);
  detectItem(u, 20, 41);

  std::vector<int> angles;
  stepRange(u, 50, 1200, true, &angles);
  CHECK(u.state() == State::Idle);
  CHECK(u.passCount() == 1);
  CHECK(u.rejectCount() == 0);
  CHECK(u.timeoutCount() == 1);
  CHECK(angles.empty());
}

void testManualModeTimeoutAlertsWithoutServo() {
  ControlUnit u;
  u.init(0, fastConfig());
  u.setMode(1, Mode::Manual);
  detectItem(u, 20, 41);

  std::vector<int> angles;
  stepRange(u, 50, 1500, true, &angles);
  CHECK(u.state() == State::Idle);
  CHECK(u.rejectCount() == 1);
  CHECK(u.timeoutCount() == 1);
  CHECK(angles.empty());                     // manual mode never moves the servo
}

void testItemIdsIncrementPerDetection() {
  ControlUnit u;
  u.init(0, fastConfig());
  CHECK(u.currentItemId() == 0);
  detectItem(u, 20, 41);
  CHECK(u.currentItemId() == 1);
  Action a[4];
  CHECK(u.acceptVerdict(50, Verdict::Pass, a, 4) >= 1);
  stepRange(u, 51, 200, false);
  detectItem(u, 300, 320);
  CHECK(u.currentItemId() == 2);
}

void testMatchingItemIdAccepted() {
  ControlUnit u;
  u.init(0, fastConfig());
  detectItem(u, 20, 41);
  Action a[4];
  VerdictResult r = VerdictResult::NotWaiting;
  CHECK(u.acceptVerdict(60, Verdict::Reject, u.currentItemId(), a, 4, &r) >= 1);
  CHECK(r == VerdictResult::Accepted);
  CHECK(u.rejectCount() == 1);
}

// Issue #24: a slow verdict for item 1 must not decide item 2.
void testStaleVerdictForEarlierItemRefused() {
  ControlUnit u;
  u.init(0, fastConfig());
  Action a[4];
  VerdictResult r = VerdictResult::Accepted;

  detectItem(u, 20, 41);                     // item 1
  stepRange(u, 50, 1500, false);             // times out, rejected, back to idle
  CHECK(u.rejectCount() == 1);
  CHECK(u.state() == State::Idle);

  detectItem(u, 1600, 1620);                 // item 2 now waiting
  CHECK(u.currentItemId() == 2);
  CHECK(u.acceptVerdict(1700, Verdict::Pass, 1, a, 4, &r) == 0);
  CHECK(r == VerdictResult::Stale);
  CHECK(u.state() == State::AwaitingVerdict); // item 2 still waits for its own
  CHECK(u.passCount() == 0);

  CHECK(u.acceptVerdict(1710, Verdict::Pass, 2, a, 4, &r) >= 1);
  CHECK(r == VerdictResult::Accepted);
  CHECK(u.passCount() == 1);
}

void testVerdictWhenNothingWaitingReportsNotWaiting() {
  ControlUnit u;
  u.init(0, fastConfig());
  Action a[4];
  VerdictResult r = VerdictResult::Accepted;
  CHECK(u.acceptVerdict(10, Verdict::Reject, 0, a, 4, &r) == 0);
  CHECK(r == VerdictResult::NotWaiting);
  CHECK(u.rejectCount() == 0);
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
  CHECK(u.setMode(1, Mode::Manual));

  u.setMode(3, Mode::Auto);
  detectItem(u, 20, 41);
  CHECK(u.state() == State::AwaitingVerdict);
  CHECK(!u.setMode(100, Mode::Manual));
  CHECK(u.mode() == Mode::Auto);

  stepRange(u, 101, 1500, true);             // times out, rejects, returns
  CHECK(u.state() == State::Idle);
  CHECK(u.setMode(1510, Mode::Manual));
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
  stepRange(u, 1321, 2600, false);           // timeout now rejects
  CHECK(u.rejectCount() == 2);
  CHECK(u.timeoutCount() == 1);
  CHECK(u.passCount() == 0);

  detectItem(u, 2700, 2720);
  CHECK(u.acceptVerdict(2800, Verdict::Pass, a, 4) >= 1);
  stepRange(u, 2801, 4000, false);
  CHECK(u.passCount() == 1);
  CHECK(u.state() == State::Idle);
}

// Line latency: detection -> verdict, per item, for p50/p95 reports (#24).
void testCycleLatencyRecordedPerItem() {
  ControlUnit u;
  u.init(0, fastConfig());
  Action a[4];
  CHECK(u.cyclesRecorded() == 0);

  detectItem(u, 20, 41);                     // item 1 opens at 41
  CHECK(u.acceptVerdict(41 + 350, Verdict::Reject, a, 4) >= 1);
  stepRange(u, 392, 1000, false);

  detectItem(u, 1100, 1120);                 // item 2 opens at 1120
  CHECK(u.acceptVerdict(1120 + 90, Verdict::Pass, a, 4) >= 1);
  stepRange(u, 1211, 1400, false);

  Cycle c[4];
  uint8_t n = u.recentCycles(c, 4);
  CHECK(n == 2);
  CHECK(c[0].itemId == 1);
  CHECK(c[0].latencyMs == 350);
  CHECK(c[0].outcome == Cycle::Outcome::Reject);
  CHECK(c[1].itemId == 2);
  CHECK(c[1].latencyMs == 90);
  CHECK(c[1].outcome == Cycle::Outcome::Pass);
}

void testTimeoutCycleRecordsTheWindow() {
  ControlUnit u;
  u.init(0, fastConfig());
  detectItem(u, 20, 41);
  stepRange(u, 42, 1500, true);
  Cycle c[2];
  CHECK(u.recentCycles(c, 2) == 1);
  CHECK(c[0].outcome == Cycle::Outcome::Timeout);
  CHECK(c[0].latencyMs == fastConfig().verdictTimeoutMs);
}

void testStaleAndIgnoredVerdictsAreNotRecorded() {
  ControlUnit u;
  u.init(0, fastConfig());
  Action a[4];
  CHECK(u.acceptVerdict(5, Verdict::Pass, a, 4) == 0);  // nothing waiting
  detectItem(u, 20, 41);
  VerdictResult r;
  CHECK(u.acceptVerdict(60, Verdict::Pass, 99, a, 4, &r) == 0);  // stale id
  CHECK(u.cyclesRecorded() == 0);
}

void testCycleHistoryKeepsTheNewest() {
  ControlUnit u;
  u.init(0, fastConfig());
  Action a[4];
  uint32_t t = 0;
  const uint32_t items = kCycleHistory + 5;
  for (uint32_t i = 1; i <= items; ++i) {
    detectItem(u, t + 20, t + 40);
    CHECK(u.acceptVerdict(t + 40 + i, Verdict::Pass, a, 4) >= 1);  // latency = i ms
    stepRange(u, t + 41 + i, t + 200, false);
    t += 300;
  }
  CHECK(u.cyclesRecorded() == items);
  Cycle c[kCycleHistory];
  uint8_t n = u.recentCycles(c, kCycleHistory);
  CHECK(n == kCycleHistory);
  CHECK(c[0].itemId == items - kCycleHistory + 1);  // oldest kept
  CHECK(c[n - 1].itemId == items);                  // newest last
  CHECK(c[n - 1].latencyMs == items);

  Cycle few[3];
  CHECK(u.recentCycles(few, 3) == 3);
  CHECK(few[2].itemId == items);                    // a short read is the newest ones
}

int main() {
  testDetectionOpensCycleAndNotifies();
  testRejectSweepSequencedAndCounted();
  testExplicitPassSkipsActuation();
  testTimeoutRejectsByDefault();
  testTimeoutIsExactlyAtWindow();
  testTimeoutPassOnlyWhenConfigured();
  testManualModeTimeoutAlertsWithoutServo();
  testItemIdsIncrementPerDetection();
  testMatchingItemIdAccepted();
  testStaleVerdictForEarlierItemRefused();
  testVerdictWhenNothingWaitingReportsNotWaiting();
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
  testCycleLatencyRecordedPerItem();
  testTimeoutCycleRecordsTheWindow();
  testStaleAndIgnoredVerdictsAreNotRecorded();
  testCycleHistoryKeepsTheNewest();

  std::printf("%d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}