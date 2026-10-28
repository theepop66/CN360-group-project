#include "ControlUnitState.h"
#include <cstdio>
#include <limits>

namespace controlunit {

static bool validToken(const std::string& value) {
  if (value.empty() || value.size() > 64) return false;
  for (const char c : value) {
    if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
          (c >= '0' && c <= '9') || c == '_' || c == '-')) return false;
  }
  return true;
}

bool validItemIdentity(const ItemIdentity& item) {
  return validToken(item.controllerSession) && validToken(item.itemId);
}

const char* receiptReasonName(ReceiptReason reason) {
  switch (reason) {
    case ReceiptReason::Accepted: return "accepted";
    case ReceiptReason::Expired: return "expired";
    case ReceiptReason::WrongSession: return "wrong_session";
    case ReceiptReason::WrongItem: return "wrong_item";
    case ReceiptReason::AlreadyResolved: return "already_resolved";
    case ReceiptReason::InvalidRequest: return "invalid_request";
    default: return "no_active_item";
  }
}

void ControlUnit::init(uint32_t now, Config config, const char* session) {
  config_ = config;
  now_ = now;
  debounceStart_ = now;
  phaseStart_ = now;
  sensorState_ = false;
  awaitClear_ = false;
  itemPresent_ = false;
  mode_ = Mode::Auto;
  phase_ = Phase::Idle;
  passCount_ = 0;
  rejectCount_ = 0;
  item_ = {session ? session : "", ""};
  if (!validToken(item_.controllerSession)) item_.controllerSession.clear();
  itemCounter_ = 0;
  stationCleared_ = false;
  timedOut_ = false;
  rejectSequenceAlerted_ = false;
}

uint8_t ControlUnit::emit(Action::Kind kind, int angle, Action* out, uint8_t cap,
                          uint8_t idx) const {
  if (idx < cap) {
    out[idx].kind = kind;
    out[idx].angle = angle;
  }
  return idx + 1;
}

uint8_t ControlUnit::step(uint32_t now, bool sensorPresent, Action* out, uint8_t cap) {
  now_ = now;
  itemPresent_ = sensorPresent;

  if (sensorPresent && !sensorState_) {
    sensorState_ = true;
    debounceStart_ = now;
  } else if (!sensorPresent) {
    sensorState_ = false;
    awaitClear_ = false;
    stationCleared_ = true;
  }

  uint8_t idx = 0;
  if (admissionReady() && !awaitClear_ && sensorState_ &&
      (now - debounceStart_) >= config_.debounceMs) {
    ++itemCounter_;
    char itemId[21];
    std::snprintf(itemId, sizeof(itemId), "%llu", static_cast<unsigned long long>(itemCounter_));
    item_.itemId = itemId;
    timedOut_ = false;
    phase_ = Phase::AwaitVerdict;
    phaseStart_ = now;
    awaitClear_ = true;
    idx = emit(Action::Kind::Notify, 0, out, cap, idx);
  }

  switch (phase_) {
    case Phase::AwaitVerdict:
      if ((now - phaseStart_) >= config_.verdictTimeoutMs) {
        timedOut_ = true;
        idx = resolveReject(now, out, cap, idx);
      }
      break;
    case Phase::RejectRising:
      if ((now - phaseStart_) >= config_.rejectOutMs) {
        phase_ = Phase::RejectHold;
        phaseStart_ = now;
      }
      break;
    case Phase::RejectHold:
      if ((now - phaseStart_) >= config_.rejectHoldMs) {
        phase_ = Phase::RejectReturn;
        phaseStart_ = now;
        idx = emit(Action::Kind::ServoAngle, config_.restAngle, out, cap, idx);
      }
      break;
    case Phase::RejectReturn:
      if ((now - phaseStart_) >= config_.rejectReturnMs) {
        phase_ = Phase::Idle;
        awaitClear_ = true;
        if (rejectSequenceAlerted_) {
          idx = emit(Action::Kind::RedLedOff, 0, out, cap, idx);
          idx = emit(Action::Kind::BuzzerOff, 0, out, cap, idx);
          rejectSequenceAlerted_ = false;
        }
      }
      break;
    case Phase::AlertHold:
      if ((now - phaseStart_) >= config_.alertHoldMs) {
        phase_ = Phase::Idle;
        awaitClear_ = true;
        idx = emit(Action::Kind::RedLedOff, 0, out, cap, idx);
        idx = emit(Action::Kind::BuzzerOff, 0, out, cap, idx);
      }
      break;
    case Phase::PassSignal:
      if ((now - phaseStart_) >= config_.passSignalMs) {
        phase_ = Phase::Idle;
        awaitClear_ = true;
        idx = emit(Action::Kind::GreenLedOff, 0, out, cap, idx);
      }
      break;
    case Phase::Idle:
      break;
  }
  return idx;
}

VerdictReceipt ControlUnit::acceptVerdict(uint32_t now, const ItemIdentity& item,
                                         Verdict verdict, Action* out, uint8_t cap) {
  VerdictReceipt receipt;
  // Local expiry progresses even when the submitted command is invalid/stale.
  if (phase_ == Phase::AwaitVerdict && (now - phaseStart_) >= config_.verdictTimeoutMs) {
    timedOut_ = true;
    receipt.actionCount = resolveReject(now, out, cap, 0);
  }
  if (!validItemIdentity(item) ||
      (verdict != Verdict::Pass && verdict != Verdict::Reject)) {
    receipt.reason = ReceiptReason::InvalidRequest;
  } else if (item.controllerSession != item_.controllerSession) {
    receipt.reason = ReceiptReason::WrongSession;
  } else if (item_.itemId.empty()) {
    receipt.reason = ReceiptReason::NoActiveItem;
  } else if (item.itemId != item_.itemId) {
    receipt.reason = ReceiptReason::WrongItem;
  } else if (phase_ != Phase::AwaitVerdict) {
    receipt.reason = timedOut_ ? ReceiptReason::Expired : ReceiptReason::AlreadyResolved;
  } else {
    receipt.accepted = true;
    receipt.reason = ReceiptReason::Accepted;
    receipt.actionCount = verdict == Verdict::Pass ? resolvePass(now, out, cap, 0)
                                                  : resolveReject(now, out, cap, 0);
  }
  return receipt;
}

uint8_t ControlUnit::resolveReject(uint32_t now, Action* out, uint8_t cap, uint8_t idx) {
  rejectCount_++;
  if (mode_ == Mode::Auto) {
    rejectSequenceAlerted_ = true;
    phase_ = Phase::RejectRising;
    phaseStart_ = now;
    idx = emit(Action::Kind::ServoAngle, config_.rejectAngle, out, cap, idx);
    idx = emit(Action::Kind::RedLedOn, 0, out, cap, idx);
    idx = emit(Action::Kind::BuzzerOn, 0, out, cap, idx);
    return idx;
  }

  phase_ = Phase::AlertHold;
  phaseStart_ = now;
  idx = emit(Action::Kind::RedLedOn, 0, out, cap, idx);
  idx = emit(Action::Kind::BuzzerOn, 0, out, cap, idx);
  return idx;
}

bool ControlUnit::setMode(uint32_t now, Mode mode) {
  if (phase_ != Phase::Idle) {
    return false;
  }
  now_ = now;
  mode_ = mode;
  return true;
}

uint8_t ControlUnit::manualAngle(uint32_t now, int angle, Action* out, uint8_t cap) {
  if (mode_ != Mode::Manual || phase_ != Phase::Idle) {
    return 0;
  }
  now_ = now;
  if (angle < 0) angle = 0;
  if (angle > 180) angle = 180;
  return emit(Action::Kind::ServoAngle, angle, out, cap, 0);
}

uint8_t ControlUnit::manualSweep(uint32_t now, Action* out, uint8_t cap) {
  if (mode_ != Mode::Manual || phase_ != Phase::Idle) {
    return 0;
  }
  now_ = now;
  rejectSequenceAlerted_ = false;
  phase_ = Phase::RejectRising;
  phaseStart_ = now;
  uint8_t idx = emit(Action::Kind::ServoAngle, config_.rejectAngle, out, cap, 0);
  return idx;
}

State ControlUnit::state() const {
  switch (phase_) {
    case Phase::Idle:
      return State::Idle;
    case Phase::AwaitVerdict:
      return State::AwaitingVerdict;
    case Phase::PassSignal:
      return State::Passing;
    default:
      return State::Rejecting;
  }
}

Mode ControlUnit::mode() const { return mode_; }

bool ControlUnit::itemPresent() const { return itemPresent_; }

uint32_t ControlUnit::passCount() const { return passCount_; }

uint32_t ControlUnit::rejectCount() const { return rejectCount_; }

const ItemIdentity& ControlUnit::itemIdentity() const { return item_; }

bool ControlUnit::admissionReady() const {
  return config_.admissionEnabled && stationCleared_ && !item_.controllerSession.empty() &&
         phase_ == Phase::Idle && !awaitClear_ &&
         itemCounter_ != std::numeric_limits<uint64_t>::max();
}

const char* ControlUnit::resolutionReason() const {
  return timedOut_ ? "verdict_timeout" : "verdict";
}

uint8_t ControlUnit::resolvePass(uint32_t now, Action* out, uint8_t cap, uint8_t idx) {
  passCount_++;
  phase_ = Phase::PassSignal;
  phaseStart_ = now;
  return emit(Action::Kind::GreenLedOn, 0, out, cap, idx);
}

}  // namespace controlunit
