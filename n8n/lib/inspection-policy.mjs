// A review outcome always keeps the existing physical reject command. A model
// suggestion and permission to approve automatically are different facts.
export function policyRule(policy, instruction, frameContext) {
  if (policy?.version !== 1 || policy.enabled !== true || !Array.isArray(policy.rules)) return null;
  const matches = policy.rules.filter(rule => rule.instruction === instruction &&
    rule.preparationProfile === frameContext?.inspectionProfile && rule.width === frameContext?.width && rule.height === frameContext?.height &&
    Number.isFinite(rule.threshold) && rule.threshold >= 0 && rule.threshold <= 1);
  return matches.length === 1 ? matches[0] : null;
}

export function applyInspectionPolicy(decision, { policy, instruction, frameContext, modelPromptMissing = false } = {}) {
  if (policy === undefined || policy === null) return decision;
  const rule = policyRule(policy, instruction, frameContext);
  const evaluated = ["defect_detected", "no_defect_detected"].includes(decision.reason);
  const qualified = rule?.automaticApproval === true &&
    ["quality", "production", "integrity", "parity"].every(key => rule.qualification?.[key] === true);
  const verified = decision.promptVerified === true && decision.promptMismatch !== true && !modelPromptMissing;
  const reviewRequired = !evaluated || !qualified || !verified;
  return { ...decision, modelVerdict: evaluated ? decision.verdict : null, modelReason: decision.reason,
    policyId: rule?.id ?? null, reviewRequired,
    reviewReason: !evaluated ? decision.reason : !rule ? "unsupported_inspection_condition" : !qualified ? "condition_not_qualified" : !verified ? "prompt_not_verified" : null,
    verdict: reviewRequired ? "reject" : decision.verdict,
    reason: evaluated && reviewRequired ? "manual_review_required" : decision.reason };
}
