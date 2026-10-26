// Acceptance probe against the actual firmware state machine, with virtual time.
// Exit 1 means a desired #24 requirement failed; it is not a compiler failure.
#include <cstdio>
#include "ControlUnitState.h"
using namespace controlunit;

static void tick(ControlUnit& unit, uint32_t at, bool present) {
  Action actions[8];
  unit.step(at, present, actions, 8);
}
static void item(ControlUnit& unit, uint32_t at) {
  tick(unit, at, true);
  tick(unit, at + 30, true);
}
static void init(ControlUnit& unit) {
  Config config;
  config.admissionEnabled = true;
  unit.init(0, config, "probe-boot");
  tick(unit, 0, false);
}

int main() {
  bool failed = false;
  std::printf("{\"scope\":\"Real ControlUnitState.cpp, virtual time, no hardware\",\"cases\":[");
  for (int i = 0; i < 3; ++i) {
    ControlUnit unit; init(unit); item(unit, 1);
    const uint32_t elapsed = i == 0 ? 2900 : i == 1 ? 3000 : 3100;
    tick(unit, 31 + elapsed, true);
    Action actions[8];
    const bool accepted = unit.acceptVerdict(31 + elapsed, unit.itemIdentity(), Verdict::Pass, actions, 8).accepted;
    const bool correct = elapsed < 3000 ? accepted : !accepted && unit.passCount() == 0;
    failed = failed || !correct;
    std::printf("%s{\"id\":\"deadline-%u\",\"accepted\":%s,\"passCount\":%u,\"requirementPassed\":%s}",
      i ? "," : "", elapsed, accepted ? "true" : "false", unit.passCount(), correct ? "true" : "false");
  }
  for (int i = 0; i < 2; ++i) {
    ControlUnit unit; init(unit); item(unit, 1);
    const auto itemA = unit.itemIdentity();
    for (uint32_t at = 32; at <= 3900; ++at) tick(unit, at, at < 3200);
    item(unit, 4000); // Item B is now awaiting its own verdict.
    Action actions[8];
    const Verdict lateA = i == 0 ? Verdict::Pass : Verdict::Reject;
    const bool accepted = unit.acceptVerdict(4040, itemA, lateA, actions, 8).accepted;
    if (unit.state() != State::AwaitingVerdict) failed = true;
    failed = failed || accepted;
    std::printf(",{\"id\":\"stale-A-%s-during-B\",\"accepted\":%s,\"requirementPassed\":%s}",
      i == 0 ? "pass" : "reject", accepted ? "true" : "false", accepted ? "false" : "true");
  }
  std::printf("]}\n");
  return failed ? 1 : 0;
}
