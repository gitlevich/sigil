/** Strip YAML frontmatter (---...\n---) from markdown content. */
export function stripFrontmatter(content: string): string {
  if (content.startsWith("---")) {
    const end = content.indexOf("\n---", 3);
    if (end !== -1) return content.slice(end + 4).trimStart();
  }
  return content;
}
