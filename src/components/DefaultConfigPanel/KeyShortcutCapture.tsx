import { Button } from "antd";
import { useEffect, useState } from "react";
import { formatChordForDisplay, keyboardEventToChord } from "../../utils/atMentionShortcutChord";
import "./KeyShortcutCapture.css";

export function KeyShortcutCapture({
  value,
  disabled = false,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (chord: string) => void;
}) {
  const [listening, setListening] = useState(false);

  useEffect(() => {
    if (!listening) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setListening(false);
        return;
      }
      const chord = keyboardEventToChord(event);
      if (chord) {
        onChange(chord);
        setListening(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [listening, onChange]);

  return (
    <span className="app-key-shortcut-capture">
      <kbd className="app-key-shortcut-capture__kbd">
        {listening ? "请按键…" : value ? formatChordForDisplay(value) : "未设置"}
      </kbd>
      <Button
        size="small"
        type={listening ? "primary" : "default"}
        disabled={disabled}
        onClick={() => setListening(true)}
      >
        {listening ? "录制中" : value ? "更改" : "设置"}
      </Button>
      {value ? (
        <Button size="small" type="link" disabled={disabled} onClick={() => onChange("")}>
          清除
        </Button>
      ) : null}
    </span>
  );
}
