I #search by embedding a query text and finding its nearest neighbors in the index. Distance is cosine similarity — higher means more similar.

Search is a full scan over all stored vectors. At sigil scale (hundreds of files, ~2K chunks), full scan is under 5ms. No approximate nearest-neighbor structure is needed.

Search returns ranked results: file path, chunk text, and similarity score. The caller (typically #recall or #recognize) decides how many to retrieve and how to format them.