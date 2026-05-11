/**
 * PRD 拆分「输入准备」体积策略（spec §4 I3）。
 * 超长正文写入 `prd.md` 的裁剪稿，全文另附 `prd-full.md` 路径约定由 bundle 承载。
 */

/** 送入模型的 PRD 正文（`prd.md`）默认最大字符数（UTF-16 码元近似，与 String.length 一致）。 */
export const DEFAULT_PRD_BODY_MAX_CHARS = 120_000;
