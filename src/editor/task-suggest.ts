import { Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo } from "obsidian";
import { createTask, parseTaskInput } from "../objects/task-create";
import type VitrinePlugin from "../main";

export class TaskSuggest extends EditorSuggest<string> {
  constructor(private plugin: VitrinePlugin) {
    super(plugin.app);
  }

  onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
    const line = editor.getLine(cursor.line).slice(0, cursor.ch);
    const m = line.match(/\/task\s+(.+)$/);
    if (!m || m.index === undefined) return null;
    return { start: { line: cursor.line, ch: m.index }, end: cursor, query: m[1] };
  }

  getSuggestions(context: EditorSuggestContext): string[] {
    return [context.query];
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(`Create task: ${value}`);
  }

  selectSuggestion(value: string): void {
    const ctx = this.context;
    if (!ctx) return;
    const { editor, start, end, file } = ctx;
    void (async () => {
      const task = await createTask(this.plugin, { ...parseTaskInput(value), context: file ?? undefined });
      editor.replaceRange(`[[${task.basename}]]`, start, end);
    })();
  }
}
