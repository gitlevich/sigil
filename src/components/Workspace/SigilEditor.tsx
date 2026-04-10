/**
 * SigilEditor — edits the selected sigil.
 *
 * Composes the language editor, affordance and invariant panels,
 * toolbar, and preview into a single editing surface.
 */
import { useRef } from "react";
import { useLayoutState } from "../../state/LayoutContext";
import { SigilFolder } from "../../tauri";
import type { ScopeEntry } from "./editorScope";
import type { Ref } from "sigil-core";
import type { ActionDeps } from "../../actions/workspace";
import { LanguageEditor } from "./LanguageEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import { SigilPropertyEditor } from "./SigilPropertyEditor";
import { EditorToolbar } from "./EditorToolbar";
import styles from "./Workspace.module.css";

interface SigilEditorProps {
  sigil: SigilFolder;
  content: string;
  onChange: (content: string) => void;
  scope: ScopeEntry[];
  scopeNames: string[];
  scopeRoot: SigilFolder;
  scopePath: string[];
  coreRefs: Ref[];
  keybindings: Record<string, string>;
  actionDeps: ActionDeps;
  onCreateSigil: (name: string) => void;
  onCreateAffordance: (name: string) => void;
  onCreateInvariant: (name: string) => void;
  onRenameSigil: (oldName: string, newName: string) => void;
  onRenameProperty: (kind: "affordance" | "invariant", oldName: string, newName: string) => void;
  onRenameStatus: (oldValue: string, newValue: string) => void;
  onNavigateToSigil: (name: string) => void;
  onNavigateToAbsPath: (path: string[]) => void;
  findReferencesName: string | null;
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
  coreRefs,
  keybindings,
  actionDeps,
  onCreateSigil,
  onCreateAffordance,
  onCreateInvariant,
  onRenameSigil,
  onRenameProperty,
  onRenameStatus,
  onNavigateToSigil,
  onNavigateToAbsPath,
  findReferencesName,
  onFindReferencesClear,
  goToLine,
  onGoToLineDone,
}: SigilEditorProps) {
  const layout = useLayoutState();

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
    onNavigateToSigil,
    onNavigateToAbsPath: onNavigateToAbsPath,
    keybindings,
    actionDeps,
  };

  return (
    <>
      <EditorToolbar />
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
      <div className={styles.editorArea}>
        {(layout.editorMode === "edit" || layout.editorMode === "split") && (
          <div className={layout.editorMode === "split" ? styles.splitLeft : styles.fullEditor}>
            <LanguageEditor
              content={content}
              onChange={onChange}
              scopeNames={scopeNames}
              scope={scope}
              sigilRoot={scopeRoot}
              currentContext={sigil}
              currentPath={scopePath}
              sigilDir={sigil.path}
              wordWrap={layout.wordWrap}
              onCreateSigil={onCreateSigil}
              onCreateAffordance={onCreateAffordance}
              onCreateInvariant={onCreateInvariant}
              onRenameSigil={onRenameSigil}
              onRenameProperty={onRenameProperty}
              onRenameStatus={onRenameStatus}
              onNavigateToSigil={onNavigateToSigil}
              onNavigateToAbsPath={onNavigateToAbsPath}
              keybindings={keybindings}
              findReferencesName={findReferencesName}
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
