import { Button } from "antd";
import { useEffect, useState } from "react";
import { formatChordForDisplay, keyboardEventToChord } from "../../utils/atMentionShortcutChord";
import "./KeyShortcutCapture.css";

export function KeyShortcutCapture({
  value,
  disabled = false,
  fieldLabel,
  emptyText = "未设置",
  setButtonText = "设置",
  changeButtonText = "更改",
  onChange,
}: {
  value: string;
  disabled?: boolean;
  /** 左侧字段名，如「快捷键」 */
  fieldLabel?: string;
  emptyText?: string;
  setButtonText?: string;
  changeButtonText?: string;
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

  const controls = (
    <>
      <kbd className="app-key-shortcut-capture__kbd">
        {listening ? "请按键…（Esc 取消）" : value ? formatChordForDisplay(value) : emptyText}
      </kbd>
      <Button
        size="small"
        type={listening ? "primary" : "default"}
        disabled={disabled || listening}
        onClick={() => setListening(true)}
      >
        {listening ? "录制中" : value ? changeButtonText : setButtonText}
      </Button>
      {listening ? (
        <Button
          size="small"
          type="link"
          disabled={disabled}
          onClick={() => setListening(false)}
        >
          取消
        </Button>
      ) : value ? (
        <Button size="small" type="link" disabled={disabled} onClick={() => onChange("")}>
          清除
        </Button>
      ) : null}
    </>
  );

  if (fieldLabel) {
    return (
      <div className="app-key-shortcut-capture app-key-shortcut-capture--labeled">
        <span className="app-key-shortcut-capture__field-label">{fieldLabel}</span>
        <span className="app-key-shortcut-capture__controls">{controls}</span>
      </div>
    );
  }

  return <span className="app-key-shortcut-capture">{controls}</span>;
}
