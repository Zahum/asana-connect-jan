import { App, DropdownComponent, Modal, Notice, Setting } from "obsidian";
import { AsanaAPI } from "../api";
import { errorMessage } from "../errors";
import { AsanaPluginSettings, AsanaProject, AsanaWorkspace } from "../types";

export class CreateTaskModal extends Modal {
  name = "";
  notes = "";
  dueOn = "";
  projectGid = "";
  workspaceGid = "";
  assignee = "";
  workspaces: AsanaWorkspace[] = [];
  private workspaceDropdown: DropdownComponent | null = null;
  private projectDropdown: DropdownComponent | null = null;
  private projectCache = new Map<string, AsanaProject[]>();

  constructor(
    app: App,
    private settings: AsanaPluginSettings,
    private onCreated?: (url: string, name: string) => void
  ) {
    super(app);
    this.workspaceGid = settings.defaultWorkspaceGid;
    this.projectGid = settings.defaultProjectGid;
    this.assignee = settings.defaultAssignee;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Create Asana task" });

    void this.loadWorkspacesAndProjects();

    new Setting(contentEl)
      .setName("Task name")
      .setClass("asana-modal-required")
      .addText((text) => text.setPlaceholder("Task name").setValue(this.name).onChange((v) => (this.name = v)));

    new Setting(contentEl)
      .setName("Description")
      .addTextArea((ta) =>
        ta.setPlaceholder("Optional description…").setValue(this.notes).onChange((v) => (this.notes = v))
      );

    new Setting(contentEl)
      .setName("Due date")
      .addText((text) =>
        text.setPlaceholder("YYYY-MM-DD").setValue(this.dueOn).onChange((v) => (this.dueOn = v))
      );

    new Setting(contentEl)
      .setName("Assignee")
      .setDesc('Use "me" for yourself, or paste a user GID.')
      .addText((text) =>
        text.setPlaceholder("me").setValue(this.assignee).onChange((v) => (this.assignee = v))
      );

    new Setting(contentEl)
      .setName("Workspace")
      .addDropdown((dd) => {
        this.workspaceDropdown = dd;
        dd.addOption(this.workspaceGid, this.settings.defaultWorkspaceName || "Default workspace");
        dd.setValue(this.workspaceGid);
        dd.onChange((v) => {
          this.workspaceGid = v;
          this.projectGid = v === this.settings.defaultWorkspaceGid ? this.settings.defaultProjectGid : "";
          void this.loadProjects(v);
        });
      });

    new Setting(contentEl)
      .setName("Project")
      .setDesc("Optional. Choose \"No project\" for a task in My Tasks only.")
      .addDropdown((dd) => {
        this.projectDropdown = dd;
        dd.addOption("", "Loading projects…");
        dd.setValue("");
        dd.onChange((v) => (this.projectGid = v));
      });

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText("Create Task")
        .setCta()
        .onClick(async () => {
          if (!this.name.trim()) {
            new Notice("Task name is required.");
            return;
          }
          btn.setButtonText("Creating…").setDisabled(true);
          try {
            const api = new AsanaAPI(this.settings.pat);
            const wsGid = this.workspaceGid || this.settings.defaultWorkspaceGid;
            const projGid = this.projectGid;
            const task = await api.createTask({
              name: this.name.trim(),
              notes: this.notes.trim() || undefined,
              due_on: this.dueOn.trim() || undefined,
              workspace: wsGid || undefined,
              projects: projGid ? [projGid] : undefined,
              assignee: this.assignee.trim() || "me",
            });
            new Notice(`Created: ${task.name}`);
            if (this.onCreated) {
              this.onCreated(task.permalink_url, task.name);
            }
            this.close();
          } catch (e) {
            new Notice("Failed to create task: " + errorMessage(e));
            btn.setButtonText("Create Task").setDisabled(false);
          }
        })
    );
  }

  async loadWorkspacesAndProjects() {
    try {
      const api = new AsanaAPI(this.settings.pat);
      this.workspaces = await api.getWorkspaces();
      const dd = this.workspaceDropdown;
      if (dd && this.workspaces.length > 0) {
        dd.selectEl.empty();
        for (const ws of this.workspaces) dd.addOption(ws.gid, ws.name);
        if (!this.workspaces.some((w) => w.gid === this.workspaceGid)) {
          this.workspaceGid = this.workspaces[0].gid;
        }
        dd.setValue(this.workspaceGid);
      }
    } catch (e) {
      // keep the default workspace option
    }
    await this.loadProjects(this.workspaceGid);
  }

  async loadProjects(workspaceGid: string) {
    const dd = this.projectDropdown;
    if (!dd || !workspaceGid) return;
    dd.selectEl.empty();
    dd.addOption("", "Loading projects…");
    dd.setDisabled(true);
    try {
      let projects = this.projectCache.get(workspaceGid);
      if (!projects) {
        const api = new AsanaAPI(this.settings.pat);
        projects = (await api.getAllProjects(workspaceGid)).sort((a, b) => a.name.localeCompare(b.name));
        this.projectCache.set(workspaceGid, projects);
      }
      if (workspaceGid !== this.workspaceGid) return; // user switched workspace meanwhile
      dd.selectEl.empty();
      dd.addOption("", "— No project —");
      for (const p of projects) dd.addOption(p.gid, p.name);
      if (!projects.some((p) => p.gid === this.projectGid)) this.projectGid = "";
      dd.setValue(this.projectGid);
    } catch (e) {
      dd.selectEl.empty();
      dd.addOption("", "— No project (couldn't load list) —");
      this.projectGid = "";
      new Notice("Couldn't load Asana projects: " + errorMessage(e));
    } finally {
      dd.setDisabled(false);
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
