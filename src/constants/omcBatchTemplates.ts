export const DIRECT_OMC_BATCH_TEMPLATE_IDS = ["autopilot", "ultraqa", "verify", "team"] as const;
export const TRELLIS_BATCH_TEMPLATE_ID = "trellis" as const;
export const OMC_BATCH_TEMPLATE_IDS = [
  ...DIRECT_OMC_BATCH_TEMPLATE_IDS,
  TRELLIS_BATCH_TEMPLATE_ID,
] as const;

export type DirectOmcBatchTemplateId = (typeof DIRECT_OMC_BATCH_TEMPLATE_IDS)[number];
export type OmcBatchTemplateId = (typeof OMC_BATCH_TEMPLATE_IDS)[number];

export function isDirectOmcBatchTemplateId(value: OmcBatchTemplateId): value is DirectOmcBatchTemplateId {
  return value !== TRELLIS_BATCH_TEMPLATE_ID;
}
