/**
 * SigilEditor — edits the selected sigil.
 *
 * Composes the language editor, affordance and invariant panels,
 * toolbar, and preview into a single editing surface.
 */
import { useState } from "react";
import { useLayoutState } from "../../state/LayoutContext";
import { SigilFolder } from "../../tauri";
import type { ScopeEntry } from "./editorScope";
import type { ReferenceTarget } from "./referenceSearch";
import type { Ref } from "sigil-core";
import type { ActionDeps } from "../../actions/workspace";
import { LanguageEditor } from "./LanguageEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import { SigilPropertyEditor } from "./SigilPropertyEditor";
import styles from "./Workspace.module.css";
import propStyles from "./SigilPropertyEditor.module.css";

interface SigilEditorProps {
  sigil: SigilFolder;
  content: string;
  onChange: (content: string) => void;
  scope: ScopeEntry[];
  scopeNames: string[];
  scopeRoot: SigilFolder;
  scopePath: string[];
  workspaceRoot: SigilFolder;
  importedOntologies: SigilFolder | null;
  coreRefs: Ref[];
  keybindings: Record<string, string>;
  actionDeps: ActionDeps;
  refreshSerial: number;
  onCreateSigil: (name: string) => void;
  onCreateAffordance: (name: string, target?: SigilFolder) => void;
  onCreateInvariant: (name: string, target?: SigilFolder) => void;
  onRenameSigil: (oldName: string, newName: string) => void;
  onRenameProperty: (kind: "affordance" | "invariant", oldName: string, newName: string) => void;
  onRenameStatus: (oldValue: string, newValue: string) => void;
  onUndoLastRename: () => boolean;
  onNavigateToSigil: (name: string) => void;
  onNavigateToAbsPath: (path: string[]) => void;
  findReferencesTarget: ReferenceTarget | null;
  onFindReferencesClear: () => void;
  goToLine: number | null;
  onGoToLineDone: () => void;
}

export function SigilEditor({
  sigil,
  content,
  onChange,
  scope,
  scopeNames,
  scopeRoot,
  scopePath,
  workspaceRoot,
  importedOntologies,
  coreRefs,
  keybindings,
  actionDeps,
  refreshSerial,
  onCreateSigil,
  onCreateAffordance,
  onCreateInvariant,
  onRenameSigil,
  onRenameProperty,
  onRenameStatus,
  onUndoLastRename,
  onNavigateToSigil,
  onNavigateToAbsPath,
  findReferencesTarget,
  onFindReferencesClear,
  goToLine,
  onGoToLineDone,
}: SigilEditorProps) {
  const layout = useLayoutState();
  const [languageCollapsed, setLanguageCollapsed] = useState(false);

  const sharedScope = {
    scope,
    scopeNames,
    sigilRoot: scopeRoot,
    currentContext: sigil,
    currentPath: scopePath,
    onCreateAffordance,
    onCreateInvariant,
    onRenameSigil,
    onRenameProperty,
    onUndoLastRename,
    onNavigateToSigil,
    onNavigateToAbsPath: onNavigateToAbsPath,
    keybindings,
    actionDeps,
  };

  return (
    <>
      <SigilPropertyEditor
        sigilPath={sigil.path}
        filePrefix="affordance"
        title="Affordances"
        refPrefix="#"
        color="#3d9e8c"
        namePlaceholder="I need to..."
        contentPlaceholder="so that..."
        items={sigil.affordances}
        {...sharedScope}
      />
      <div className={propStyles.header} onClick={() => setLanguageCollapsed((c) => !c)}>
        <span className={propStyles.toggleIcon}>{languageCollapsed ? "\u25B6" : "\u25BC"}</span>
        <span className={propStyles.title}>Language</span>
      </div>
      {!languageCollapsed && (
      <div className={styles.editorArea}>
        {(layout.editorMode === "edit" || layout.editorMode === "split") && (
          <div className={layout.editorMode === "split" ? styles.splitLeft : styles.fullEditor}>
            <LanguageEditor
              content={content}
              onChange={onChange}
              scopeNames={scopeNames}
              scope={scope}
              workspaceRoot={workspaceRoot}
              importedOntologies={importedOntologies}
              sigilRoot={scopeRoot}
              currentContext={sigil}
              currentPath={scopePath}
              sigilDir={sigil.path}
              wordWrap={layout.wordWrap}
              refreshSerial={refreshSerial}
              onCreateSigil={onCreateSigil}
              onCreateAffordance={onCreateAffordance}
              onCreateInvariant={onCreateInvariant}
              onRenameSigil={onRenameSigil}
              onRenameProperty={onRenameProperty}
              onRenameStatus={onRenameStatus}
              onUndoLastRename={onUndoLastRename}
              onNavigateToSigil={onNavigateToSigil}
              onNavigateToAbsPath={onNavigateToAbsPath}
              keybindings={keybindings}
              findReferencesTarget={findReferencesTarget}
              onFindReferencesClear={onFindReferencesClear}
              goToLine={goToLine}
              onGoToLineDone={onGoToLineDone}
            />
          </div>
        )}
        {(layout.editorMode === "preview" || layout.editorMode === "split") && (
          <div className={layout.editorMode === "split" ? styles.splitRight : styles.fullEditor}>
            <MarkdownPreview content={content} refs={coreRefs} sigilDir={sigil.path} images={sigil.images} onContentChange={onChange} />
          </div>
        )}
      </div>
      )}
      <SigilPropertyEditor
        sigilPath={sigil.path}
        filePrefix="invariant"
        title="Invariants"
        refPrefix="!"
        color="#e8a040"
        namePlaceholder="what must hold..."
        contentPlaceholder="because..."
        items={sigil.invariants}
        {...sharedScope}
      />
    </>
  );
}
