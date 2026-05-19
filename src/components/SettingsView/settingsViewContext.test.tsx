import { describe, expect, test } from "bun:test";
import { useLayoutEffect } from "react";
import { act, create } from "react-test-renderer";
import {
  SettingsViewModeProvider,
  useSettingsViewMode,
  type SettingsViewMode,
} from "./settingsViewContext";

function Probe({ onValue }: { onValue: (mode: SettingsViewMode) => void }) {
  const mode = useSettingsViewMode();
  useLayoutEffect(() => {
    onValue(mode);
  });
  return null;
}

function ErrorProbe({ onError }: { onError: (err: unknown) => void }) {
  try {
    useSettingsViewMode();
  } catch (err) {
    onError(err);
  }
  return null;
}

describe("settingsViewContext", () => {
  test("returns the provided mode inside provider", () => {
    let observed: SettingsViewMode | null = null;
    act(() => {
      create(
        <SettingsViewModeProvider value="modal">
          <Probe
            onValue={(mode) => {
              observed = mode;
            }}
          />
        </SettingsViewModeProvider>,
      );
    });
    expect(observed).toBe("modal");
  });

  test("returns 'page' when nested provider wins", () => {
    let observed: SettingsViewMode | null = null;
    act(() => {
      create(
        <SettingsViewModeProvider value="modal">
          <SettingsViewModeProvider value="page">
            <Probe
              onValue={(mode) => {
                observed = mode;
              }}
            />
          </SettingsViewModeProvider>
        </SettingsViewModeProvider>,
      );
    });
    expect(observed).toBe("page");
  });

  test("throws when used outside provider", () => {
    let captured: unknown = null;
    act(() => {
      create(
        <ErrorProbe
          onError={(err) => {
            captured = err;
          }}
        />,
      );
    });
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toContain("useSettingsViewMode");
  });
});
