interface DependencyConnectorProps {
  active: boolean;
}

export function DependencyConnector({ active }: DependencyConnectorProps) {
  return (
    <svg className="mission-dependency-connector" viewBox="0 0 100 18" preserveAspectRatio="none" aria-hidden>
      <path
        className={active ? "mission-dependency-connector__path mission-dependency-connector__path--active" : "mission-dependency-connector__path"}
        d="M50 0 V14"
      />
      <path
        className={active ? "mission-dependency-connector__path mission-dependency-connector__path--active" : "mission-dependency-connector__path"}
        d="M45 12 L50 17 L55 12"
      />
    </svg>
  );
}
