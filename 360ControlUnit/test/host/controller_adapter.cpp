// Test transport only: all admission, expiry and Verdict decisions use firmware core.
#include <cstdio>
#include <iostream>
#include <sstream>
#include <string>
#include "ControlUnitState.h"
using namespace controlunit;

static const char* stateName(State state) {
  switch (state) {
    case State::AwaitingVerdict: return "awaiting_verdict";
    case State::Rejecting: return "rejecting";
    case State::Passing: return "passing";
    default: return "idle";
  }
}

int main() {
  ControlUnit unit;
  std::string line;
  while (std::getline(std::cin, line)) {
    std::istringstream input(line);
    std::string operation;
    uint32_t now = 0;
    input >> operation >> now;
    Action actions[4];
    uint8_t count = 0;
    VerdictReceipt receipt;
    ItemIdentity submitted;
    if (operation == "reset") {
      int enabled = 0;
      input >> submitted.controllerSession >> enabled;
      Config config;
      config.admissionEnabled = enabled == 1;
      unit.init(now, config, submitted.controllerSession.c_str());
    } else if (operation == "step") {
      int present = 0;
      input >> present;
      count = unit.step(now, present == 1, actions, 4);
    } else if (operation == "verdict") {
      std::string action;
      input >> submitted.controllerSession >> submitted.itemId >> action;
      const auto verdict = action == "pass" ? Verdict::Pass : action == "reject" ? Verdict::Reject : static_cast<Verdict>(2);
      receipt = unit.acceptVerdict(now, submitted, verdict, actions, 4);
      count = receipt.actionCount;
    } else {
      std::cout << "{\"error\":\"invalid_test_command\"}" << std::endl;
      continue;
    }
    const auto& active = unit.itemIdentity();
    std::printf("{\"accepted\":%s,\"status\":\"%s\",\"reason\":\"%s\","
                "\"controller_session\":\"%s\",\"item_id\":\"%s\","
                "\"active_item\":{\"controller_session\":\"%s\",\"item_id\":\"%s\",\"verdict_window_ms\":3000},"
                "\"state\":\"%s\",\"pass_count\":%u,\"reject_count\":%u,"
                "\"resolution_reason\":\"%s\",\"admission_ready\":%s,\"actions\":[",
                receipt.accepted ? "true" : "false", receipt.accepted ? "accepted" : "ignored",
                receiptReasonName(receipt.reason), submitted.controllerSession.c_str(), submitted.itemId.c_str(),
                active.controllerSession.c_str(), active.itemId.c_str(), stateName(unit.state()),
                unit.passCount(), unit.rejectCount(), unit.resolutionReason(), unit.admissionReady() ? "true" : "false");
    for (uint8_t i = 0; i < count; ++i) {
      std::printf("%s{\"kind\":%u,\"angle\":%d}", i ? "," : "", static_cast<unsigned>(actions[i].kind), actions[i].angle);
    }
    std::printf("]}\n");
    std::fflush(stdout);
  }
}
