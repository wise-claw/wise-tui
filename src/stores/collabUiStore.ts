import { useSyncExternalStore } from "react";
import type { CollabEffectiveConfigManifest, CollabSpawnConfig } from "../types/collaboration";

/** 需求详情抽屉：全局唯一，由会话卡片、需求列表、通知等入口打开。 */
export interface CollabRequirementDetailState {
  requirementId: string | null;
  tab: string | null;
}

const CLOSED_DETAIL: CollabRequirementDetailState = { requirementId: null, tab: null };
let detailState: CollabRequirementDetailState = CLOSED_DETAIL;
const detailListeners = new Set<() => void>();

export function openCollabRequirementDetail(requirementId: string, tab?: string): void {
  detailState = { requirementId, tab: tab ?? null };
  for (const l of detailListeners) l();
}

export function closeCollabRequirementDetail(): void {
  detailState = CLOSED_DETAIL;
  for (const l of detailListeners) l();
}

function subscribeDetail(cb: () => void): () => void {
  detailListeners.add(cb);
  return () => detailListeners.delete(cb);
}

export function useOpenCollabRequirementDetail(): CollabRequirementDetailState {
  return useSyncExternalStore(
    subscribeDetail,
    () => detailState,
    () => CLOSED_DETAIL,
  );
}

/** 仓库 / 工作区设置入口：查看并管理某个仓库（或工作区）绑定的智能体。 */
export interface CollabAgentScope {
  projectId: string;
  repositoryId: number | null;
  title: string;
}

let agentScope: CollabAgentScope | null = null;
const scopeListeners = new Set<() => void>();

export function openCollabAgentScope(scope: CollabAgentScope): void {
  agentScope = scope;
  for (const l of scopeListeners) l();
}

export function closeCollabAgentScope(): void {
  agentScope = null;
  for (const l of scopeListeners) l();
}

function subscribeScope(cb: () => void): () => void {
  scopeListeners.add(cb);
  return () => scopeListeners.delete(cb);
}

export function useCollabAgentScope(): CollabAgentScope | null {
  return useSyncExternalStore(
    subscribeScope,
    () => agentScope,
    () => null,
  );
}

/** 项目设置「协作与共享」：成员项目、协作空间、资源发布与订阅。 */
export interface CollabProjectSharingScope {
  projectId: string;
  title: string;
}

let sharingScope: CollabProjectSharingScope | null = null;
const sharingListeners = new Set<() => void>();

export function openCollabProjectSharing(scope: CollabProjectSharingScope): void {
  sharingScope = scope;
  for (const l of sharingListeners) l();
}

export function closeCollabProjectSharing(): void {
  sharingScope = null;
  for (const l of sharingListeners) l();
}

function subscribeSharing(cb: () => void): () => void {
  sharingListeners.add(cb);
  return () => sharingListeners.delete(cb);
}

export function useCollabProjectSharing(): CollabProjectSharingScope | null {
  return useSyncExternalStore(
    subscribeSharing,
    () => sharingScope,
    () => null,
  );
}

/** 新建多仓库协作需求：从需求列表或单仓需求弹窗打开，可预填正文与图片。 */
export interface CollabRequirementCreatePreset {
  body?: string;
  imagePaths?: string[];
  projectId?: string | null;
}

let createPreset: CollabRequirementCreatePreset | null = null;
const createListeners = new Set<() => void>();

export function openCollabRequirementCreate(preset: CollabRequirementCreatePreset = {}): void {
  createPreset = preset;
  for (const l of createListeners) l();
}

export function closeCollabRequirementCreate(): void {
  createPreset = null;
  for (const l of createListeners) l();
}

function subscribeCreate(cb: () => void): () => void {
  createListeners.add(cb);
  return () => createListeners.delete(cb);
}

export function useCollabRequirementCreate(): CollabRequirementCreatePreset | null {
  return useSyncExternalStore(
    subscribeCreate,
    () => createPreset,
    () => null,
  );
}

/** 讨论模式：以智能体身份在其仓库开只读会话。由执行桥（持有建会话能力）处理。 */
export interface CollabDiscussionRequest {
  agentId: string;
  agentName: string;
  originSessionId: string;
  repositoryPath: string;
  prompt: string;
  spawn: CollabSpawnConfig;
  manifest: CollabEffectiveConfigManifest | null;
}

type DiscussionHandler = (req: CollabDiscussionRequest) => Promise<string | null>;
let discussionHandler: DiscussionHandler | null = null;

export function registerCollabDiscussionHandler(handler: DiscussionHandler | null): void {
  discussionHandler = handler;
}

export async function launchCollabDiscussion(req: CollabDiscussionRequest): Promise<string | null> {
  if (!discussionHandler) throw new Error("执行桥尚未就绪，请稍后重试");
  return discussionHandler(req);
}
