import { beforeEach, describe, expect, mock, test } from "bun:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { ReactNode } from "react";

const listTrellisSpecAreas = mock(async () => [
  { area: "frontend", hasIndex: true, mdFileCount: 4 },
  { area: "tauri", hasIndex: false, mdFileCount: 2 },
]);

const readTrellisSpecIndex = mock(async (_rootPath: string, area: string) => ({
  area,
  content: area === "frontend" ? "# Frontend\n\nCurrent rules" : "",
  sizeBytes: area === "frontend" ? 25 : 0,
}));

const writeTrellisSpecIndex = mock(async () => {});

mock.module("../../../services/trellisSpecBridge", () => ({
  listTrellisSpecAreas,
  readTrellisSpecIndex,
  writeTrellisSpecIndex,
}));

mock.module("@ant-design/icons", () => ({
  BookOutlined: () => <span>book</span>,
  ReloadOutlined: () => <span>reload</span>,
  SaveOutlined: () => <span>save</span>,
}));

mock.module("antd", () => ({
  Alert: ({ message }: { message?: ReactNode }) => <section>{message}</section>,
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Empty: ({ description }: { description?: ReactNode }) => <section>{description}</section>,
  Input: {
    TextArea: ({
      value,
      onChange,
    }: {
      value?: string;
      onChange?: (event: { target: { value: string } }) => void;
    }) => (
      <textarea
        value={value}
        onChange={(event) => onChange?.({ target: { value: event.currentTarget.value } })}
      />
    ),
  },
  Space: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Spin: () => <span>loading</span>,
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Typography: {
    Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  },
}));

const { SpecLibraryPanel } = await import("./SpecLibraryPanel");

describe("SpecLibraryPanel", () => {
  beforeEach(() => {
    listTrellisSpecAreas.mockClear();
    readTrellisSpecIndex.mockClear();
    writeTrellisSpecIndex.mockClear();
  });

  test("loads spec areas and opens the first indexed area", async () => {
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<SpecLibraryPanel rootPath="/repo" />);
    });

    expect(listTrellisSpecAreas).toHaveBeenCalledWith("/repo");
    expect(readTrellisSpecIndex).toHaveBeenCalledWith("/repo", "frontend");
    const output = JSON.stringify(renderer!.toJSON());
    expect(output).toContain("frontend");
    expect(output).toContain("# Frontend");
  });

  test("switches area, requests agent update, and keeps manual save as fallback", async () => {
    const onRequestAgentUpdate = mock(async () => {});
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <SpecLibraryPanel rootPath="/repo" onRequestAgentUpdate={onRequestAgentUpdate} />,
      );
    });

    const areaButtons = renderer!.root.findAll(
      (node) =>
        node.type === "button" &&
        typeof node.props.className === "string" &&
        node.props.className.includes("mission-spec-library-area"),
    );
    const tauriButton = areaButtons.find((button) =>
      button.findAllByProps({ className: "mission-spec-library-area__name" })
        .some((node) => node.children.includes("tauri")),
    );
    expect(tauriButton).toBeTruthy();

    await act(async () => {
      tauriButton!.props.onClick();
    });
    expect(readTrellisSpecIndex).toHaveBeenLastCalledWith("/repo", "tauri");

    const textarea = renderer!.root.findByType("textarea");
    await act(async () => {
      textarea.props.onChange({ currentTarget: { value: "# Tauri\n\nBridge rules" } });
    });

    const agentButton = renderer!.root
      .findAllByType("button")
      .find((button) => button.children.includes("用 Agent 更新"));
    expect(agentButton).toBeTruthy();

    await act(async () => {
      agentButton!.props.onClick();
    });

    expect(onRequestAgentUpdate).toHaveBeenCalledWith("tauri");

    const saveButton = renderer!.root
      .findAllByType("button")
      .find((button) => button.children.includes("高级保存 index"));
    expect(saveButton).toBeTruthy();

    await act(async () => {
      saveButton!.props.onClick();
    });

    expect(writeTrellisSpecIndex).toHaveBeenCalledWith("/repo", "tauri", "# Tauri\n\nBridge rules");
  });
});
