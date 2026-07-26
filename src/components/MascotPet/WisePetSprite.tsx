/**
 * Wise 桌面宠物精灵 —— 透明底 + 三态（idle / working / permission）。
 *
 * 设计：
 * - 无外框/无阴影滤镜，宠物直接浮在桌面上。
 * - viewBox 0 0 80 96，整体偏小，留出顶部角标与右下角 99+ 徽章空间。
 * - 动画：idle 整身呼吸 + 头部微摆 + 周期性眨眼；working 加眼睛旋转 + 心跳；permission 加举手 + 感叹号弹跳。
 */
export type WisePetState = "idle" | "working" | "permission";

/**
 * 拖动方向：-1 向左移动 / 0 静止 / +1 向右移动。
 * Sprite 内部按方向调整眼睛朝向、手臂/腿的步态（见 .wise-pet-dir-left/right 修饰）。
 */
export type WisePetDirection = -1 | 0 | 1;

export function WisePetSprite({
  className,
  state = "idle",
  direction = 0,
}: {
  className?: string;
  state?: WisePetState;
  direction?: WisePetDirection;
}) {
  const isWorking = state === "working";
  const isPermission = state === "permission";
  const blinkId = "wise-pet-blink";
  const breathId = "wise-pet-breath";
  const dirClass =
    direction < 0 ? "wise-pet-dir-left" : direction > 0 ? "wise-pet-dir-right" : "";

  return (
    <svg
      className={`${className ?? ""} ${dirClass}`.trim()}
      viewBox="0 0 80 96"
      width="80"
      height="96"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="wise-pet-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#9ed8ff" />
          <stop offset="55%" stopColor="#4aa3f0" />
          <stop offset="100%" stopColor="#2a6fbe" />
        </linearGradient>
        <linearGradient id="wise-pet-head" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#cfeaff" />
          <stop offset="55%" stopColor="#6fbef7" />
          <stop offset="100%" stopColor="#357fc7" />
        </linearGradient>
        <linearGradient id="wise-pet-belly" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7ec8ff" />
          <stop offset="100%" stopColor="#4aa3f0" />
        </linearGradient>
        <linearGradient id="wise-pet-screen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1d3553" />
          <stop offset="100%" stopColor="#0c1c33" />
        </linearGradient>
      </defs>

      {/* 整体缩放容器，承担呼吸动画（translateY）。arm 用 -1 同步反向抵消，避免挥手时跟身体一起位移。 */}
      <g transform={`translate(40 52) scale(1) translate(-40 -52)`}>
        <g style={{ transformOrigin: "40px 56px", animation: `${breathId} 3.2s ease-in-out infinite` }}>
          {/* 脚 */}
          <rect className="wise-pet-foot-l" x="22" y="80" width="10" height="11" rx="4" fill="#3d91df" />
          <rect className="wise-pet-foot-r" x="48" y="80" width="10" height="11" rx="4" fill="#3d91df" />

          {/* 身体 */}
          <rect x="10" y="50" width="60" height="34" rx="14" fill="url(#wise-pet-body)" />
          <rect x="22" y="56" width="36" height="22" rx="9" fill="url(#wise-pet-belly)" opacity="0.85" />

          {/* 肚脐灯：working 心跳、permission 琥珀闪烁、idle 静态 */}
          {isWorking ? (
            <circle cx="40" cy="78" r="2.2" fill="#7ef0c3">
              <animate attributeName="opacity" values="0.3;1;0.3" dur="0.9s" repeatCount="indefinite" />
            </circle>
          ) : isPermission ? (
            <circle cx="40" cy="78" r="2.2" fill="#fbbf24">
              <animate attributeName="opacity" values="1;0.25;1" dur="0.55s" repeatCount="indefinite" />
            </circle>
          ) : (
            <circle cx="40" cy="78" r="2" fill="#7ef0c3" opacity="0.6" />
          )}

          {/* 头部（轻微摆动 animation 在父 g 上，与身体同步） */}
          <g style={{ transformOrigin: "40px 38px", animation: `wise-pet-head-tilt 4.8s ease-in-out infinite` }}>
            {/* 天线 */}
            <line x1="40" y1="14" x2="40" y2="6" stroke="#357fc7" strokeWidth="1.8" strokeLinecap="round" />
            <circle
              cx="40"
              cy="5"
              r="2.5"
              fill={isPermission ? "#fbbf24" : isWorking ? "#7ef0c3" : "#7ef0c3"}
            >
              {isWorking ? (
                <animate attributeName="opacity" values="0.4;1;0.4" dur="0.9s" repeatCount="indefinite" />
              ) : null}
            </circle>

            {/* 头 */}
            <rect x="14" y="14" width="52" height="40" rx="16" fill="url(#wise-pet-head)" />

            {/* 屏幕脸 */}
            <rect x="22" y="22" width="36" height="22" rx="8" fill="url(#wise-pet-screen)" />

            {/* 眼睛组：眨眼通过整组 opacity 切换实现；working 时眼睛本身旋转 */}
            <g className="wise-pet-eyes" style={{ transformOrigin: "32px 33px", animation: `${blinkId} 4.4s steps(1, end) infinite` }}>
              {isWorking ? (
                <>
                  {/* 旋转光圈（仅 working） */}
                  <circle cx="32" cy="33" r="6" fill="none" stroke="#7ef0c3" strokeOpacity="0.6" strokeWidth="1.2" strokeDasharray="2.4 2.4">
                    <animateTransform attributeName="transform" type="rotate" from="0 32 33" to="360 32 33" dur="2.4s" repeatCount="indefinite" />
                  </circle>
                  <circle cx="48" cy="33" r="6" fill="none" stroke="#7ef0c3" strokeOpacity="0.6" strokeWidth="1.2" strokeDasharray="2.4 2.4">
                    <animateTransform attributeName="transform" type="rotate" from="0 48 33" to="360 48 33" dur="2.4s" repeatCount="indefinite" />
                  </circle>
                  <circle cx="32" cy="33" r="2.2" fill="#0c1c33" />
                  <circle cx="48" cy="33" r="2.2" fill="#0c1c33" />
                  <circle cx="32" cy="33" r="1" fill="#7ef0c3">
                    <animate attributeName="opacity" values="0.4;1;0.4" dur="0.8s" repeatCount="indefinite" />
                  </circle>
                  <circle cx="48" cy="33" r="1" fill="#7ef0c3">
                    <animate attributeName="opacity" values="0.4;1;0.4" dur="0.8s" repeatCount="indefinite" />
                  </circle>
                </>
              ) : isPermission ? (
                <>
                  {/* 权限态：大眼 + 高光 */}
                  <circle cx="32" cy="33" r="5.5" fill="#0c1c33" />
                  <circle cx="48" cy="33" r="5.5" fill="#0c1c33" />
                  <circle cx="32" cy="33" r="2.4" fill="#fbbf24" />
                  <circle cx="48" cy="33" r="2.4" fill="#fbbf24" />
                  <circle cx="33" cy="31.5" r="0.9" fill="#ffffff" />
                  <circle cx="49" cy="31.5" r="0.9" fill="#ffffff" />
                </>
              ) : (
                <>
                  <circle cx="32" cy="33" r="1.8" fill="#0c1c33" />
                  <circle cx="48" cy="33" r="1.8" fill="#0c1c33" />
                  <circle cx="33" cy="32" r="0.8" fill="#ffffff" />
                  <circle cx="49" cy="32" r="0.8" fill="#ffffff" />
                </>
              )}
            </g>

            {/* 嘴：浅笑弧线（working 改直线专注） */}
            {!isWorking && !isPermission ? (
              <path d="M33 39 Q40 42 47 39" stroke="#cfeaff" strokeWidth="1.2" fill="none" strokeLinecap="round" opacity="0.75" />
            ) : isWorking ? (
              <line x1="35" y1="40" x2="45" y2="40" stroke="#cfeaff" strokeWidth="1.2" strokeLinecap="round" opacity="0.75" />
            ) : (
              <ellipse cx="40" cy="41" rx="2.2" ry="1.4" fill="#fbbf24" opacity="0.85" />
            )}

            {/* 头顶感叹号（permission 状态弹跳） */}
            {isPermission ? (
              <g transform="translate(58 6)">
                <circle r="6" fill="#fbbf24" stroke="#ffffff" strokeWidth="1.2">
                  <animateTransform attributeName="transform" type="scale" values="1;1.12;1" dur="0.6s" repeatCount="indefinite" additive="sum" />
                </circle>
                <text x="0" y="3" textAnchor="middle" fontFamily="system-ui, sans-serif" fontSize="8" fontWeight="800" fill="#ffffff">!</text>
              </g>
            ) : null}
          </g>

          {/* 手臂：permission 举起（独立 g 旋转，不与呼吸同步） */}
          <g transform="translate(0 0)">
            <g className="wise-pet-arm-l" style={{ transformOrigin: "8px 60px", animation: isPermission ? "wise-pet-arm-left 0.7s ease-in-out infinite" : "none" }}>
              <rect x="2" y="56" width="11" height="8" rx="4" fill="#4aa3f0" />
            </g>
            <g className="wise-pet-arm-r" style={{ transformOrigin: "72px 60px", animation: isPermission ? "wise-pet-arm-right 0.7s ease-in-out infinite" : "none" }}>
              <rect x="67" y="56" width="11" height="8" rx="4" fill="#4aa3f0" />
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}