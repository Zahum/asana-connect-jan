import { App, FuzzySuggestModal, Notice } from "obsidian";
import { AsanaAPI } from "../api";
import { errorMessage } from "../errors";
import { AsanaPluginSettings, AsanaProject, AsanaTask, AsanaWorkspace } from "../types";

/** Generic fuzzy picker that resolves a promise with the chosen item (or null if closed). */
class Picker<T> extends FuzzySuggestModal<T> {
  private chosen = false;

  constructor(
    app: App,
    private items: T[],
    private label: (item: T) => string,
    placeholder: string,
    private resolve: (item: T | null) => void,
    private detail?: (item: T) => string
  ) {
    super(app);
    this.setPlaceholder(placeholder);
  }

  getItems(): T[] {
    return this.items;
  }

  getItemText(item: T): string {
    return this.label(item);
  }

  renderSuggestion(match: { item: T }, el: HTMLElement) {
    el.createEl("div", { text: this.label(match.item) });
    const extra = this.detail?.(match.item);
    if (extra) el.createEl("small", { text: extra, cls: "asana-picker-detail" });
  }

  onChooseItem(item: T) {
    this.chosen = true;
    this.resolve(item);
  }

  onClose() {
    super.onClose();
    // onChooseItem fires after onClose in Obsidian, so defer the "cancelled" check
    window.setTimeout(() => {
      if (!this.chosen) this.resolve(null);
    }, 0);
  }
}

function pick<T>(
  app: App,
  items: T[],
  label: (item: T) => string,
  placeholder: string,
  detail?: (item: T) => string
): Promise<T | null> {
  return new Promise((resolve) => {
    new Picker(app, items, label, placeholder, resolve, detail).open();
  });
}

/**
 * Walks the user through workspace → project → task and returns the chosen task.
 * The workspace step is skipped when the account has only one workspace.
 */
export async function pickTaskFromProject(
  app: App,
  settings: AsanaPluginSettings
): Promise<AsanaTask | null> {
  if (!settings.pat) {
    new Notice("Asana: add your Personal Access Token in the plugin settings first.");
    return null;
  }
  const api = new AsanaAPI(settings.pat);

  try {
    // 1. Workspace
    const workspaces = await api.getWorkspaces();
    let workspace: AsanaWorkspace | null = null;
    if (workspaces.length === 1) {
      workspace = workspaces[0];
    } else if (workspaces.length > 1) {
      // put the default workspace first
      const sorted = [...workspaces].sort((a, b) =>
        a.gid === settings.defaultWorkspaceGid ? -1 : b.gid === settings.defaultWorkspaceGid ? 1 : 0
      );
      workspace = await pick(app, sorted, (w) => w.name, "Choose an Asana workspace…");
    }
    if (!workspace) return null;

    // 2. Project
    const loadingProjects = new Notice(`Loading projects in ${workspace.name}…`, 0);
    let projects: AsanaProject[];
    try {
      projects = await api.getAllProjects(workspace.gid);
    } finally {
      loadingProjects.hide();
    }
    if (projects.length === 0) {
      new Notice(`No projects found in ${workspace.name}.`);
      return null;
    }
    projects.sort((a, b) => a.name.localeCompare(b.name));
    const project = await pick(app, projects, (p) => p.name, `Choose a project in ${workspace.name}…`);
    if (!project) return null;

    // 3. Task
    const loadingTasks = new Notice(`Loading tasks in ${project.name}…`, 0);
    let tasks: AsanaTask[];
    try {
      tasks = await api.getAllProjectTasks(project.gid, settings.showCompletedTasks);
    } finally {
      loadingTasks.hide();
    }
    if (tasks.length === 0) {
      new Notice(`No ${settings.showCompletedTasks ? "" : "open "}tasks in ${project.name}.`);
      return null;
    }
    return await pick(
      app,
      tasks,
      (t) => (t.completed ? `✓ ${t.name}` : t.name),
      `Search tasks in ${project.name}…`,
      (t) => [t.assignee?.name, t.due_on ? `due ${t.due_on}` : null].filter(Boolean).join(" · ")
    );
  } catch (e) {
    new Notice("Asana: " + errorMessage(e));
    return null;
  }
}
