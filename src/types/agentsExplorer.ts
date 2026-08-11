/** `.agents` 目录探索的类型定义（与 Rust `agents_explorer` 模块一一对应）。 */

export interface AgentsCommandEntry {
  name: string;
  relPath: string;
  path: string;
  description?: string;
  allowedTools?: string;
  model?: string;
  argumentHint?: string;
}

export interface AgentsSkillEntry {
  name: string;
  relPath: string;
  path: string;
  description?: string;
}

export interface AgentsAgentEntry {
  name: string;
  relPath: string;
  path: string;
  description?: string;
  model?: string;
  tools: string[];
}

export interface AgentsOtherEntry {
  name: string;
  relPath: string;
  path: string;
  isDir: boolean;
}

export interface AgentsDirectoryScan {
  rootPath: string | null;
  exists: boolean;
  commands: AgentsCommandEntry[];
  skills: AgentsSkillEntry[];
  agents: AgentsAgentEntry[];
  others: AgentsOtherEntry[];
}

export interface AgentsFileContent {
  path: string;
  content: string;
  truncated: boolean;
}
