/** 关联检索：双节点连线，与 Ant Icon 尺寸对齐 */
export function CodeGraphAssociationIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="1em"
      height="1em"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
    >
      <circle cx="3.5" cy="8" r="2.25" />
      <circle cx="12.5" cy="8" r="2.25" />
      <path
        d="M5.75 8h4.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
