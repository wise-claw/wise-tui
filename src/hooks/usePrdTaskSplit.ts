import { useCallback, useState } from "react";
import type { PrdDocument, SplitResult, TaskSplitContext } from "../types";
import { splitPrdToTasks } from "../services/taskSplitter";
import { decideSplitPolicy, type SplitPolicyDecision } from "../services/splitPolicyRouter";
import { getWorkflowFacade } from "../services/workflow";

export function usePrdTaskSplit() {
  const [result, setResult] = useState<SplitResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPolicyDecision, setLastPolicyDecision] = useState<SplitPolicyDecision | null>(null);

  const runSplit = useCallback(async (prd: PrdDocument, context: TaskSplitContext | null = null) => {
    try {
      setLoading(true);
      const requirements = [
        ...prd.functional,
        ...prd.nonFunctional,
        ...prd.acceptance,
      ].map((text, index) => ({ id: `req-${index + 1}`, text }));
      const policy = decideSplitPolicy({
        prdText: [
          ...prd.background,
          ...prd.goals,
          ...prd.scenarios,
          ...prd.functional,
          ...prd.nonFunctional,
          ...prd.acceptance,
        ].join("\n"),
        requirements,
      });
      const nextContext: TaskSplitContext | null = context
        ? {
          ...context,
          splitPolicyId: policy.policyId,
          splitPolicyFeatures: policy.policyFeatures,
          splitPolicyRationale: policy.rationale,
        }
        : {
          mode: "manual",
          splitPolicyId: policy.policyId,
          splitPolicyFeatures: policy.policyFeatures,
          splitPolicyRationale: policy.rationale,
        };
      const next = splitPrdToTasks(prd, nextContext);
      const repositoryPath = nextContext?.repositoryPath ?? null;
      if (repositoryPath) {
        try {
          const facade = getWorkflowFacade();
          await facade.createRun({
            sessionId: `split:${repositoryPath}:${Date.now()}`,
            repositoryPath,
            taskSnapshotId: `snapshot:${Date.now()}`,
            startStage: "split",
            routingPolicyId: policy.policyId,
          });
        } catch {
          // Workflow 持久化失败不影响拆分主流程。
        }
      }
      setResult(next);
      setLastPolicyDecision(policy);
      setError(null);
      return next;
    } catch (err) {
      const message = err instanceof Error ? err.message : "任务拆分失败。";
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    result,
    loading,
    error,
    lastPolicyDecision,
    runSplit,
  };
}
