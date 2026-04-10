---
status: implemented
---

# Workspace

The .sigil directory. This is where I work on the @sigil I am specifying. The workspace IS the spec being worked on.

Four components: @OntologyTree is the structure and owns lexical scoping. @Atlas is the spatial projection. @SigilEditor edits the selected sigil. @CompileStatusBar shows scope errors within the selected subtree.

@VisionPanel is where my @Vision lives, one click away. The counter-measure to distraction.

It maintains its !integrity and offers !clear-organization of documents on disk and panels in front of me. It #remembers-its-state across sessions. It always !reflects-disk-state.

Only one @Application instance is allowed to open a workspace. Many @Applications can run at the same time with their own workspaces. No @Applications ever share a workspace at the same time.

I #navigate to any @sigil and all views sync. I see my path via #breadcrumb. I #back to retrace. I #rename and all references update. I #find-references to see where a sigil is used. I use #shortcuts to keep my fingers on the keyboard. I #toggle-dark-light-theme to accommodate my tiring vision. I give my workspace an #application-name.

When ready, I #export or #publish.
