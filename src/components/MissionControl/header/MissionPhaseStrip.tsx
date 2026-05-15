import { CheckOutlined } from "@ant-design/icons";
import type { MissionViewModel } from "../presenter/types";

interface MissionPhaseStripProps {
  items: MissionViewModel["phaseStrip"];
}

export function MissionPhaseStrip({ items }: MissionPhaseStripProps) {
  return (
    <div className="mission-phase-strip" aria-label="使命阶段">
      {items.map((item) => (
        <span
          key={item.key}
          className={`mission-phase-strip__item mission-phase-strip__item--${item.status}`}
        >
          {item.status === "done" ? <CheckOutlined /> : null}
          {item.label}
        </span>
      ))}
    </div>
  );
}
