import { message } from "antd";
import { useEffect, useRef } from "react";
import { ingestChromeSelectionRequirement } from "../services/chromeSelectionRequirementIngest";
import { subscribeChromeSelectionRequirement } from "../services/events";
import type { Repository } from "../types";

export function useChromeSelectionRequirementIngest(input: {
  repositories: Repository[];
  activeRepositoryId: number | null;
}): void {
  const repositoriesRef = useRef(input.repositories);
  repositoriesRef.current = input.repositories;
  const activeRepositoryIdRef = useRef(input.activeRepositoryId);
  activeRepositoryIdRef.current = input.activeRepositoryId;
  const ingestChainRef = useRef(Promise.resolve());

  useEffect(() => {
    return subscribeChromeSelectionRequirement((payload) => {
      ingestChainRef.current = ingestChainRef.current
        .catch(() => undefined)
        .then(() =>
          ingestChromeSelectionRequirement(payload, {
            repositories: repositoriesRef.current,
            activeRepositoryId: activeRepositoryIdRef.current,
          }),
        )
        .then((result) => {
          if (result === "ingested") {
            message.success("已从 Chrome 收到需求并开始处理");
          } else if (result === "ingested-undispatched") {
            message.success("已从 Chrome 新增需求（当前没有可用执行环境，未派发）");
          } else if (result === "no-repo") {
            message.warning("请先在 Wise 中打开一个仓库，再从 Chrome 发送需求");
          } else if (result === "empty") {
            message.warning("选中内容为空，未创建需求");
          }
        })
        .catch((err) => {
          console.error("[ChromeSelectionRequirement] ingest failed", err);
          message.error("从 Chrome 接收需求失败");
        })
        .then(() => undefined);
    });
  }, []);
}
